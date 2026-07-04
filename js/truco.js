// Truco de boteco — MOTOR PURO das três variantes (paulista, mineira e gaúcha).
// Sem DOM, sem rede: só regras, hierarquias, escadas de aposta, envido/flor (gaúcho),
// deal verificado com lacre POR CARTA e um reducer determinístico (mesma sequência de
// eventos ⇒ mesmo estado em todo peer). O protocolo P2P e a UI moram no app (T2).
//
// Representação de carta: { r: '4'|'5'|'6'|'7'|'Q'|'J'|'K'|'A'|'2'|'3' (francês 40)
//                              ou '1'..'7'|'10'|'11'|'12' (espanhol 40), s: naipe }.
// Naipes: francês 'ouros'|'espadas'|'copas'|'paus' · espanhol 'espadas'|'bastos'|'ouros'|'copas'.

// ---------- Variantes (tabela canônica de regras) ----------
export const VARIANTS = {
  paulista: {
    deck: 'fr', target: 12, start: 1, ladder: [3, 6, 9, 12],
    labels: { 3: 'TRUCO!', 6: 'SEIS!', 9: 'NOVE!', 12: 'DOZE!' },
    vira: true, maoDe: 11, maoDeVal: 3, maoDeFold: 1, ferroVal: 3, envido: false,
  },
  mineira: {
    deck: 'fr', target: 12, start: 2, ladder: [4, 6, 8, 10, 12],
    labels: { 4: 'TRUCO!', 6: 'SEIS!', 8: 'OITO!', 10: 'DEZ!', 12: 'DOZE!' },
    vira: false, maoDe: 10, maoDeVal: 4, maoDeFold: 2, ferroVal: 2, envido: false,
    // manilhas fixas, da maior pra menor
    fixed: ['4:paus', '7:copas', 'A:espadas', '7:ouros'],
  },
  gaucha: {
    deck: 'es', target: 24, start: 1, ladder: [2, 3, 4],
    labels: { 2: 'TRUCO!', 3: 'RETRUCO!', 4: 'VALE QUATRO!' },
    vira: false, maoDe: null, envido: true,
  },
};

const FR_RANKS = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3']; // força crescente
const FR_SUITS = ['ouros', 'espadas', 'copas', 'paus'];
const FR_MANILHA_SUIT = { ouros: 0, espadas: 1, copas: 2, paus: 3 }; // ♦<♠<♥<♣ (zap)
const ES_RANKS = ['1', '2', '3', '4', '5', '6', '7', '10', '11', '12'];
const ES_SUITS = ['espadas', 'bastos', 'ouros', 'copas'];

export function cardStr(c) { return c.r + ':' + c.s; }
export function parseCard(s) { const [r, su] = String(s).split(':'); return { r, s: su }; }

export function deckFor(variant) {
  const v = VARIANTS[variant];
  const ranks = v.deck === 'es' ? ES_RANKS : FR_RANKS;
  const suits = v.deck === 'es' ? ES_SUITS : FR_SUITS;
  const out = [];
  for (const s of suits) for (const r of ranks) out.push({ r, s });
  return out;
}

// ---------- Hierarquia / força ----------
// Paulista: manilha = rank SEGUINTE ao da vira (…2→3→4 circular), desempatada pelo naipe.
export function manilhaRank(vira) {
  const i = FR_RANKS.indexOf(vira.r);
  return FR_RANKS[(i + 1) % FR_RANKS.length];
}
export function isManilha(card, variant, vira) {
  const v = VARIANTS[variant];
  if (variant === 'paulista') return !!vira && card.r === manilhaRank(vira);
  if (variant === 'mineira') return v.fixed.includes(cardStr(card));
  return false; // gaúcho: hierarquia fixa, sem "manilha" à parte
}
// Poder numérico (maior ganha; PODE empatar — aí é "parda"/empate da vaza).
export function cardPower(card, variant, vira) {
  if (variant === 'gaucha') {
    const k = cardStr(card);
    if (k === '1:espadas') return 113;
    if (k === '1:bastos') return 112;
    if (k === '7:espadas') return 111;
    if (k === '7:ouros') return 110;
    return { 3: 9, 2: 8, 1: 7, 12: 6, 11: 5, 10: 4, 7: 3, 6: 2, 5: 1, 4: 0 }[card.r];
  }
  if (variant === 'mineira') {
    const i = VARIANTS.mineira.fixed.indexOf(cardStr(card));
    if (i >= 0) return 103 - i; // 4♣=103 > 7♥=102 > A♠=101 > 7♦=100
    return FR_RANKS.indexOf(card.r);
  }
  // paulista
  if (vira && card.r === manilhaRank(vira)) return 100 + FR_MANILHA_SUIT[card.s];
  return FR_RANKS.indexOf(card.r);
}

