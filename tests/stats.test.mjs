// Testes de consciência/ritmo (stats.js) e estatísticas de vida (lifestats.js), sem deps.
// Rodar: node tests/stats.test.mjs

import assert from 'node:assert';
import { DEFAULT_ITEMS, catOf, CATEGORIES } from '../js/catalog.js';
import { paceInfo, timeline, estimateBAC } from '../js/stats.js';
import { weekStreak, lifeStats, lifeBadges, monthlyTrend, weekdayInsight } from '../js/lifestats.js';

let passed = 0;
const ok = (n) => { console.log('  ✓ ' + n); passed++; };
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

const resolve = (id) => DEFAULT_ITEMS.find((i) => i.id === id) || { id, g: 0 };
const ADD = (user, item, ts) => ({ type: 'ADD', user, item, ts, eventId: user + item + ts });
const REM = (user, item, ts) => ({ type: 'REMOVE', user, item, ts, eventId: 'r' + user + item + ts });
const H = 3600000;

// ---------- Ritmo ----------
{
  const now = 5 * H;
  const log = [
    ADD('me', 'cerveja', 0),          // 5h atrás
    ADD('me', 'cerveja', 1 * H),      // 4h atrás
    ADD('me', 'cerveja', now - 1800000), // 30min
    ADD('me', 'cerveja', now - 600000),  // 10min
    ADD('me', 'cerveja', now - 300000),  // 5min
    ADD('other', 'cerveja', now - 60000), // não é meu
  ];
  const p = paceInfo(log, 'me', resolve, { now });
  assert.strictEqual(p.count, 5);
  assert.strictEqual(p.grams, 65); // 5 × 13g
  assert.strictEqual(p.recent, 3); // últimas 3 dentro de 1h
  assert.strictEqual(p.firstTs, 0);
  assert.strictEqual(p.level, 'medio'); // 3 na última hora
  ok('ritmo: conta total, gramas, "última hora" e nível');

  const p2 = paceInfo([...log, REM('me', 'cerveja', now - 120000)], 'me', resolve, { now });
  assert.strictEqual(p2.count, 4);
  assert.strictEqual(p2.recent, 2); // remove abateu uma da última hora
  ok('ritmo: REMOVE abate do total e da janela recente');

  // água não conta (0g)
  const p3 = paceInfo([ADD('me', 'agua', now - 100)], 'me', resolve, { now });
  assert.strictEqual(p3.count, 0);
  assert.strictEqual(p3.firstTs, 0);
  ok('ritmo: item sem álcool não entra');
}

// ---------- Linha do tempo ----------
{
  const now = 6000;
  const log = [ADD('me', 'cerveja', 0), ADD('me', 'cerveja', 500), ADD('me', 'cerveja', 1500), ADD('me', 'cerveja', 5500)];
  const t = timeline(log, 'me', resolve, { now, buckets: 6 });
  assert.strictEqual(t.bars.length, 6);
  assert.deepStrictEqual(t.bars, [2, 1, 0, 0, 0, 1]);
  assert.strictEqual(t.bars.reduce((a, b) => a + b, 0), 4);
  ok('timeline: distribui bebidas nas fatias certas');

  const empty = timeline([], 'me', resolve, { now, buckets: 6 });
  assert.deepStrictEqual(empty.bars, []);
  ok('timeline: sem bebidas → vazio');
}

// ---------- BAC (Widmark) ----------
{
  const now = 0;
  const log = [ADD('me', 'dose', 0)]; // 15g, na hora (metabolismo ~0)
  const b = estimateBAC(log, 'me', resolve, { now, weightKg: 75, sex: 'f' });
  assert.ok(close(b.bac, 15 / (0.55 * 75))); // 0.3636…
  assert.strictEqual(b.canDrive, false);
  assert.strictEqual(b.label, '🟠 alto');
  ok('BAC: Widmark com r feminino e pico sem metabolismo');

  const later = estimateBAC(log, 'me', resolve, { now: 3 * H, weightKg: 75, sex: 'f' });
  assert.ok(later.bac < b.bac); // 3h depois já metabolizou parte
  ok('BAC: cai com o tempo (β·horas)');

  assert.strictEqual(estimateBAC(log, 'me', resolve, { now, weightKg: 0 }), null);
  ok('BAC: sem peso → não estima (null)');
}

