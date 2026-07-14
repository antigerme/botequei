// Núcleo PURO da sala de sinalização — o coração compartilhado pelos DOIS servidores:
// o adaptador Node (VM Red Hat/CentOS, server/node.mjs) e o Durable Object da Cloudflare
// (worker/room-do.mjs). Sem APIs de plataforma, sem I/O: só o estado de UMA sala (presença
// com TTL + caixa-postal FIFO por destinatário) e as regras do protocolo. Testável em Node
// (tests/core.test.mjs) com relógio injetado.
//
// Semântica (herdada do velho signaling.php, que este núcleo aposentou):
// - presença expira em 15s sem sinal; poll/join re-tocam; leave apaga na hora;
// - mailbox por destinatário: o poll DRENA (cada mensagem é entregue exatamente uma vez);
//   caixa órfã morre em 120s;
// - listas de peers: join/poll devolvem SEM o próprio; action=peers devolve COM (smoke test);
// - quem está em WebSocket não usa presença por TTL: o socket aberto É a presença (os
//   adaptadores passam essa lista em `extra`).

export const PRESENCE_TTL = 15_000; // ms sem sinal ⇒ saiu (tela apagada derruba em ~15s)
export const MBOX_TTL = 120_000;    // caixa-postal órfã vive isso
export const MAX_BODY = 65536;      // teto de corpo/frame (SDP grande cabe com folga)

// Higieniza ids vindos da rede (sala/peer). O `~` do PIN de mesa some aqui — os dois lados
// (quem cria e quem entra) mandam a MESMA string, então o namespace continua batendo.
export const clean = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '');

// Credenciais TURN efêmeras no padrão coturn "use-auth-secret" (a REST API de TURN,
// draft-uberti-behave-turn-rest / RFC 8489): username = <expiração unix em segundos> e
// credential = base64(HMAC-SHA1(segredo, username)). O coturn valida o HMAC com o MESMO
// static-auth-secret — SEM lista de usuários, e a credencial só vale até expirar. Assim o
// André pode subir um coturn no PRÓPRIO servidor (Red Hat/CentOS, o mesmo da VM) e não
// depender de TURN de terceiro nenhum (nem Cloudflare) — self-host de ponta a ponta.
// O HMAC entra por INJEÇÃO porque os dois adaptadores têm crypto diferente (Node = node:crypto
// SÍNCRONO; Worker = WebCrypto ASSÍNCRONO); esta função fica pura e testável (tests/turn.test.mjs).
export async function turnCredentials(urls, secret, ttlSec, now, hmacBase64) {
  const ttl = Number.isFinite(ttlSec) && ttlSec > 0 ? Math.floor(ttlSec) : 86400;
  const username = String(Math.floor(now / 1000) + ttl);
  const credential = await hmacBase64(secret, username);
  // TURN_URL pode listar vários (turn: e turns:) separados por vírgula — coturn faz STUN E TURN
  // no mesmo host, então isto basta pra srflx + relay sem terceiro nenhum.
  const list = Array.isArray(urls) ? urls.filter(Boolean) : String(urls || '').split(',').map((u) => u.trim()).filter(Boolean);
  return { iceServers: [{ urls: list, username, credential }] };
}

export class Room {
  constructor() {
    this.pres = new Map(); // peer -> lastSeen (ms) — presença de quem usa polling
    this.mbox = new Map(); // peer -> { msgs: [...], touched: ms } — FIFO por destinatário
  }

  // Remove presença vencida e caixas órfãs. Lazy: os adaptadores chamam a cada request
  // (igual o PHP fazia) — sala parada não gasta timer nenhum.
  gc(now) {
    for (const [p, seen] of this.pres) if (now - seen > PRESENCE_TTL) this.pres.delete(p);
    for (const [p, box] of this.mbox) if (now - box.touched > MBOX_TTL) this.mbox.delete(p);
  }

  touch(peer, now) { this.pres.set(peer, now); }

  // saída explícita: some da presença e leva a caixa junto
  drop(peer) { this.pres.delete(peer); this.mbox.delete(peer); }

  // Conjunto vivo = presença fresca (polling) ∪ `extra` (peers com WebSocket aberto,
  // informados pelo adaptador — socket vivo é presença por definição).
  live(now, extra = []) {
    const out = new Set(extra);
    for (const [p, seen] of this.pres) if (now - seen <= PRESENCE_TTL) out.add(p);
    return out;
  }
  peersFor(me, now, extra = []) { return [...this.live(now, extra)].filter((p) => p !== me).map((p) => ({ peer: p })); }
  peersAll(now, extra = []) { return [...this.live(now, extra)].map((p) => ({ peer: p })); }

  // Monta a mensagem canônica do protocolo (ts em SEGUNDOS, como sempre foi no fio).
  static msg(from, to, type, payload, now) {
    return { from, to, type, payload: payload ?? null, ts: Math.floor(now / 1000) };
  }

  // Enfileira pra entrega via poll (quando o destinatário não tem socket aberto).
  push(msg, now) {
    const box = this.mbox.get(msg.to) || { msgs: [], touched: 0 };
    box.msgs.push(msg);
    box.touched = now;
    this.mbox.set(msg.to, box);
  }

  // Drena a caixa do peer: devolve tudo e esvazia — entrega exatamente uma vez.
  drain(peer) {
    const box = this.mbox.get(peer);
    this.mbox.delete(peer);
    return box ? box.msgs : [];
  }

  // Sala morta (sem presença, sem caixa, sem sockets)? O adaptador pode coletá-la.
  idle(now, extra = []) { return this.live(now, extra).size === 0 && this.mbox.size === 0; }

  // Próximo instante em que ALGO vence (menor deadline de presença/caixa) — o Durable
  // Object usa isso pra agendar um único alarm em vez de ficar acordado contando tempo.
  nextDeadline() {
    let when = Infinity;
    for (const seen of this.pres.values()) when = Math.min(when, seen + PRESENCE_TTL);
    for (const box of this.mbox.values()) when = Math.min(when, box.touched + MBOX_TTL);
    return when === Infinity ? null : when;
  }
}
