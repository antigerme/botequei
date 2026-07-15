// Testes do dominó (js/domino.js) — lógica pura. Sem deps. Rodar: node tests/domino.test.mjs

import assert from 'node:assert';
import {
  FULL_SET, isDouble, pips, tileKey, pipCount, rngFrom, shuffle, handSizeFor, dealHands,
  opening, legalMoves, canPlay, place, newGame, playTile, pass,
  serializeTiles, deckCommit, combineSeeds, cutDeck, isFullSet, dealFromDeck, verifyDeal,
  snakeLayout,
} from '../js/domino.js';
import { sha256Hex } from '../js/purrinha.js';

let passed = 0;
const ok = (n) => { console.log('  ✓ ' + n); passed++; };

// ---------- baralho ----------
{
  assert.strictEqual(FULL_SET.length, 28);
  const keys = new Set(FULL_SET.map(tileKey));
  assert.strictEqual(keys.size, 28); // sem repetição
  assert.ok(FULL_SET.every((t) => t[0] <= t[1] && t[1] <= 6));
  assert.strictEqual(isDouble([4, 4]), true);
  assert.strictEqual(isDouble([4, 5]), false);
  assert.strictEqual(pips([6, 3]), 9);
  assert.strictEqual(pipCount([[6, 6], [1, 2]]), 15);
  ok('baralho: 28 pedras únicas, pips/dobra/soma corretos');
}

// ---------- distribuição ----------
{
  assert.strictEqual(handSizeFor(2), 7);
  assert.strictEqual(handSizeFor(4), 7); // SEMPRE 7 — a mão cheia do boteco (era 6 pra 3–4)
  const { hands, buried } = dealHands(4, rngFrom(123));
  assert.strictEqual(hands.length, 4);
  assert.ok(hands.every((h) => h.length === 7)); // 4 jogadores = mão cheia
  assert.strictEqual(buried.length, 0);          // 4×7 = as 28, ZERO dorme
  const all = [...hands.flat(), ...buried];
  assert.strictEqual(all.length, 28);
  assert.strictEqual(new Set(all.map(tileKey)).size, 28); // ninguém recebe pedra repetida
  // 2 e 3 jogadores TAMBÉM saem com 7 (o resto dorme): 2p → 14 dormem, 3p → 7 dormem
  { const d = dealHands(2, rngFrom(9)); assert.ok(d.hands.every((h) => h.length === 7)); assert.strictEqual(d.buried.length, 14); }
  { const d = dealHands(3, rngFrom(9)); assert.ok(d.hands.every((h) => h.length === 7)); assert.strictEqual(d.buried.length, 7); }
  ok('distribuição: SEMPRE 7 por jogador (4p usa as 28, 0 dorme); somam 28 sem repetição');
}
{
  // shuffle é determinístico por semente e não perde pedras
  const a = shuffle(FULL_SET, rngFrom(7));
  const b = shuffle(FULL_SET, rngFrom(7));
  assert.deepStrictEqual(a, b);
  assert.strictEqual(new Set(a.map(tileKey)).size, 28);
  ok('shuffle: determinístico por semente e conserva as pedras');
}

// ---------- abertura ----------
{
  const hands = [[[1, 2], [6, 6]], [[3, 4], [5, 5]]];
  const op = opening(hands);
  assert.strictEqual(op.player, 0);
  assert.deepStrictEqual(op.tile, [6, 6]); // maior carroça abre
  // sem dobras: maior pedra
  const op2 = opening([[[1, 2], [0, 3]], [[6, 5], [2, 4]]]);
  assert.strictEqual(op2.player, 1);
  assert.deepStrictEqual(op2.tile, [6, 5]);
  ok('abertura: maior carroça começa; sem dobra, a maior pedra');
}