// Vaza: plays = [{ p, team, card }] na ordem jogada. Empate no topo ⇒ null (parda).
export function vazaWinner(plays, variant, vira) {
  let best = -1, who = null, tied = false;
  for (const pl of plays) {
    const pw = cardPower(pl.card, variant, vira);
    if (pw > best) { best = pw; who = pl; tied = false; }
    else if (pw === best && pl.team !== who.team) tied = true; // empate ENTRE times é parda
  }
  return tied ? null : who;
}

// Cascata de decisão da mão. results = array de times vencedores por vaza (null = parda).
// Regras (todas as variantes): ganhou a 1ª e empatou depois → dono da 1ª leva NA HORA;
// 1ª parda → 2ª decide; 1ª e 2ª pardas → 3ª decide; TRÊS pardas: paulista/mineira = ninguém
// pontua; gaúcha = time do "mão" leva. Duas vazas do mesmo time fecham sempre.
export function handWinner(results, maoTeam, variant) {
  const n = results.length;
  const wins = { 0: 0, 1: 0 };
  for (const r of results) if (r != null) wins[r]++;
  if (wins[0] >= 2) return 0;
  if (wins[1] >= 2) return 1;
  if (n >= 2 && results[0] != null && results[1] == null) return results[0]; // W depois empate
  if (n >= 3) {
    if (results[0] != null && results[2] == null) return results[0];         // W ? empate final
    if (results[0] == null && results[1] != null) return results[1];         // parda → 2ª decide
    if (results[0] == null && results[1] == null && results[2] != null) return results[2];
    if (results.every((r) => r == null)) return variant === 'gaucha' ? maoTeam : null;
    if (results[0] == null && results[1] != null) return results[1];
    return results[2] != null ? results[2] : null;
  }
  if (n === 2 && results[0] == null && results[1] != null) return results[1];
  return 'pending';
}

// ---------- Escada de apostas ----------
export function stakeLadder(variant) { return [VARIANTS[variant].start, ...VARIANTS[variant].ladder]; }
export function nextStake(variant, current) {
  const v = VARIANTS[variant];
  if (current < v.ladder[0]) return v.ladder[0];
  const i = v.ladder.indexOf(current);
  return i >= 0 && i + 1 < v.ladder.length ? v.ladder[i + 1] : null;
}
export function raiseLabel(variant, value) { return VARIANTS[variant].labels[value] || String(value); }
// Quem pode aumentar: quem NÃO fez a última proposta aceita/pendente; e há degrau acima.
export function canRaise(variant, stake, lastRaiserTeam, team) {
  if (nextStake(variant, stake) == null) return false;
  return lastRaiserTeam == null || lastRaiserTeam !== team;
}
// Correr entrega o valor ANTERIOR à proposta pendente (o "último aceito").
export function foldPoints(variant, stakeAccepted) { return stakeAccepted; }

// Resposta da DUPLA (2v2): qualquer um responde; vale a mais forte, em qualquer ordem.
// fold < accept < raise — um "vamos!" do parceiro atropela o "corro" do outro.
const RESP_RANK = { fold: 0, accept: 1, raise: 2 };
export function mergeResponses(list) {
  let best = null;
  for (const r of list || []) if (r in RESP_RANK && (best == null || RESP_RANK[r] > RESP_RANK[best])) best = r;
  return best;
}

// ---------- Mão de onze/dez e ferro ----------
// Retorna a regra especial ativa ANTES do deal, dado o placar. teams = [ptsA, ptsB].
export function maoRule(variant, teams) {
  const v = VARIANTS[variant];
  if (!v.maoDe) return { type: null };
  const a = teams[0] >= v.maoDe, b = teams[1] >= v.maoDe;
  if (a && b) return { type: 'ferro', value: v.ferroVal };            // às cegas, sem truco
  if (a || b) return { type: 'maoDe', team: a ? 0 : 1, value: v.maoDeVal, foldGives: v.maoDeFold };
  return { type: null };
}
export function applyResult(score, team, pts, variant) {
  const target = VARIANTS[variant].target;
  const s = score.slice();
  s[team] = Math.min(target, s[team] + pts);
  return { score: s, winner: s[team] >= target ? team : null };
}
export function teamOf(seatIdx) { return seatIdx % 2; }
export function dealerFor(handIdx, nPlayers) { return handIdx % nPlayers; }

