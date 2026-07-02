// Testes do dominó (js/domino.js) — lógica pura. Sem deps. Rodar: node tests/domino.test.mjs

import assert from 'node:assert';
import {
  FULL_SET, isDouble, pips, tileKey, pipCount, rngFrom, shuffle, handSizeFor, dealHands,
  opening, legalMoves, canPlay, place, newGame, playTile, pass,
  serializeTiles, deckCommit, combineSeeds, cutDeck, isFullSet, dealFromDeck, verifyDeal,
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
  assert.strictEqual(handSizeFor(4), 6);
  const { hands, buried } = dealHands(4, rngFrom(123));
  assert.strictEqual(hands.length, 4);
  assert.ok(hands.every((h) => h.length === 6));
  assert.strictEqual(buried.length, 4);
  const all = [...hands.flat(), ...buried];
  assert.strictEqual(all.length, 28);
  assert.strictEqual(new Set(all.map(tileKey)).size, 28); // ninguém recebe pedra repetida
  ok('distribuição: mãos e enterradas somam 28 pedras, sem repetição');
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

console.log(`\n${passed} testes de dominó passaram ✅`);
