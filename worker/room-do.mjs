// Durable Object de UMA sala de sinalização — o adaptador Cloudflare por cima da MESMA
// Room pura do server/core.mjs que o adaptador Node (VM) usa. Mudou o contrato? Mexa no
// núcleo; os dois lados herdam.
//
// Como ele se mantém barato (free plan friendly):
// - WebSockets usam a Hibernation API: entre mensagens o DO pode ser REMOVIDO da memória
//   sem derrubar os sockets (acceptWebSocket + tag/attachment). O ping/pong do keepalive do
//   app é respondido pelo runtime SEM nem acordar o DO (setWebSocketAutoResponse).
// - Nada de setInterval/setTimeout (impediriam a hibernação): limpeza por UM alarm agendado
//   pro próximo vencimento real (Room.nextDeadline) — sala parada não gasta nada.
// - Presença/caixa-postal são EFÊMERAS EM MEMÓRIA de propósito (sinalização é transitória:
//   TTLs de 15s/120s — o polling re-toca a cada ~1s e o WebRTC re-oferta sozinho). Se o DO
//   hibernar no meio, a presença WS NÃO se perde: ela é sempre derivada de getWebSockets()
//   + attachment, que sobrevivem à hibernação.

import { Room, clean, MAX_BODY } from '../server/core.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};
const json = (data, code = 200) =>
  new Response(JSON.stringify(data), { status: code, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

export class RoomDO {
  constructor(ctx) {
    this.ctx = ctx;
    this.room = new Room();
    this._alarmAt = null;
    // keepalive do app ('ping' de texto, a cada 25s) respondido pelo runtime, DO dormindo
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // ---- presença via socket (a fonte é o runtime, não a memória — sobrevive à hibernação) ----
  _att(ws) { try { return ws.deserializeAttachment() || {}; } catch { return {}; } }
  _live() { return this.ctx.getWebSockets().filter((ws) => !this._att(ws).bye); }
  wsPeers() { return [...new Set(this._live().map((ws) => this._att(ws).peer).filter(Boolean))]; }

  broadcastPeers(now) {
    for (const ws of this._live()) {
      const peer = this._att(ws).peer;
      try { ws.send(JSON.stringify({ t: 'peers', peers: this.room.peersFor(peer, now, this.wsPeers()) })); } catch { /* close cuida */ }
    }
  }

  // entrega: socket aberto do destinatário → push na hora; senão → caixa-postal (poll drena)
  deliver(msg, now) {
    for (const ws of this.ctx.getWebSockets(msg.to)) {
      if (this._att(ws).bye) continue;
      try { ws.send(JSON.stringify({ t: 'msg', ...msg })); return; } catch { /* caiu: caixa */ }
    }
    this.room.push(msg, now);
    this._schedule();
  }

  // UM alarm no próximo vencimento (presença/caixa) — em vez de ficar acordado contando tempo
  _schedule() {
    const d = this.room.nextDeadline();
    if (d == null) return;
    if (this._alarmAt != null && this._alarmAt <= d) return;
    this._alarmAt = d;
    this.ctx.storage.setAlarm(d);
  }

  async alarm() {
    this._alarmAt = null;
    const now = Date.now();
    this.room.gc(now);
    this.broadcastPeers(now); // presença por TTL venceu? quem tá de socket fica sabendo já
    this._schedule();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const now = Date.now();
    this.room.gc(now);

    // upgrade → WebSocket com hibernação (o roteador já validou sala e método)
    if ((request.headers.get('Upgrade') || '').toLowerCase() === 'websocket') {
      const peer = clean(url.searchParams.get('peer'));
      if (peer === '') return json({ error: 'peer obrigatorio' }, 400);
      // reconexão substitui: o socket antigo do MESMO peer cai marcado (close não re-toca presença)
      for (const old of this.ctx.getWebSockets(peer)) {
        try { old.serializeAttachment({ peer, bye: 1 }); old.close(1000, 'reconectou'); } catch { /* já era */ }
      }
      const pair = new WebSocketPair();
      const client = pair[0], server = pair[1];
      this.ctx.acceptWebSocket(server, [peer]); // tag = peer (busca barata no deliver)
      server.serializeAttachment({ peer });     // sobrevive à hibernação
      this.room.pres.delete(peer);              // saiu do regime de polling: o socket É a presença
      server.send(JSON.stringify({ t: 'peers', peers: this.room.peersFor(peer, now, this.wsPeers()) }));
      for (const m of this.room.drain(peer)) server.send(JSON.stringify({ t: 'msg', ...m })); // recados da reconexão
      this.broadcastPeers(now);
      return new Response(null, { status: 101, webSocket: client });
    }

    // HTTP: o MESMO contrato do adaptador Node (join/poll/send/leave/peers)
    const action = url.searchParams.get('action') || '';
    let body = {};
    if (request.method === 'POST') {
      try {
        const raw = await request.text();
        if (raw.length <= MAX_BODY) { const j = JSON.parse(raw); if (j && typeof j === 'object') body = j; }
      } catch { /* corpo inválido = {} */ }
    }

    if (action === 'join') {
      const peer = clean(body.peer);
      if (peer === '') return json({ error: 'peer obrigatorio' }, 400);
      this.room.touch(peer, now);
      this.broadcastPeers(now);
      this._schedule();
      return json({ ok: true, peers: this.room.peersFor(peer, now, this.wsPeers()) });
    }
    if (action === 'peers') return json({ peers: this.room.peersAll(now, this.wsPeers()) });
    if (action === 'send') {
      const from = clean(body.from), to = clean(body.to);
      const type = typeof body.type === 'string' ? body.type : '';
      if (from === '' || to === '' || type === '') return json({ error: 'from/to/type obrigatorios' }, 400);
      this.deliver(Room.msg(from, to, type, body.payload, now), now);
      return json({ ok: true });
    }
    if (action === 'poll') {
      const peer = clean(url.searchParams.get('peer'));
      if (peer === '') return json({ error: 'peer obrigatorio' }, 400);
      const isNew = !this.room.live(now, this.wsPeers()).has(peer);
      this.room.touch(peer, now);
      if (isNew) this.broadcastPeers(now); // avisa quem está de socket que chegou gente
      this._schedule();
      return json({ messages: this.room.drain(peer), peers: this.room.peersFor(peer, now, this.wsPeers()) });
    }
    if (action === 'leave') {
      const peer = clean(body.peer);
      if (peer !== '') {
        // saiu de verdade: derruba TAMBÉM o socket dele, marcado — o close não re-toca a presença
        for (const ws of this.ctx.getWebSockets(peer)) {
          try { ws.serializeAttachment({ peer, bye: 1 }); ws.close(1000, 'saiu'); } catch { /* já era */ }
        }
        this.room.drop(peer);
        this.broadcastPeers(now);
      }
      return json({ ok: true });
    }
    return json({ error: 'acao desconhecida' }, 400);
  }

  // mensagem do app pelo socket: {to,type,payload} — o remetente é a identidade do socket
  async webSocketMessage(ws, message) {
    if (typeof message !== 'string') return;
    const from = this._att(ws).peer;
    if (!from) return;
    let m; try { m = JSON.parse(message); } catch { return; }
    const to = clean(m.to), type = typeof m.type === 'string' ? m.type : '';
    if (to === '' || type === '') return;
    this.deliver(Room.msg(from, to, type, m.payload, Date.now()), Date.now());
  }

  async webSocketClose(ws) { this._bye(ws); }
  async webSocketError(ws) { this._bye(ws); }

  _bye(ws) {
    const att = this._att(ws);
    if (att.bye || !att.peer) return; // saída explícita/substituição: já resolvida por quem fechou
    const now = Date.now();
    // ainda existe OUTRO socket vivo deste peer (reconexão)? então nada mudou
    const alive = this.ctx.getWebSockets(att.peer).some((w) => w !== ws && !this._att(w).bye);
    if (alive) return;
    this.room.touch(att.peer, now); // vira presença por TTL (~15s) — queda breve não perde a vaga
    this.broadcastPeers(now);
    this._schedule();
  }
}