// ---------- Envido & Flor (gaúcho) ----------
const ENV_VAL = (r) => (['10', '11', '12'].includes(r) ? 0 : Number(r)); // figuras valem 0
export function envidoPoints(hand) {
  let best = 0;
  for (const c of hand) best = Math.max(best, ENV_VAL(c.r)); // sem par: carta mais alta
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      if (hand[i].s === hand[j].s) best = Math.max(best, 20 + ENV_VAL(hand[i].r) + ENV_VAL(hand[j].r));
    }
  }
  return best; // máx 33 (7+6+20)
}
// Cadeia do MVP: E (2) e E+RE (5). Recusar E = 1 · recusar RE = 2 (o que já estava em jogo).
export function envidoChainValue(chain) {
  const c = (chain || []).join('+');
  if (c === 'E') return { accept: 2, fold: 1 };
  if (c === 'E+RE') return { accept: 5, fold: 2 };
  return { accept: 0, fold: 0 };
}
// pts = [{ p, team, points }] só de quem disputa. Empate → time do "mão" leva.
export function envidoWinner(pts, maoTeam) {
  let best = -1, team = null, tie = false;
  for (const e of pts) {
    if (e.points > best) { best = e.points; team = e.team; tie = false; }
    else if (e.points === best && e.team !== team) tie = true;
  }
  return tie ? maoTeam : team;
}
export function hasFlor(hand) { return hand.length === 3 && hand[0].s === hand[1].s && hand[1].s === hand[2].s; }
export function florPoints(hand) { return 20 + hand.reduce((a, c) => a + ENV_VAL(c.r), 0); }
// Uma flor só = 3 pts pro time dela; duas = a maior leva 6 (empate → time do mão).
export function florResolve(flors, maoTeam) {
  if (!flors.length) return null;
  if (flors.length === 1) return { team: flors[0].team, points: 3 };
  let best = -1, team = null, tie = false;
  for (const f of flors) {
    if (f.points > best) { best = f.points; team = f.team; tie = false; }
    else if (f.points === best && f.team !== team) tie = true;
  }
  return { team: tie ? maoTeam : team, points: 6 };
}

// ---------- Deal verificado: lacre POR CARTA ----------
// O dono embaralha (com corte coletivo, como no dominó) e publica UM commit por posição do
// baralho: sha256(carta ':' salt_i), salt_i = sha256(master ':' i). Cada jogada revela
// {carta, salt} e TODO peer confere contra o commit da posição — impossível trocar a carta
// depois do deal. No fim da PARTIDA o master é revelado e o baralho inteiro é auditável
// (não vaza blefe por mão: só audita quando acabou).
import { sha256Hex, randomNonce } from './purrinha.js'; // mesmos primitivos dos outros jogos
export { sha256Hex as sha256HexT, randomNonce as randomNonceT };
export const cardSalt = (master, i) => sha256Hex(master + ':' + i);
export const cardCommitT = async (card, salt) => sha256Hex(cardStr(card) + ':' + salt);

// Prepara o deal: hands[k] = posições k*3..k*3+2 do baralho cortado; vira (paulista) = posição
// seguinte às mãos. Devolve o pacote público (commits) e os privados (carta+salt por jogador).
export async function makeHandDeal(deckCut, nPlayers, master, wantVira) {
  const commits = [];
  for (let i = 0; i < deckCut.length; i++) commits.push(await cardCommitT(deckCut[i], await cardSalt(master, i)));
  const hands = []; // 3 cartas por jogador, posições lineares (k*3 .. k*3+2)
  for (let k = 0; k < nPlayers; k++) {
    const cards = [];
    for (const i of [k * 3, k * 3 + 1, k * 3 + 2]) cards.push({ i, card: deckCut[i], salt: await cardSalt(master, i) });
    hands.push(cards);
  }
  const viraIdx = nPlayers * 3;
  const vira = wantVira ? deckCut[viraIdx] : null;
  const viraSalt = wantVira ? await cardSalt(master, viraIdx) : null;
  return { commits, hands, vira, viraIdx, viraSalt };
}
export async function verifyOwnHand(mine, commits) {
  for (const h of mine) if ((await cardCommitT(h.card, h.salt)) !== commits[h.i]) return false;
  return true;
}
export async function verifyPlayReveal(reveal, commits) {
  return (await cardCommitT(reveal.card, reveal.salt)) === commits[reveal.i];
}
// Auditoria de fim de PARTIDA: com o master aberto, todo o baralho é reconstruível.
export async function verifyHandAudit({ deckCut, master, commits }) {
  if (!Array.isArray(deckCut) || deckCut.length !== commits.length) return { ok: false, reason: 'baralho de tamanho errado' };
  const seen = new Set(deckCut.map(cardStr));
  if (seen.size !== deckCut.length) return { ok: false, reason: 'carta repetida no baralho' };
  for (let i = 0; i < deckCut.length; i++) {
    if ((await cardCommitT(deckCut[i], await cardSalt(master, i))) !== commits[i]) {
      return { ok: false, reason: `lacre da posição ${i} não bate` };
    }
  }
  return { ok: true };
}

