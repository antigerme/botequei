// Testes da Purrinha (js/purrinha.js) — lógica pura + commit-reveal. Sem deps.
// Rodar: node tests/purrinha.test.mjs

import assert from 'node:assert';
import {
  clampHand, maxGuess, randomNonce, sha256Hex, commitString, makeCommit, verifyReveal, resolve,
} from '../js/purrinha.js';

let passed = 0;
const ok = (n) => { console.log('  ✓ ' + n); passed++; };

// ---------- mão e faixa de palpite ----------
{
  assert.strictEqual(clampHand(-2), 0);
  assert.strictEqual(clampHand(0), 0);
  assert.strictEqual(clampHand(3), 3);
  assert.strictEqual(clampHand(9), 3);
  assert.strictEqual(clampHand(1.9), 1);
  assert.strictEqual(clampHand('2'), 2);
  assert.strictEqual(maxGuess(3), 9);   // 3 pessoas -> palpites de 0 a 9
  assert.strictEqual(maxGuess(1), 3);
  ok('mão fica em 0..3 e palpite vai de 0 a 3·N');
}

// ---------- lacre determinístico + segredo ----------
{
  assert.strictEqual(commitString(2, 5, 'abc'), '2:5:abc');
  assert.strictEqual(commitString(9, 5, 'abc'), '3:5:abc'); // mão clampada no lacre
  const n = randomNonce();
  assert.match(n, /^[0-9a-f]{32}$/); // 128 bits em hex
  assert.notStrictEqual(randomNonce(), randomNonce()); // aleatório
  ok('lacre: string canônica + segredo de 128 bits aleatório');
}

// ---------- commit-reveal honesto ----------
{
  const nonce = randomNonce();
  const commit = await makeCommit(2, 5, nonce);
  assert.match(commit, /^[0-9a-f]{64}$/);           // SHA-256 hex
  assert.strictEqual(commit, await sha256Hex(`2:5:${nonce}`));
  // revelação correta confere
  assert.strictEqual(await verifyReveal({ hand: 2, guess: 5, nonce, commit }), true);
  // trapaça: mudar a mão depois de lacrar NÃO passa
  assert.strictEqual(await verifyReveal({ hand: 3, guess: 5, nonce, commit }), false);
  // trapaça: mudar o palpite depois de ver os outros NÃO passa
  assert.strictEqual(await verifyReveal({ hand: 2, guess: 6, nonce, commit }), false);
  assert.strictEqual(await verifyReveal({ hand: 2, guess: 5, nonce: 'outro', commit }), false);
  ok('commit-reveal: revelação certa bate; mexer na mão/palpite depois falha');
}

// ---------- apuração ----------
{
  // mãos 1+2+0 = 3. Ana cravou 3 (vidente). Bia chutou 1 (dist 2). Caio chutou 7 (dist 4 -> paga).
  const r = resolve([
    { id: 'ana', hand: 1, guess: 3 },
    { id: 'bia', hand: 2, guess: 1 },
    { id: 'caio', hand: 0, guess: 7 },
  ]);
  assert.strictEqual(r.total, 3);
  assert.deepStrictEqual(r.seers, ['ana']);
  assert.strictEqual(r.loserId, 'caio');
  ok('apura: soma as mãos, acha o vidente e quem paga (mais longe)');
}
{
  // empate na distância: menor id paga (determinístico em todo peer)
  // total = 2. "ana" chuta 0 (dist 2), "zoe" chuta 4 (dist 2). Menor id = "ana".
  const r = resolve([
    { id: 'zoe', hand: 1, guess: 4 },
    { id: 'ana', hand: 1, guess: 0 },
  ]);
  assert.strictEqual(r.total, 2);
  assert.deepStrictEqual(r.seers, []);
  assert.strictEqual(r.loserId, 'ana');
  ok('apura: empate de distância desempata pelo menor id (converge)');
}
{
  // ordem dos reveals não muda o resultado (todo peer chega igual)
  const a = resolve([{ id: 'x', hand: 3, guess: 5 }, { id: 'y', hand: 2, guess: 0 }]);
  const b = resolve([{ id: 'y', hand: 2, guess: 0 }, { id: 'x', hand: 3, guess: 5 }]);
  assert.deepStrictEqual(a, b);
  ok('apura: independe da ordem de chegada dos reveals');
}
{
  // todo mundo cravou -> ninguém paga, geral é vidente
  const r = resolve([
    { id: 'a', hand: 1, guess: 3 },
    { id: 'b', hand: 2, guess: 3 },
    { id: 'c', hand: 0, guess: 3 },
  ]);
  assert.strictEqual(r.total, 3);
  assert.deepStrictEqual(r.seers.sort(), ['a', 'b', 'c']);
  assert.strictEqual(r.loserId, null);
  ok('apura: todo mundo cravando o total = ninguém paga');
}

console.log(`\n${passed} testes de purrinha passaram ✅`);