// ---------- encaixes + colocação ----------
{
  assert.deepStrictEqual(legalMoves([[3, 4]], [null, null]), [{ tile: [3, 4], side: 'L' }]);
  const lm = legalMoves([[5, 2], [1, 3], [0, 6]], [3, 5]); // pontas 3 e 5
  assert.ok(lm.some((m) => tileKey(m.tile) === '2-5' && m.side === 'R'));
  assert.ok(lm.some((m) => tileKey(m.tile) === '1-3' && m.side === 'L'));
  assert.ok(!lm.some((m) => tileKey(m.tile) === '0-6'));
  assert.strictEqual(canPlay([[0, 6]], [3, 5]), false);

  // vazio
  const p0 = place([], [null, null], [3, 5], 'L');
  assert.deepStrictEqual(p0.ends, [3, 5]);
  // encaixe na direita (R=5): [5,2] orienta e ponta vira 2
  const p1 = place(p0.chain, p0.ends, [5, 2], 'R');
  assert.deepStrictEqual(p1.ends, [3, 2]);
  // encaixe na esquerda (L=3): [1,3] → ponta vira 1
  const p2 = place(p1.chain, p1.ends, [1, 3], 'L');
  assert.deepStrictEqual(p2.ends, [1, 2]);
  // ilegal
  assert.strictEqual(place(p2.chain, p2.ends, [4, 6], 'L'), null);
  ok('encaixe: pontas certas, orientação certa, jogada ilegal barrada');
}

// ---------- jogar / bater ----------
{
  const st = {
    players: 2, hands: [[[3, 4]], [[1, 1], [2, 2]]], chain: [[5, 3]], ends: [5, 4],
    turn: 0, passes: 0, buried: [], over: false, winner: null, reason: null,
  };
  const next = playTile(st, 0, [3, 4], 'R'); // R=4 → bate (esvazia a mão)
  assert.strictEqual(next.over, true);
  assert.strictEqual(next.winner, 0);
  assert.strictEqual(next.reason, 'batida');
  // jogada fora da vez não faz nada
  assert.strictEqual(playTile(st, 1, [1, 1], 'L'), st);
  ok('jogar: encaixe válido atualiza a mão e bater encerra a partida');
}

// ---------- trancar ----------
{
  let st = {
    players: 2, hands: [[[0, 0]], [[6, 6]]], chain: [[3, 3]], ends: [3, 3],
    turn: 0, passes: 0, buried: [], over: false, winner: null, reason: null,
  };
  // ninguém encaixa em [3,3]
  st = pass(st, 0);
  assert.strictEqual(st.passes, 1);
  assert.strictEqual(st.turn, 1);
  st = pass(st, 1);
  assert.strictEqual(st.over, true);
  assert.strictEqual(st.reason, 'trancou');
  assert.strictEqual(st.winner, 0); // 0 pontos < 12 pontos
  ok('trancar: todos passam → ganha a menor soma de pontos');
}
{
  // não pode passar tendo encaixe
  const st = {
    players: 2, hands: [[[3, 4]], [[1, 2]]], chain: [[5, 3]], ends: [5, 4],
    turn: 0, passes: 0, buried: [], over: false, winner: null, reason: null,
  };
  assert.strictEqual(pass(st, 0), st); // tem encaixe (4) → passe é no-op
  ok('passe: não pode passar quando há encaixe');
}

// ---------- partida nova (abertura forçada) ----------
{
  const g = newGame(4, rngFrom(42));
  assert.strictEqual(g.chain.length, 1);         // a carroça de abertura já entrou
  assert.strictEqual(g.passes, 0);
  assert.ok(g.turn >= 0 && g.turn < 4);
  const inHands = g.hands.reduce((a, h) => a + h.length, 0);
  assert.strictEqual(inHands + g.chain.length + g.buried.length, 28); // conserva as pedras
  ok('partida nova: abre com a maior carroça e conserva as 28 pedras');
}