// ---------- Reducer determinístico da MÃO ----------
// Estado puro; reduceT(st, ev) devolve NOVO estado. Eventos:
//   { t:'play', p, card }                  — jogar carta (vaza corrente, na vez)
//   { t:'raise', p }                       — propor o próximo degrau (TRUCO/SEIS/…)
//   { t:'resp', p, r:'accept'|'fold'|'raise' } — resposta (2v2: acumula; vale a mais forte)
//   { t:'respClose' }                      — fecha a resposta pendente (protocolo emite após a graça)
//   { t:'envido', p } / { t:'realenvido', p } / { t:'envresp', p, r:'accept'|'fold' } (gaúcha, vaza 1)
//   { t:'flor', p, points }                — declara flor (gaúcha; anula envido)
// Convergência: 'resp'/'envresp' comutam (merge por máximo); os demais são aceitos só no
// estado exato em que valem — evento fora de hora é IGNORADO (todo peer ignora igual).
export function newTrucoHand({ variant, order, dealerIdx, vira = null, maoSpecial = null }) {
  const n = order.length;
  const maoIdx = (dealerIdx + 1) % n;
  return {
    variant, order, n, dealerIdx, maoIdx, vira,
    maoTeam: teamOf(maoIdx),
    turnIdx: maoIdx,               // mão fala/joga primeiro
    stake: maoSpecial && maoSpecial.type ? maoSpecial.value : VARIANTS[variant].start,
    maoSpecial: maoSpecial || { type: null }, // 'maoDe' trava truco; 'ferro' trava tudo
    lastRaiserTeam: null,
    pend: null,                    // { value, byTeam, resp: {} } proposta de truco pendente
    vazas: [[]], results: [],      // plays por vaza; time vencedor (ou null) por vaza
    played: {},                    // p -> nº de cartas jogadas
    envido: VARIANTS[variant].envido
      ? { open: true, chain: [], pendBy: null, resp: {}, closed: false, points: {}, winner: null, value: 0 }
      : null,
    flor: null,                    // { team, points } resolvido
    over: false, winnerTeam: null, points: 0, reason: null,
  };
}
const cloneT = (st) => JSON.parse(JSON.stringify(st));
function endHand(st, team, pts, reason) {
  st.over = true; st.winnerTeam = team; st.points = pts; st.reason = reason;
  return st;
}
function seatOf(st, p) { return st.order.indexOf(p); }

