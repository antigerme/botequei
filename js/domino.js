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

// quantas pedras por jogador — SEMPRE 7 (dominó de boteco distribui a mão cheia). 2p: 14 dormem ·
// 3p: 7 dormem · 4p: as 28 pedras, ZERO dorme (o padrão da mesa). O setup trava em 2–4 jogadores
// (app.js), então 7×4=28 nunca estoura o baralho.
export function handSizeFor() { return 7; }

// distribui: { hands:[[tile]...], buried:[...] }
export function dealHands(players, rnd) {
  const deck = shuffle(FULL_SET, rnd || Math.random);
  const hs = handSizeFor();
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

// ---------- Layout do TABULEIRO (serpentina de mesa real) — PURO/testável, sem DOM ----------
// A corrente é ANCORADA na pedra de ABERTURA (a maior carroça): ela fica no MEIO e não sai mais do
// lugar; os DOIS braços crescem pra fora dela — o de índice maior desce serpenteando, o de índice
// menor sobe. Assim uma jogada numa ponta NÃO re-flui o tabuleiro (pedra colocada fica PARADA);
// só girar o aparelho (muda a largura) re-arruma. Regras da mesa (dominó de bloco/dobra-seis):
//   • REGRA DE OURO DO T (do André): a BUCHA (a===b) fica SEMPRE ATRAVESSADA em relação à linha —
//     as DUAS vizinhas chegam pelo MEIO dos lados compridos dela (T dos dois lados; a linha passa
//     RETO). "Atravessada" é RELATIVO ao trecho: corrida horizontal → bucha EM PÉ; coluna da quina
//     (trecho vertical) → bucha DEITADA cruzando a coluna.
//   • Corolários: a linha NUNCA dobra numa bucha (as DUAS dobras da quina são sempre de pedra
//     COMUM — a quina só corta em junção comum-comum, e só vira quando a pedra DEPOIS do canto
//     também é comum); e vizinha de bucha nunca fica PARALELA a ela — depois de bucha a linha
//     segue RETA por mais uma pedra (`lockFlat`). Duas buchas nunca são vizinhas (não existe a
//     pedra que ligaria a-a em b-b), então a trava sempre resolve.
//   • pedra normal: DEITADA na corrida (o pip casa na anterior); indo pra ESQUERDA vai `flip` (b|a).
//   • serpenteia pra caber na LARGURA em tamanho cheio (nunca encolhe a pedra) e cresce em ALTURA.
//     Honrar o T pode ESTICAR a corrida um tiquinho além do limite (raro; decisão do André: o T
//     vale mais que a largura exata — o feltro rola). O bounding box final re-enquadra tudo.
// Devolve { tiles:[{a,b,x,y,w,h,vert,flip,idx,open,bucha}], width, height, anchor }.
//
// um braço (boustrophedon) a partir de um ponto/direção; empurra as pedras posicionadas em `out`.
// items: [{entry,exit,dbl,idx}] JÁ orientadas (entry casa com a de trás, rumo à âncora).
// vdir = +1 (a quina desce) ou -1 (sobe). loX/hiX = limites úteis (a corrida serpenteia dentro deles).
// lockFlat0 = braço saindo de âncora-bucha: a 1ª pedra é obrigada a seguir RETA (T na âncora).
function layArm(items, out, { startX, startYc, dir0, vdir, L, S, loX, hiX, lockFlat0 }) {
  let i = 0, dir = dir0, x = startX, yc = startYc;
  const N = items.length;
  const C = (L + S) / 2;                                   // reserva de largura da coluna: bucha DEITADA
  let last = null;                                         // cruza a coluna e sobra (L-S)/2 de cada lado
  let lockFlat = !!lockFlat0;                              // pedra logo após bucha: segue RETA (T)
  const flat = (it) => {                                   // deitada, ou BUCHA atravessada (em pé no yc)
    if (it.dbl) { last = { a: it.entry, b: it.exit, x: dir > 0 ? x : x - S, y: yc - L / 2, w: S, h: L, vert: true, flip: false, idx: it.idx, bucha: true }; x += dir * S; }
    else { const a = dir > 0 ? it.entry : it.exit, b = dir > 0 ? it.exit : it.entry; last = { a, b, x: dir > 0 ? x : x - L, y: yc - S / 2, w: L, h: S, vert: false, flip: false, idx: it.idx, bucha: false }; x += dir * L; }
    lockFlat = it.dbl; out.push(last);
  };
  while (i < N) {
    while (i < N) {                                        // enche a corrida (reserva C pra coluna da quina)
      const it = items[i];
      const room = dir > 0 ? (hiX - C - x) : (x - (loX + C));
      // Só pedra COMUM destravada corta pra quina (junção da dobra = comum-comum). BUCHA vai SEMPRE
      // reta na corrida (jamais na dobra), e a comum logo depois dela também (lockFlat) — mesmo que
      // estique um tiquinho além do limite (T > largura exata). O teto 2L reserva folga pra uma
      // bucha+comum forçadas caberem sem estourar (reserva vale exista-ou-não → decisão ESTÁVEL).
      if (!it.dbl && !lockFlat && room < 2 * L) break;
      flat(it); i++;
    }
    if (i >= N) break;
    // COLUNA da quina — a 1ª pedra (dobra de ENTRADA) é sempre COMUM (o corte acima garante).
    // Comum vai EM PÉ (ponta com ponta); BUCHA vai DEITADA cruzando a coluna: T com a de cima e a
    // de baixo, a linha passa RETO por ela (regra de ouro — era o "4/4 torto": bucha em pé colada
    // na coluna ficava PARALELA às vizinhas, sem T). A dobra de SAÍDA (o canto de onde a próxima
    // corrida sai DE LADO) também é sempre comum: só vira DEPOIS de uma comum E quando a PRÓXIMA
    // pedra também é comum (senão a bucha nasceria colada+paralela ao canto — sem T).
    const colX = dir > 0 ? x : x - S;                      // coluna encostada na última da corrida
    let edge = vdir > 0 ? yc - S / 2 : yc + S / 2;         // frente de avanço (alturas variam: L ou S)
    let m = 0, turned = false;
    while (i < N) {
      const it = items[i];
      if (it.dbl) {                                        // bucha DEITADA, centrada na coluna
        out.push(last = { a: it.entry, b: it.exit, x: colX + S / 2 - L / 2, y: vdir > 0 ? edge : edge - S, w: L, h: S, vert: false, flip: false, idx: it.idx, bucha: true });
        edge += vdir * S;
      } else {                                             // comum EM PÉ, ponta com ponta
        const a = vdir > 0 ? it.entry : it.exit, b = vdir > 0 ? it.exit : it.entry;
        out.push(last = { a, b, x: colX, y: vdir > 0 ? edge : edge - L, w: S, h: L, vert: true, flip: false, idx: it.idx, bucha: false });
        edge += vdir * L;
      }
      const wasDbl = it.dbl; i++; m++;
      if (m >= 2 && !wasDbl && i < N && !items[i].dbl) { turned = true; break; }
    }
    if (!turned) break;                                    // braço acabou dentro da coluna → rabo RETO
    yc = vdir > 0 ? edge - S / 2 : edge + S / 2;           // nova corrida alinhada ao quadrado de SAÍDA
    dir = -dir;
    lockFlat = false;                                      // a dobra saiu de comum-comum (o peek garante)
  }
}

export function snakeLayout(chain, opts = {}) {
  const L = Math.max(20, Math.round(opts.long || 66));   // comprimento da pedra deitada
  const S = Math.max(12, Math.round(opts.short || 34));  // largura da deitada = comprimento da em pé
  const pad = opts.pad == null ? 8 : opts.pad;
  const N = (chain || []).length;
  const W = Math.max(2 * pad + 2 * L, Math.floor(opts.width || 320));
  if (!N) return { tiles: [], width: W, height: 2 * pad + S, anchor: -1 };
  const isD = (t) => t[0] === t[1];
  // âncora = pedra de ABERTURA (a maior carroça); default = a maior bucha na corrente (é ela).
  let anchor = opts.anchor;
  if (anchor == null || anchor < 0 || anchor >= N) { let best = -1; anchor = 0; for (let k = 0; k < N; k++) if (isD(chain[k]) && chain[k][0] > best) { best = chain[k][0]; anchor = k; } }
  const loX = pad, hiX = W - pad, cx = W / 2, cy = 0;
  const out = [];
  const aT = chain[anchor], aDbl = isD(aT);
  if (aDbl) out.push({ a: aT[0], b: aT[1], x: cx - S / 2, y: cy - L / 2, w: S, h: L, vert: true, flip: false, idx: anchor, bucha: true });
  else out.push({ a: aT[0], b: aT[1], x: cx - L / 2, y: cy - S / 2, w: L, h: S, vert: false, flip: false, idx: anchor, bucha: false });
  const aRight = aDbl ? cx + S / 2 : cx + L / 2, aLeft = aDbl ? cx - S / 2 : cx - L / 2;
  // braço "pra frente" (idx > âncora): entra por chain[k][0]; desce serpenteando
  const fwd = []; for (let k = anchor + 1; k < N; k++) fwd.push({ entry: chain[k][0], exit: chain[k][1], dbl: isD(chain[k]), idx: k });
  layArm(fwd, out, { startX: aRight, startYc: cy, dir0: 1, vdir: 1, L, S, loX, hiX, lockFlat0: aDbl });
  // braço "pra trás" (idx < âncora): entra por chain[k][1]; sobe serpenteando
  const bwd = []; for (let k = anchor - 1; k >= 0; k--) bwd.push({ entry: chain[k][1], exit: chain[k][0], dbl: isD(chain[k]), idx: k });
  layArm(bwd, out, { startX: aLeft, startYc: cy, dir0: -1, vdir: -1, L, S, loX, hiX, lockFlat0: aDbl });
  for (const t of out) t.open = (t.idx === 0 || t.idx === N - 1);
  out.sort((p, q) => p.idx - q.idx);                       // ordem da corrente (render estável)
  // bounding-box → normaliza tudo pra começar em `pad` (translação UNIFORME: não re-flui, só re-enquadra)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of out) { if (t.x < minX) minX = t.x; if (t.y < minY) minY = t.y; if (t.x + t.w > maxX) maxX = t.x + t.w; if (t.y + t.h > maxY) maxY = t.y + t.h; }
  const sx = pad - minX, sy = pad - minY;
  for (const t of out) { t.x += sx; t.y += sy; }
  return { tiles: out, width: Math.round(maxX - minX + 2 * pad), height: Math.round(maxY - minY + 2 * pad), anchor };
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
  const hs = handSizeFor(); const hands = []; let k = 0;
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
