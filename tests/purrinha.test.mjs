// Testes da Purrinha (js/purrinha.js) — lógica pura + commit-reveal. Sem deps.
// Rodar: node tests/purrinha.test.mjs

import assert from 'node:assert';
import {
  clampHand, maxGuess, randomNonce, sha256Hex, commitString, makeCommit, verifyReveal, resolve,
  handCommitString, makeHandCommit, verifyHandReveal, validGuess, guessOrder, turnOf, classicRound, nextRound,
  validGuessTo, clampHandTo, poolsTotal, sticksNext, STICKS_START,
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

// ===================== Modo clássico (palitinho de verdade) =====================

// ---------- lacre só da mão (palpite é público no clássico) ----------
{
  assert.strictEqual(handCommitString(2, 'abc'), 'h:2:abc');
  assert.strictEqual(handCommitString(9, 'abc'), 'h:3:abc'); // mão clampada no lacre
  const nonce = randomNonce();
  const commit = await makeHandCommit(1, nonce);
  assert.strictEqual(await verifyHandReveal({ hand: 1, nonce, commit }), true);
  assert.strictEqual(await verifyHandReveal({ hand: 2, nonce, commit }), false); // mudou a mão → pega
  assert.strictEqual(await verifyHandReveal({ hand: 1, nonce: 'outro', commit }), false);
  ok('clássico: lacre da mão bate; mexer na mão depois falha');
}

// ---------- palpite: faixa + NÃO PODE REPETIR ----------
{
  assert.strictEqual(validGuess(0, 3, []), true);
  assert.strictEqual(validGuess(9, 3, []), true);    // 3 vivos → até 9
  assert.strictEqual(validGuess(10, 3, []), false);  // estourou
  assert.strictEqual(validGuess(-1, 3, []), false);
  assert.strictEqual(validGuess(2.5, 3, []), false); // só inteiro
  assert.strictEqual(validGuess(4, 3, [4]), false);  // repetido → proibido
  assert.strictEqual(validGuess(4, 3, ['4']), false); // repetido mesmo como string
  assert.strictEqual(validGuess(5, 3, [4, 6]), true);
  ok('clássico: palpite 0..3·vivos e nunca repetido');
}

// ---------- ordem de palpites gira a mesa ----------
{
  const alive = ['a', 'b', 'c', 'd'];
  assert.deepStrictEqual(guessOrder(alive, 0), ['a', 'b', 'c', 'd']);
  assert.deepStrictEqual(guessOrder(alive, 2), ['c', 'd', 'a', 'b']);
  assert.strictEqual(turnOf(alive, 1, []), 'b');           // ninguém falou → starter fala
  assert.strictEqual(turnOf(alive, 1, ['b', 'c']), 'd');   // já falaram b,c → vez do d
  assert.strictEqual(turnOf(alive, 1, ['b', 'c', 'd', 'a']), null); // todos falaram
  ok('clássico: palpites em turno, girando a partir do starter');
}

// ---------- apuração da rodada: cravou → se livra (no máx. 1 por rodada) ----------
{
  const r = classicRound(
    [{ id: 'a', hand: 1 }, { id: 'b', hand: 2 }, { id: 'c', hand: 0 }],
    [{ id: 'a', guess: 5 }, { id: 'b', guess: 3 }, { id: 'c', guess: 0 }],
  );
  assert.strictEqual(r.total, 3);
  assert.strictEqual(r.winnerId, 'b'); // cravou 3 → se livrou
  const r2 = classicRound([{ id: 'a', hand: 1 }, { id: 'b', hand: 1 }], [{ id: 'a', guess: 0 }, { id: 'b', guess: 3 }]);
  assert.strictEqual(r2.winnerId, null); // ninguém cravou → joga de novo
  ok('clássico: quem crava o total se livra; ninguém cravou → repete');
}

// ---------- eliminação + rotação do starter ----------
{
  // ninguém cravou: mesma mesa, starter gira pro próximo
  assert.deepStrictEqual(nextRound(['a', 'b', 'c', 'd'], 1, null), { alive: ['a', 'b', 'c', 'd'], startIdx: 2, loserId: null, done: false });
  // o próprio starter cravou: quem herdou a cadeira dele começa
  assert.deepStrictEqual(nextRound(['a', 'b', 'c', 'd'], 1, 'b'), { alive: ['a', 'c', 'd'], startIdx: 1, loserId: null, done: false });
  // outro cravou: gira pro próximo vivo depois do starter
  assert.deepStrictEqual(nextRound(['a', 'b', 'c', 'd'], 1, 'c'), { alive: ['a', 'b', 'd'], startIdx: 2, loserId: null, done: false });
  // sobrou um: ele paga
  assert.deepStrictEqual(nextRound(['a', 'b'], 0, 'a'), { alive: ['b'], startIdx: 0, loserId: 'b', done: true });
  ok('clássico: eliminação até sobrar um (que paga) + starter girando');
}

// ===================== Modo por palitos (3-2-1) =====================

// ---------- mão limitada ao estoque + teto = soma dos estoques ----------
{
  assert.strictEqual(STICKS_START, 3);
  assert.strictEqual(clampHandTo(3, 3), 3);
  assert.strictEqual(clampHandTo(3, 1), 1);  // só tem 1 palito → esconde no máx. 1
  assert.strictEqual(clampHandTo(2, 0), 0);
  assert.strictEqual(clampHandTo(-1, 2), 0);
  const pools = [{ id: 'a', sticks: 2 }, { id: 'b', sticks: 3 }, { id: 'c', sticks: 0 }];
  assert.strictEqual(poolsTotal(pools), 5); // quem zerou não conta
  assert.strictEqual(validGuessTo(5, 5, []), true);
  assert.strictEqual(validGuessTo(6, 5, []), false); // acima do teto da mesa
  assert.strictEqual(validGuessTo(4, 5, [4]), false); // repetido segue proibido
  ok('3-2-1: mão ≤ estoque, teto = soma dos estoques, sem repetir');
}

// ---------- cravou descarta; quem cravou fala primeiro ----------
{
  const pools = [{ id: 'a', sticks: 3 }, { id: 'b', sticks: 3 }, { id: 'c', sticks: 3 }];
  // ninguém cravou: estoques iguais, starter gira (b era o starter → c fala)
  assert.deepStrictEqual(sticksNext(pools, 1, null), {
    pools, alive: ['a', 'b', 'c'], startIdx: 2, loserId: null, freedId: null, done: false,
  });
  // c cravou: desce 3→2 e FALA PRIMEIRO na próxima
  const r = sticksNext(pools, 1, 'c');
  assert.deepStrictEqual(r.pools, [{ id: 'a', sticks: 3 }, { id: 'b', sticks: 3 }, { id: 'c', sticks: 2 }]);
  assert.strictEqual(r.startIdx, 2); // índice do c entre os vivos
  assert.strictEqual(r.freedId, null);
  assert.strictEqual(r.done, false);
  ok('3-2-1: cravou descarta 1 palito e fala primeiro na rodada seguinte');
}

// ---------- zerou → se livrou (herda a cadeira); último com palitos paga ----------
{
  const pools = [{ id: 'a', sticks: 1 }, { id: 'b', sticks: 2 }, { id: 'c', sticks: 3 }];
  // a cravou com 1 palito: zera, sai; quem herdou a cadeira dele (b) fala primeiro
  const r = sticksNext(pools, 0, 'a');
  assert.deepStrictEqual(r.alive, ['b', 'c']);
  assert.strictEqual(r.freedId, 'a');
  assert.strictEqual(r.startIdx, 0); // b herdou o assento 0 dos vivos
  assert.strictEqual(r.done, false);
  // sobrou um: b zera → só c tem palito → c paga
  const end = sticksNext([{ id: 'b', sticks: 1 }, { id: 'c', sticks: 2 }], 0, 'b');
  assert.deepStrictEqual(end, {
    pools: [{ id: 'b', sticks: 0 }, { id: 'c', sticks: 2 }],
    alive: ['c'], startIdx: 0, loserId: 'c', freedId: 'b', done: true,
  });
  ok('3-2-1: zerou se livrou (cadeira herdada); o último com palitos paga');
}

console.log(`\n${passed} testes de purrinha passaram ✅`);
