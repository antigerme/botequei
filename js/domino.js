// Dominó — lógica pura (sem DOM/rede), testável no Node. Regras de boteco (sem "compra"):
// dobra-seis (28 pedras), cada um recebe uma mão, quem tem a maior carroça começa jogando ela;
// na sua vez você encaixa numa das duas pontas ou passa (se não tem encaixe). Ganha quem bater
// (esvaziar a mão); se trancar (todos passam seguidos), ganha a menor soma de pontos.
//
// Nota de arquitetura: as MÃOS são privadas (entregues 1-a-1 pelo dono da mesa via canal direto);
// já as JOGADAS são públicas e validadas por todos com `legalMoves`/`place` — trapaça durante a
// partida não cola. Só o embaralho inicial confia em quem "dá as cartas", igual na vida real.
// A "mesa verificada" (fim deste arquivo) endurece isso com commit-to-deck + corte coletivo.

import { sha256Hex } from './purrinha.js';

// baralho completo: [a,b] com a<=b (28 pedras)
export const FULL_SET = (() => {
  const t = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) t.push([a, b]);
  return t;
})();

export const isDouble = (t) => t[0] === t[1];
export const pips = (t) => t[0] + t[1];
export const tileKey = (t) => `${Math.min(t[0], t[1])}-${Math.max(t[0], t[1])}`;
export const pipCount = (hand) => (hand || []).reduce((a, t) => a + pips(t), 0);

// PRNG determinístico (mulberry32) — deal reproduzível nos testes; no app semeia com crypto.
export function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// quantas pedras por jogador (boteco, sem compra): 2 jogadores → 7; 3–4 → 6
export function handSizeFor(players) { return players <= 2 ? 7 : 6; }

// distribui: { hands:[[tile]...], buried:[...] }
export function dealHands(players, rnd) {
  const deck = shuffle(FULL_SET, rnd || Math.random);
  const hs = handSizeFor(players);
  const hands = [];
  let k = 0;
  for (let p = 0; p < players; p++) hands.push(deck.slice(k, k += hs));
  return { hands, buried: deck.slice(k) };
}

// quem começa e com qual pedra: maior carroça (dobra) na mão de alguém; senão maior pedra.
export function opening(hands) {
  let best = null; // { player, tile, rank }
  const consider = (player, tile, rank) => { if (!best || rank > best.rank) best = { player, tile, rank }; };
  // dobras valem mais que qualquer não-dobra: rank dobra = 100 + valor; não-dobra = pips
  for (let p = 0; p < hands.length; p++) for (const t of hands[p]) {
    consider(p, t, isDouble(t) ? 100 + t[0] : pips(t));
  }
  return best ? { player: best.player, tile: best.tile } : null;
}

// encaixes possíveis de uma mão dadas as pontas [L,R] (null,null = tabuleiro vazio).
// retorna [{ tile, side }] com side 'L'|'R'; tabuleiro vazio → qualquer pedra, side 'L'.
export function legalMoves(hand, ends) {
  const out = [];
  const [L, R] = ends || [null, null];
  for (const t of hand || []) {
    if (L == null) { out.push({ tile: t, side: 'L' }); continue; }
    if (t[0] === L || t[1] === L) out.push({ tile: t, side: 'L' });
    if (R !== L && (t[0] === R || t[1] === R)) out.push({ tile: t, side: 'R' });
  }
  return out;
}
export const canPlay = (hand, ends) => legalMoves(hand, ends).length > 0;

// coloca a pedra na ponta escolhida, orientando certo. Retorna { chain, ends } novos, ou null se
// a jogada for ilegal (validação em todo peer — jogada pública não confia no remetente).
export function place(chain, ends, tile, side) {
  const c = (chain || []).map((x) => x.slice());
  if (!c.length) return { chain: [tile.slice()], ends: [tile[0], tile[1]] };
  const [L, R] = ends;
  if (side === 'L') {
    if (tile[0] !== L && tile[1] !== L) return null;
    const outer = tile[0] === L ? tile[1] : tile[0]; // pip que fica pra fora
    c.unshift([outer, L]);
    return { chain: c, ends: [outer, R] };
  }
  if (tile[0] !== R && tile[1] !== R) return null;
  const outer = tile[0] === R ? tile[1] : tile[0];
  c.push([R, outer]);
  return { chain: c, ends: [L, outer] };
}