// ---------- Streak de semanas ----------
{
  const WEEK = 7 * 864e5;
  const now = 100 * WEEK + 3 * 864e5; // meio de uma semana
  const hist = [{ at: now }, { at: now - WEEK }, { at: now - 2 * WEEK }, { at: now - 4 * WEEK }];
  assert.strictEqual(weekStreak(hist, now), 3);
  ok('streak: 3 semanas seguidas (gap quebra o resto)');

  // sem visita nesta semana, mas na passada e retrasada → 2 (semana em curso não quebra)
  const hist2 = [{ at: now - WEEK }, { at: now - 2 * WEEK }];
  assert.strictEqual(weekStreak(hist2, now), 2);
  ok('streak: semana em curso sem ida ainda não zera');

  assert.strictEqual(weekStreak([], now), 0);
  ok('streak: histórico vazio → 0');
}

// ---------- Estatísticas de vida ----------
{
  const now = Date.UTC(2026, 6, 2); // 2 jul 2026
  const hist = [
    { room: 'A', at: now, myTotal: 5, myMoney: 30, items: { cerveja: 5 } },
    { room: 'B', at: now - 40 * 864e5, myTotal: 10, myMoney: 80, items: { chopp: 10, cerveja: 2 } },
  ];
  const s = lifeStats(hist, { now });
  assert.strictEqual(s.nights, 2);
  assert.strictEqual(s.totalDrinks, 15);
  assert.strictEqual(s.record.total, 10);
  assert.strictEqual(s.thisMonth, 5); // só a mesa deste mês
  assert.ok(close(s.avgPerNight, 7.5));
  assert.strictEqual(s.favDrink, 'chopp'); // 10 chopp > 7 cerveja
  assert.strictEqual(s.totalSpent, 110);
  ok('lifeStats: noites, total, recorde, mês, média, favorita, gasto');
}

// ---------- Conquistas acumuladas ----------
{
  const b = lifeBadges({ nights: 6, totalDrinks: 120, record: { total: 12 }, streakWeeks: 4 });
  const ids = b.map((x) => x.id);
  assert.ok(ids.includes('goer1') && ids.includes('goer5'));
  assert.ok(!ids.includes('goer15')); // < 15 noites
  assert.ok(ids.includes('rec10') && ids.includes('streak3') && ids.includes('d100'));
  ok('lifeBadges: destrava conforme os números');
}

// ---------- Categorias do cardápio ----------
{
  assert.strictEqual(catOf({ cat: 'destilado' }), 'destilado');
  assert.strictEqual(catOf({ cat: 'xxx' }), 'outros'); // categoria desconhecida cai em "outros"
  assert.strictEqual(catOf({}), 'outros');
  assert.strictEqual(CATEGORIES[CATEGORIES.length - 1].id, 'outros');
  assert.strictEqual(DEFAULT_ITEMS.find((i) => i.id === 'dose').cat, 'destilado');
  ok('categorias: catOf normaliza e itens padrão têm categoria');
}

// ---------- Tendência mensal ----------
{
  const now = Date.UTC(2026, 6, 15); // jul/2026
  const hist = [
    { at: now, myTotal: 5 },
    { at: Date.UTC(2026, 5, 10), myTotal: 3 },  // jun
    { at: Date.UTC(2026, 4, 1), myTotal: 2 },   // mai
    { at: Date.UTC(2026, 0, 1), myTotal: 99 },  // jan (fora da janela de 3)
  ];
  const t = monthlyTrend(hist, { now, months: 3 });
  assert.deepStrictEqual(t.map((x) => x.label), ['mai', 'jun', 'jul']);
  assert.deepStrictEqual(t.map((x) => x.total), [2, 3, 5]);
  ok('tendência mensal: soma por mês, janela e ordem certas');
}

// ---------- Insight por dia da semana ----------
{
  const hist = [
    { at: Date.UTC(2026, 0, 6), myTotal: 1 },   // mesma semana-dia
    { at: Date.UTC(2026, 0, 13), myTotal: 3 },  // +7 dias => mesmo dia da semana (média 2)
    { at: Date.UTC(2026, 0, 3), myTotal: 10 },  // outro dia (média 10)
  ];
  const ins = weekdayInsight(hist);
  assert.strictEqual(ins.best.avg, 2);
  assert.strictEqual(ins.worst.avg, 10);
  assert.notStrictEqual(ins.best.wd, ins.worst.wd);
  ok('insight: dia mais leve vs mais pesado por média');
}

console.log(`\n${passed} testes de stats/lifestats passaram ✅`);