// ---------- mesa verificada (commit-to-deck + corte coletivo) ----------
{
  assert.strictEqual(serializeTiles([[6, 6], [0, 3]]), '66,03');
  assert.strictEqual(isFullSet(FULL_SET), true);
  assert.strictEqual(isFullSet(FULL_SET.slice(0, 27)), false);          // faltando pedra
  assert.strictEqual(isFullSet([...FULL_SET.slice(0, 27), [0, 0]]), false); // 0-0 repetido
  const c1 = cutDeck(FULL_SET, 'abc123def'), c2 = cutDeck(FULL_SET, 'abc123def');
  assert.deepStrictEqual(c1, c2);              // corte determinístico
  assert.strictEqual(isFullSet(c1), true);     // conserva as 28 pedras
  ok('verificada: serialização, permutação e corte determinístico');
}
{
  const a = await combineSeeds({ ana: 'aa', bia: 'bb' });
  const b = await combineSeeds({ bia: 'bb', ana: 'aa' });   // ordem de inserção não importa
  assert.strictEqual(a, b);
  assert.notStrictEqual(a, await combineSeeds({ ana: 'aa', bia: 'XX' }));
  ok('verificada: corte coletivo é determinístico e ordena os seeds');
}
{
  // deal honesto passa; adulterar QUALQUER coisa é pego
  const players = 2;
  const seeds = { ana: 'seedA', bia: 'seedB' };
  const seedCommits = {};
  for (const id of Object.keys(seeds)) seedCommits[id] = await sha256Hex(seeds[id]);
  const deck = shuffle(FULL_SET, rngFrom(777));  // baralho do "dono"
  const salt = 'saltZ';
  const dc = await deckCommit(deck, salt);
  const F = cutDeck(deck, await combineSeeds(seeds));
  const { hands } = dealFromDeck(F, players);

  assert.strictEqual((await verifyDeal({ deck, salt, deckCommit: dc, seeds, seedCommits, players, initialHands: hands })).ok, true);
  // lacre do baralho trocado
  assert.strictEqual((await verifyDeal({ deck, salt, deckCommit: 'deadbeef', seeds, seedCommits, players, initialHands: hands })).ok, false);
  // pedra trocada no baralho revelado (lacre não bate)
  const deck2 = deck.map((t) => t.slice()); deck2[0] = [6, 6]; deck2[1] = [6, 6];
  assert.strictEqual((await verifyDeal({ deck: deck2, salt, deckCommit: dc, seeds, seedCommits, players, initialHands: hands })).ok, false);
  // seed adulterado (não bate com o commit)
  assert.strictEqual((await verifyDeal({ deck, salt, deckCommit: dc, seeds: { ana: 'OUTRO', bia: 'seedB' }, seedCommits, players, initialHands: hands })).ok, false);
  // dono deu ao assento 0 uma pedra que era da mesa (mão não confere com o baralho)
  const fake = hands.map((h) => h.slice()); fake[0] = fake[0].slice(); fake[0][0] = F[F.length - 1];
  assert.strictEqual((await verifyDeal({ deck, salt, deckCommit: dc, seeds, seedCommits, players, initialHands: fake })).ok, false);
  ok('verificada: deal honesto passa; adulterar baralho/seed/mão é PEGO');
}