// ---- Partida completa (usada nos testes; no app as mãos ocultas viram contagem) ----
export function newGame(players, rnd) {
  const { hands, buried } = dealHands(players, rnd);
  const op = opening(hands);
  const st = { players, hands, chain: [], ends: [null, null], turn: op.player, passes: 0, buried, over: false, winner: null, reason: null };
  // a abertura é forçada: quem tem a maior carroça joga ela
  return playTile(st, op.player, op.tile, 'L');
}
export function playTile(state, player, tile, side) {
  if (state.over || player !== state.turn) return state;
  const idx = (state.hands[player] || []).findIndex((t) => tileKey(t) === tileKey(tile));
  if (idx < 0) return state;
  const placed = place(state.chain, state.ends, tile, side);
  if (!placed) return state; // ilegal
  const hands = state.hands.map((h, i) => (i === player ? h.filter((_, k) => k !== idx) : h));
  const st = { ...state, chain: placed.chain, ends: placed.ends, hands, passes: 0 };
  if (hands[player].length === 0) return { ...st, over: true, winner: player, reason: 'batida' };
  st.turn = (player + 1) % state.players;
  return st;
}
export function pass(state, player) {
  if (state.over || player !== state.turn) return state;
  if (canPlay(state.hands[player], state.ends)) return state; // não pode passar tendo encaixe
  const passes = state.passes + 1;
  if (passes >= state.players) { // trancou: menor soma ganha (empate → menor índice)
    let winner = 0, best = Infinity;
    for (let p = 0; p < state.players; p++) { const c = pipCount(state.hands[p]); if (c < best) { best = c; winner = p; } }
    return { ...state, passes, over: true, winner, reason: 'trancou' };
  }
  return { ...state, passes, turn: (player + 1) % state.players };
}

// ===================== Mesa verificada (commit-to-deck + corte coletivo) =====================
// Endurece o "confia em quem dá as cartas": o dono lacra o baralho ANTES (não pode trocar/inventar
// depois), a mão de cada um vem com um lacre que ele confere na hora, e um CORTE COLETIVO (seeds
// commit-reveal de todos → σ) embaralha por cima do baralho do dono — como o dono lacra antes de
// ver o corte, ele não consegue mirar num baralho favorável. No fim, o baralho é revelado e todos
// AUDITAM (lacre bate, é permutação das 28, corte confere, as mãos batem). Trapaça no deal é pega.

// serialização canônica (pra o hash bater igual em todo peer)
export function serializeTiles(tiles) { return (tiles || []).map((t) => `${t[0]}${t[1]}`).join(','); }
export function deckCommit(deck, salt) { return sha256Hex(salt + '|' + serializeTiles(deck)); }
export function handCommit(hand, salt) { return sha256Hex(salt + '|' + serializeTiles(hand)); }

// corte coletivo: junta os seeds (ordenados por id) → hash → semente do embaralho do corte
export function combineSeeds(seeds) {
  const joined = Object.keys(seeds || {}).sort().map((id) => `${id}:${seeds[id]}`).join('|');
  return sha256Hex(joined);
}
export const seedToInt = (hex) => parseInt(String(hex).slice(0, 8), 16) >>> 0;
export const cutDeck = (deck, combinedHex) => shuffle(deck, rngFrom(seedToInt(combinedHex)));

// o baralho é exatamente as 28 pedras (sem inventar nem repetir)?
export function isFullSet(deck) {
  if (!Array.isArray(deck) || deck.length !== 28) return false;
  const got = new Set(deck.map(tileKey));
  if (got.size !== 28) return false;
  for (const t of FULL_SET) if (!got.has(tileKey(t))) return false;
  return true;
}
const sameSet = (a, b) => {
  const A = new Set((a || []).map(tileKey)), B = new Set((b || []).map(tileKey));
  if (A.size !== B.size) return false;
  for (const k of A) if (!B.has(k)) return false;
  return true;
};
export function dealFromDeck(deck, players) {
  const hs = handSizeFor(players); const hands = []; let k = 0;
  for (let p = 0; p < players; p++) hands.push(deck.slice(k, k += hs));
  return { hands, buried: deck.slice(k) };
}

// Auditoria do deal (roda no fim, em todo peer). `initialHands[k]` = a mão inicial reconstruída do
// assento k (o que ele jogou + o que revelou). Retorna { ok, reason }.
export async function verifyDeal({ deck, salt, deckCommit: dc, seeds, seedCommits, players, initialHands }) {
  if ((await deckCommit(deck, salt)) !== dc) return { ok: false, reason: 'o lacre do baralho não bate' };
  if (!isFullSet(deck)) return { ok: false, reason: 'o baralho não são as 28 pedras' };
  for (const id of Object.keys(seedCommits || {})) {
    if ((await sha256Hex(seeds[id])) !== seedCommits[id]) return { ok: false, reason: `o seed de ${id} não confere` };
  }
  const F = cutDeck(deck, await combineSeeds(seeds));
  const dealt = dealFromDeck(F, players);
  for (let k = 0; k < players; k++) {
    if (initialHands && initialHands[k] && !sameSet(dealt.hands[k], initialHands[k])) return { ok: false, reason: `a mão do assento ${k} não confere com o baralho` };
  }
  return { ok: true };
}
