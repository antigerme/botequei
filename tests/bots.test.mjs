// Testes dos cérebros dos bots (puros, determinísticos com rng semeado).
// Rodar: node tests/bots.test.mjs

import assert from 'node:assert';
import {
  BOT_ROSTER, isBot, botProfile, pickBots, makeRng,
  botPurrHand, botPurrGuess, botDominoMove,
  botTrucoHandStrength, botTrucoPlay, botTrucoRespondRaise, botTrucoWantRaise, botTrucoOnze,
} from '../js/bots.js';
import { parseCard } from '../js/truco.js';

let passed = 0;
const ok = (n) => { console.log('  ✓ ' + n); passed++; };

// ---------- elenco ----------
{
  assert.ok(BOT_ROSTER.length >= 3, 'elenco tem gente');
  assert.ok(BOT_ROSTER.every((b) => b.id.startsWith('bot-') && b.name && b.emoji), 'todo bot tem id/nome/cara');
  assert.ok(isBot('bot-ze') && !isBot('andre') && !isBot(null), 'isBot só pega bot-*');
  assert.strictEqual(botProfile('bot-ze').name, 'Zé da Esquina');
  assert.strictEqual(botProfile('ninguem'), null);
  assert.deepStrictEqual(pickBots(2), [BOT_ROSTER[0].id, BOT_ROSTER[1].id]);
  assert.strictEqual(pickBots(99).length, BOT_ROSTER.length, 'não passa do elenco');
  assert.strictEqual(pickBots(0).length, 0);
  ok('elenco: ids estáveis, profile, pickBots com teto');
}

// ---------- rng determinístico ----------
{
  const a = makeRng(42), b = makeRng(42);
  const seqA = [a(), a(), a()], seqB = [b(), b(), b()];
  assert.deepStrictEqual(seqA, seqB, 'mesma semente = mesma sequência');
  assert.ok(seqA.every((x) => x >= 0 && x < 1), 'saída em [0,1)');
  ok('rng: semeável e determinístico');
}

// ---------- purrinha ----------
{
  const rng = makeRng(7);
  for (let i = 0; i < 200; i++) { const h = botPurrHand(3, rng); assert.ok(h >= 0 && h <= 3, 'mão 0..3'); }
  assert.strictEqual(botPurrHand(0, rng), 0, 'estoque 0 → mão 0');
  for (let i = 0; i < 50; i++) { const h = botPurrHand(2, rng); assert.ok(h >= 0 && h <= 2, 'respeita o teto do estoque'); }
  ok('purrinha: mão dentro de [0, maxHand]');

  // palpite dentro da faixa e nunca repetido
  const r2 = makeRng(3);
  for (let i = 0; i < 200; i++) {
    const taken = [2, 4, 5];
    const g = botPurrGuess({ ownHand: 2, nPlayers: 3, ceil: 9, taken, rng: r2 });
    assert.ok(g >= 0 && g <= 9, 'palpite na faixa');
    assert.ok(!taken.includes(g), 'não repete número falado');
  }
  ok('purrinha: palpite válido e inédito (foge dos falados)');
}

// ---------- dominó ----------
{
  const rng = makeRng(11);
  // uma jogada legal só → escolhe ela
  const only = botDominoMove({ moves: [{ tile: [3, 5], side: 'L' }], hand: [[3, 5]], rng });
  assert.deepStrictEqual(only.tile, [3, 5]);
  // entre pesada e leve, tende à pesada (descarta peso)
  let heavy = 0;
  for (let i = 0; i < 100; i++) {
    const m = botDominoMove({ moves: [{ tile: [6, 6], side: 'L' }, { tile: [0, 1], side: 'R' }], hand: [[6, 6], [0, 1]], rng });
    if (m.tile[0] === 6) heavy++;
  }
  assert.ok(heavy > 70, 'prefere descartar a carroça pesada (' + heavy + '/100)');
  assert.strictEqual(botDominoMove({ moves: [], hand: [], rng }), null, 'sem jogada → null (protocolo passa)');
  ok('dominó: escolhe legal, descarta peso, null quando trancado');
}

// ---------- truco ----------
{
  const vira = null;
  // mão de manilhas (paulista, sem vira → sem manilha; usa mão espada/copas forte)
  const top = ['3:paus', '2:copas', '3:ouros'].map(parseCard);
  const trash = ['4:ouros', '5:ouros', '6:ouros'].map(parseCard);
  const sTop = botTrucoHandStrength(top, 'paulista', vira);
  const sTrash = botTrucoHandStrength(trash, 'paulista', vira);
  assert.ok(sTop > sTrash, 'mão forte pontua mais que lixo');
  assert.ok(sTop >= 0 && sTop <= 1 && sTrash >= 0 && sTrash <= 1, 'força normalizada 0..1');
  ok('truco: força da mão normalizada e ordenada');

  // jogar: liderando, não gasta a maior; seguindo, vence com a menor que basta
  const myCards = ['4:ouros', 'K:paus', '3:espadas'].map(parseCard);
  const lead = botTrucoPlay({ myCards, vaza: [], variant: 'paulista', vira, rng: makeRng(1) });
  assert.ok(lead && lead.r !== '3', 'no lead não joga logo a mais forte');
  // seguindo um 'K': tem que cobrir com o 3 (única que vence), não com o 4
  const follow = botTrucoPlay({ myCards, vaza: [{ p: 'x', card: 'K:ouros' }], variant: 'paulista', vira, rng: makeRng(1) });
  assert.strictEqual(follow.r, '3', 'cobre com a menor carta que vence');
  // não dá pra vencer → sacrifica a mais fraca
  const sac = botTrucoPlay({ myCards: ['4:ouros', '5:ouros'].map(parseCard), vaza: [{ p: 'x', card: '3:paus' }], variant: 'paulista', vira, rng: makeRng(1) });
  assert.strictEqual(sac.r, '4', 'não vencendo, joga a mais fraca');
  ok('truco: escolhe carta com lógica de vaza (cobre barato / sacrifica)');

  // apostas: mão forte tende a aceitar/subir; lixo tende a correr
  let foldsTrash = 0, keepsTop = 0;
  for (let i = 0; i < 300; i++) {
    if (botTrucoRespondRaise({ strength: 0.1, rng: makeRng(1000 + i) }) === 'fold') foldsTrash++;
    if (botTrucoRespondRaise({ strength: 0.8, rng: makeRng(5000 + i) }) !== 'fold') keepsTop++;
  }
  assert.ok(foldsTrash > 240, 'mão fraca corre na maioria (' + foldsTrash + '/300)');
  assert.ok(keepsTop > 260, 'mão forte raramente corre (' + keepsTop + '/300)');
  assert.strictEqual(typeof botTrucoWantRaise({ strength: 0.9, rng: makeRng(2) }), 'boolean');
  assert.strictEqual(botTrucoOnze({ strength: 0.7, rng: makeRng(2) }), true, 'onze com mão boa: joga');
  ok('truco: responde/pede aposta coerente com a força');
}

console.log(`\n${passed} testes dos bots passaram ✅`);