// ---------- layout serpentina: âncora no meio, cabe na largura em tamanho cheio, pip casa ----------
{
  const chainFrom = (seq) => seq.slice(0, -1).map((v, k) => [v, seq[k + 1]]); // consecutivas casam
  const touch = (A, B) => { const gx = Math.max(A.x, B.x) - Math.min(A.x + A.w, B.x + B.w); const gy = Math.max(A.y, B.y) - Math.min(A.y + A.h, B.y + B.h); return Math.min(gx, gy) <= 0 && Math.max(gx, gy) <= 2; };
  const overlaps = (T) => { for (let a = 0; a < T.length; a++) for (let b = a + 1; b < T.length; b++) { const P = T[a], Q = T[b]; const ox = Math.min(P.x + P.w, Q.x + Q.w) - Math.max(P.x, Q.x); const oy = Math.min(P.y + P.h, Q.y + Q.h) - Math.max(P.y, Q.y); if (ox > 2 && oy > 2) return `${P.idx}×${Q.idx}`; } return null; };
  const seq = [6, 6, 2, 5, 5, 3, 1, 1, 4, 0, 0, 4, 2, 6, 3, 3, 5, 1, 0, 0, 6, 4, 4, 2, 3]; // 24 pedras COM buchas
  const chain = chainFrom(seq);
  assert.strictEqual(chain.length, 24);
  for (let k = 0; k + 1 < chain.length; k++) assert.strictEqual(chain[k][1], chain[k + 1][0]); // casa pip

  const lay = snakeLayout(chain, { width: 360, long: 66, short: 34, pad: 8 });
  assert.strictEqual(lay.tiles.length, 24);                                   // toda pedra desenhada
  assert.deepStrictEqual(lay.tiles.map((t) => t.idx).sort((a, b) => a - b), Array.from({ length: 24 }, (_, k) => k));
  for (const t of lay.tiles) if (t.a === t.b) assert.strictEqual(t.vert, true, 'bucha é sempre EM PÉ');
  for (const t of lay.tiles) { assert.ok(t.x >= -1 && t.y >= -1); assert.ok(t.x + t.w <= lay.width + 1 && t.y + t.h <= lay.height + 1, 'pedra vaza os limites'); }
  assert.ok(lay.width <= 360 + 1, 'serpenteia pra caber na largura em TAMANHO CHEIO (não estoura)');
  assert.strictEqual(overlaps(lay.tiles), null, 'pedras não se sobrepõem');
  const byIdx = new Map(lay.tiles.map((t) => [t.idx, t]));                    // continuidade: vizinhas se encostam
  for (let k = 0; k + 1 < 24; k++) assert.ok(touch(byIdx.get(k), byIdx.get(k + 1)), `pedras ${k} e ${k + 1} não se encostam (junta torta)`);
  ok('serpente: 24 pedras 1×, buchas em pé, cabe na largura cheia, sem sobrepor, pip casa em toda junta');

  // âncora = a maior carroça no MEIO (corrente com o 6|6 no centro → os dois braços crescem pra fora)
  const midSeq = [2, 0, 0, 3, 3, 5, 6, 6, 4, 1, 1, 2];
  const midLay = snakeLayout(chainFrom(midSeq), { width: 340, long: 66, short: 34, pad: 6 });
  const A = midLay.tiles.find((t) => t.idx === midLay.anchor);
  assert.ok(A.a === 6 && A.b === 6, 'âncora é a maior carroça (abertura)');
  assert.ok(Math.abs((A.x + A.w / 2) - midLay.width / 2) < midLay.width * 0.3, 'abertura fica no MEIO (não na borda)');

  const portrait = snakeLayout(chain, { width: 360 }), landscape = snakeLayout(chain, { width: 820 });
  assert.ok(portrait.height > landscape.height, 'retrato cresce mais pra baixo que o deitado');
  assert.strictEqual(snakeLayout([], {}).tiles.length, 0);                    // vazio não quebra
  assert.strictEqual(snakeLayout([[3, 5]], {}).tiles.length, 1);              // 1 pedra ok
  ok('serpente: âncora (abertura) no meio; retrato mais alto que deitado; vazio e 1 pedra ok');
}

// ---------- BUCHA NO CANTO: a bucha entra ATRAVESSADA, nunca torta na quina (regressão do André) ----------
{
  // André montou o dominó de verdade em casa: a bucha 3/3 tem que ENTRAR ATRAVESSADA (a corrente passa
  // RETO por ela) — NUNCA no canto da quina, onde uma bucha encaixa TORTA (a linha sairia pelo LADO dela).
  // Corrente dele: 1-3 3-3 3-4 4-6 6-6(âncora) 6-5 5-0 0-4 4-5 5-1 — o 3-3 vive no braço de trás e, nas
  // larguras de RETRATO de celular, calhava de canto. "O que está ao lado do 3-3 são o 1-3 e 3-4" (ele):
  // os três empilham numa COLUNA reta (1-3 · 3-3 · 3-4), não num "L".
  const chainFrom = (seq) => seq.slice(0, -1).map((v, k) => [v, seq[k + 1]]);
  const andre = chainFrom([1, 3, 3, 4, 6, 6, 5, 0, 4, 5, 1]);
  const cxc = (t) => t.x + t.w / 2, cyc = (t) => t.y + t.h / 2;
  for (const W of [280, 300, 320, 340, 360]) {                 // faixa de retrato (onde ele viu o 3/3 torto)
    const lay = snakeLayout(andre, { width: W, long: 66, short: 34, pad: 8 });
    const byIdx = new Map(lay.tiles.map((t) => [t.idx, t]));
    const b = byIdx.get(1), p = byIdx.get(0), s = byIdx.get(2); // o 3-3 e os vizinhos 1-3 / 3-4
    assert.ok(b.a === 3 && b.b === 3 && b.vert, `3-3 é bucha em pé (W=${W})`);
    // ATRAVESSADA: os DOIS vizinhos também EM PÉ, na MESMA coluna (mesmo x) e um ACIMA/outro ABAIXO → a
    // corrente sobe reto pela bucha. No bug o 3-3 era o CANTO: o 1-3 vinha DEITADO saindo de lado (junta torta).
    assert.ok(p.vert && s.vert, `vizinhos do 3-3 em pé (não de lado) — o 3-3 não é o canto da quina (W=${W})`);
    assert.ok(Math.abs(cxc(p) - cxc(b)) < 2 && Math.abs(cxc(s) - cxc(b)) < 2, `1-3 · 3-3 · 3-4 na MESMA coluna (W=${W})`);
    assert.ok((cyc(p) - cyc(b)) * (cyc(s) - cyc(b)) < 0, `1-3 e 3-4 flanqueiam o 3-3 (um acima, um abaixo) (W=${W})`);
  }
  ok('serpente: regressão do André — a bucha 3/3 entra ATRAVESSADA (coluna reta 1-3·3-3·3-4), nunca torta no canto');
}