export function reduceT(prev, ev) {
  if (!prev || prev.over) return prev;
  const st = cloneT(prev);
  const seat = ev.p != null ? seatOf(st, ev.p) : -1;
  const team = seat >= 0 ? teamOf(seat) : null;

  if (ev.t === 'play') {
    if (seat !== st.turnIdx || st.pend) return prev;               // fora da vez / truco no ar
    if (st.envido && st.envido.pendBy != null) return prev;         // envido no ar
    const vz = st.vazas[st.vazas.length - 1];
    vz.push({ p: ev.p, team, card: ev.card });
    st.played[ev.p] = (st.played[ev.p] || 0) + 1;
    if (st.envido && st.envido.open && st.vazas.length === 1 && vz.length === st.n) st.envido.open = false;
    if (vz.length === st.n) {                                       // vaza fechou
      const w = vazaWinner(vz, st.variant, st.vira);
      st.results.push(w ? w.team : null);
      const hw = handWinner(st.results, st.maoTeam, st.variant);
      if (hw !== 'pending') {
        if (hw == null) return endHand(st, null, 0, 'empate');      // 3 pardas (pta/min): ninguém
        return endHand(st, hw, st.stake, 'vazas');
      }
      // quem lidera a próxima: vencedor da vaza; parda mantém quem liderou esta
      st.turnIdx = w ? seatOf(st, w.p) : seatOf(st, vz[0].p);
      st.vazas.push([]);
    } else {
      st.turnIdx = (st.turnIdx + 1) % st.n;
    }
    return st;
  }

  if (ev.t === 'raise') {
    if (st.pend || st.maoSpecial.type) return prev;                 // já tem proposta / mão especial trava
    if (st.envido && st.envido.pendBy != null) return prev;
    const nv = nextStake(st.variant, st.stake);
    if (nv == null || !canRaise(st.variant, st.stake, st.lastRaiserTeam, team)) return prev;
    st.pend = { value: nv, byTeam: team, resp: {} };
    return st;
  }

  if (ev.t === 'resp') {
    if (!st.pend || team === st.pend.byTeam) return prev;           // só o outro time responde
    if (!(ev.r in RESP_RANK)) return prev;
    st.pend.resp[ev.p] = ev.r;                                      // acumula (comuta)
    return st;
  }

  if (ev.t === 'respClose') {
    if (!st.pend) return prev;
    const r = mergeResponses(Object.values(st.pend.resp));
    if (r == null) return prev;                                     // ninguém respondeu ainda
    const { value, byTeam } = st.pend;
    if (r === 'fold') return endHand(st, byTeam, foldPoints(st.variant, st.stake), 'correu');
    if (r === 'accept') { st.stake = value; st.lastRaiserTeam = byTeam; st.pend = null; return st; }
    // raise: aceita o valor atual E devolve o degrau seguinte
    st.stake = value; st.lastRaiserTeam = byTeam;
    const nv = nextStake(st.variant, value);
    if (nv == null) { st.pend = null; return st; }                  // teto: vira aceite
    st.pend = { value: nv, byTeam: 1 - byTeam, resp: {} };
    return st;
  }

  // ---- Envido / Real Envido / Flor (gaúcha, só antes de fechar a 1ª vaza) ----
  if (ev.t === 'envido' || ev.t === 'realenvido') {
    if (!st.envido || !st.envido.open || st.envido.closed || st.pend) return prev;
    if (st.flor) return prev;                                       // flor anula envido
    const chain = st.envido.chain.join('+');
    if (ev.t === 'envido' && chain !== '') return prev;             // E só abre a cadeia
    if (ev.t === 'realenvido' && chain !== 'E') return prev;        // RE só em cima do E
    st.envido.chain.push(ev.t === 'envido' ? 'E' : 'RE');
    st.envido.pendBy = team;
    st.envido.resp = {};
    return st;
  }
  if (ev.t === 'envresp') {
    if (!st.envido || st.envido.pendBy == null || team === st.envido.pendBy) return prev;
    if (ev.r !== 'accept' && ev.r !== 'fold') return prev;
    st.envido.resp[ev.p] = ev.r;
    const r = mergeResponses(Object.values(st.envido.resp));        // accept > fold
    const val = envidoChainValue(st.envido.chain);
    if (r === 'accept') { st.envido.value = val.accept; st.envido.pendBy = null; st.envido.closed = true; }
    else if (r === 'fold' && Object.keys(st.envido.resp).length >= (st.n === 4 ? 2 : 1)) {
      // dupla inteira correu do envido: quem chamou leva o valor de recusa
      st.envido.winner = st.envido.pendBy; st.envido.value = val.fold;
      st.envido.pendBy = null; st.envido.closed = true;
    }
    return st;
  }
  if (ev.t === 'envpoints') { // declaração pública (protocolo valida com prova no fim)
    if (!st.envido || !st.envido.closed || st.envido.winner != null) return prev;
    st.envido.points[ev.p] = { team, points: ev.points };
    return st;
  }
  if (ev.t === 'flor') {
    if (!st.envido || st.flor || st.vazas.length > 1) return prev;
    const cur = st.flor || null;
    const flors = cur ? [cur, { team, points: ev.points }] : [{ team, points: ev.points }];
    st.flor = florResolve(flors, st.maoTeam);
    st.envido.closed = true; st.envido.open = false; st.envido.pendBy = null; // flor mata envido
    return st;
  }

  return prev;
}

// Fecha a disputa de envido quando todos os pontos declarados chegaram (chamada pelo protocolo).
export function settleEnvido(prev) {
  if (!prev.envido || !prev.envido.closed || prev.envido.winner != null || !prev.envido.value) return prev;
  const pts = Object.values(prev.envido.points);
  if (!pts.length) return prev;
  const st = cloneT(prev);
  st.envido.winner = envidoWinner(pts, st.maoTeam);
  return st;
}
