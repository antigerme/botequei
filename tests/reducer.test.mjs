// Teste do reducer de eventos (sem dependencias): roda com `node tests/reducer.test.mjs`.
// Valida idempotencia, convergencia (ordem nao importa), clamp do remove e LWW dos itens.

import assert from 'node:assert';
import {
  emptyState, applyEvent, itemTotal, userTotal, tableTotal, getCount,
} from '../js/events.js';

let passed = 0;
function ok(name) { console.log('  ✓ ' + name); passed++; }

// helper: aplica uma lista com deduplicacao por eventId (como o app faz)
function build(events) {
  const state = emptyState();
  const seen = new Set();
  for (const ev of events) {
    if (seen.has(ev.eventId)) continue;
    seen.add(ev.eventId);
    applyEvent(state, ev);
  }
  return state;
}

const A = (id, user, item, ts) => ({ type: 'ADD', user, name: user, item, ts, eventId: id });
const R = (id, user, item, ts) => ({ type: 'REMOVE', user, name: user, item, ts, eventId: id });

// 1) Convergencia: mesma soma independente da ordem
{
  const evs = [
    A('a1', 'andre', 'cerveja', 1),
    A('a2', 'andre', 'cerveja', 2),
    A('b1', 'bia', 'chopp', 3),
    R('a3', 'andre', 'cerveja', 4),
  ];
  const s1 = build(evs);
  const s2 = build([...evs].reverse());
  assert.strictEqual(itemTotal(s1, 'cerveja'), 1);
  assert.strictEqual(itemTotal(s2, 'cerveja'), 1);
  assert.strictEqual(tableTotal(s1), tableTotal(s2));
  assert.strictEqual(tableTotal(s1), 2);
  ok('convergencia: ordem nao altera os totais');
}

// 2) Idempotencia: evento repetido (mesmo eventId) nao conta duas vezes
{
  const s = build([
    A('dup', 'andre', 'cerveja', 1),
    A('dup', 'andre', 'cerveja', 1),
    A('dup', 'andre', 'cerveja', 1),
  ]);
  assert.strictEqual(itemTotal(s, 'cerveja'), 1);
  assert.strictEqual(userTotal(s, 'andre'), 1);
  ok('idempotencia: eventId repetido nao duplica');
}

// 3) Clamp: exibicao nunca fica negativa mesmo com remove "sobrando"
{
  const s = build([
    A('x1', 'bia', 'dose', 1),
    R('x2', 'bia', 'dose', 2),
    R('x3', 'bia', 'dose', 3),
  ]);
  assert.strictEqual(getCount(s, 'bia', 'dose'), 0);
  assert.strictEqual(tableTotal(s), 0);
  ok('clamp: contagem por usuario nunca exibe negativo');
}

// 4) Item personalizado com LWW (last-writer-wins por ts)
{
  const s = emptyState();
  applyEvent(s, { type: 'ITEM', def: { id: 'x-drink', emoji: '🍸', name: 'Drink', price: 10 }, ts: 1, eventId: 'i1' });
  applyEvent(s, { type: 'ITEM', def: { id: 'x-drink', emoji: '🍹', name: 'Drink', price: 15 }, ts: 5, eventId: 'i2' });
  applyEvent(s, { type: 'ITEM', def: { id: 'x-drink', emoji: '🥃', name: 'Drink', price: 99 }, ts: 3, eventId: 'i3' });
  assert.strictEqual(s.items.get('x-drink').def.price, 15); // ts=5 vence
  ok('item LWW: vence o de maior timestamp');
}

// 5) Atribuicao por usuario
{
  const s = build([
    A('m1', 'andre', 'cerveja', 1),
    A('m2', 'andre', 'chopp', 2),
    A('m3', 'bia', 'cerveja', 3),
  ]);
  assert.strictEqual(userTotal(s, 'andre'), 2);
  assert.strictEqual(userTotal(s, 'bia'), 1);
  assert.strictEqual(itemTotal(s, 'cerveja'), 2);
  ok('atribuicao: totais por usuario e por item batem');
}

console.log(`\n${passed} testes passaram ✅`);