// ---------- ESTABILIDADE: jogar numa ponta NÃO move as pedras já postas (regressão do André) ----------
{
  // a queixa do André: o tabuleiro re-fluía a cada jogada. Ancorado na abertura, cada ponta cresce
  // pra fora e pedra colocada NÃO sai do lugar (relativo à âncora). Só girar o aparelho re-arruma.
  const chainFrom = (seq) => seq.slice(0, -1).map((v, k) => [v, seq[k + 1]]);
  const key = (t) => Math.min(t.a, t.b) + '|' + Math.max(t.a, t.b);
  const isD = (t) => t[0] === t[1];
  // corAentes VÁLIDAS (cada pedra 1×), com a abertura (6|6) no MEIO → crescem pros dois lados:
  const seqs = [
    [2, 0, 0, 3, 3, 5, 6, 6, 4, 1, 1, 2],                            // braços curtos e balanceados
    [4, 0, 6, 4, 1, 6, 2, 0, 5, 6, 6, 3, 2, 5, 3, 3, 4, 5],          // 4p real, 17 pedras
    [3, 1, 1, 4, 4, 0, 0, 2, 2, 6, 6, 5, 5, 3],                      // buchas a cada 2 (0|0,1|1,2|2,4|4,5|5,6|6)
  ];
  for (const seq of seqs) {
    const full = chainFrom(seq);
    let A = 0, best = -1; for (let k = 0; k < full.length; k++) if (isD(full[k]) && full[k][0] > best) { best = full[k][0]; A = k; }
    const seen = new Map();
    // cresce a partir da âncora, expandindo [lo..hi] UMA ponta por vez (as duas alternadas)
    for (let lo = A, hi = A, step = 0; lo > 0 || hi < full.length - 1; step++) {
      const canLo = lo > 0, canHi = hi < full.length - 1;
      if (canLo && (step % 2 === 0 || !canHi)) lo--; else hi++;
      const sub = full.slice(lo, hi + 1);
      const lay = snakeLayout(sub, { width: 340, long: 66, short: 34, pad: 6, anchor: A - lo });
      const anc = lay.tiles.find((t) => t.idx === A - lo);
      for (const t of lay.tiles) {
        const k = key(t), rel = `${Math.round(t.x - anc.x)},${Math.round(t.y - anc.y)}`;
        if (seen.has(k)) assert.strictEqual(seen.get(k), rel, `pedra ${k} RE-FLUIU (mudou de lugar ao crescer a corrente)`);
        else seen.set(k, rel);
      }
    }
  }
  ok('serpente: ESTÁVEL — jogar numa ponta não move nenhuma pedra já posta (só girar re-arruma)');
}

console.log(`\n${passed} testes de dominó passaram ✅`);
