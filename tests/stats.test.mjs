// Testes de consciência/ritmo (stats.js) e estatísticas de vida (lifestats.js), sem deps.
// Rodar: node tests/stats.test.mjs

import assert from 'node:assert';
import { DEFAULT_ITEMS, catOf, CATEGORIES } from '../js/catalog.js';
import { paceInfo, timeline, estimateBAC, lastDrinkAt, hydration, driveVerdict } from '../js/stats.js';
import { weekStreak, lifeStats, lifeBadges, monthlyTrend, weekdayInsight, topMate, retro } from '../js/lifestats.js';
import { levelFor, weeklyChallenges, seasonAward } from '../js/league.js';

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

// ---------- Segurança: última dose / hidratação / veredito ----------
{
  const now = 10000;
  const log = [ADD('me', 'cerveja', 1000), ADD('me', 'cerveja', 3000), ADD('me', 'agua', 5000)];
  const ld = lastDrinkAt(log, 'me', resolve, { now });
  assert.strictEqual(ld.ts, 3000); // água (5000) não conta
  assert.strictEqual(ld.agoMs, 7000);
  assert.strictEqual(lastDrinkAt([ADD('me', 'agua', 1)], 'me', resolve, { now }), null);
  ok('última dose: ignora água, mede o tempo desde o último álcool');

  const h1 = hydration([ADD('me', 'cerveja', 1), ADD('me', 'cerveja', 2), ADD('me', 'cerveja', 3), ADD('me', 'cerveja', 4), ADD('me', 'agua', 5), ADD('me', 'agua', 6)], 'me', resolve);
  assert.strictEqual(h1.alc, 4); assert.strictEqual(h1.water, 2); assert.strictEqual(h1.level, 'good');
  assert.strictEqual(hydration([ADD('me', 'cerveja', 1)], 'me', resolve).level, 'low');
  assert.strictEqual(hydration([ADD('me', 'agua', 1)], 'me', resolve).level, 'none');
  ok('hidratação: razão água/álcool vira nível');

  assert.strictEqual(driveVerdict(null).level, 'unknown');
  assert.strictEqual(driveVerdict({ bac: 0.0 }).level, 'ok');
  assert.strictEqual(driveVerdict({ bac: 0.1 }).level, 'wait');
  assert.strictEqual(driveVerdict({ bac: 0.5 }).level, 'no');
  ok('veredito: dá pra dirigir? escala com o BAC');
}

// ---------- Liga: nível/XP, desafios, troféu ----------
{
  const l = levelFor({ totalDrinks: 10, nights: 2 }); // xp = 100 + 60 = 160
  assert.strictEqual(l.level, 2);
  assert.strictEqual(l.xpInLevel, 10);
  assert.strictEqual(l.xpForNext, 300);
  assert.strictEqual(l.title, 'Frequentador');
  assert.strictEqual(levelFor({ totalDrinks: 0, nights: 0 }).level, 1);
  ok('liga: XP → nível e título');

  const WEEK = 7 * 864e5, now = 100 * WEEK + 3 * 864e5;
  const hist = [{ at: now, items: { agua: 3, cerveja: 1 } }];
  const ch = weeklyChallenges(hist, { items: { agua: 1, dose: 1, cerveja: 1, drink: 1 } }, { now });
  const by = Object.fromEntries(ch.map((c) => [c.id, c]));
  assert.strictEqual(by.visits.progress, 2); assert.strictEqual(by.visits.done, true);   // 1 noite + a atual
  assert.strictEqual(by.hydrate.done, true);  // 3 águas numa noite
  assert.strictEqual(by.variety.done, true);  // 4 itens na noite atual
  const ch2 = weeklyChallenges([], { items: { cerveja: 1 } }, { now });
  assert.strictEqual(ch2.find((c) => c.id === 'visits').done, false);
  ok('liga: desafios da semana com noite em curso');

  const sa = seasonAward([{ at: Date.UTC(2026, 6, 15), myTotal: 30 }, { at: Date.UTC(2026, 4, 1), myTotal: 99 }], { now: Date.UTC(2026, 6, 20) });
  assert.strictEqual(sa.month, 30); // só julho
  assert.strictEqual(sa.title, 'Destaque do mês');
  assert.strictEqual(sa.label, 'jul');
  ok('liga: troféu do mês pelo total do mês corrente');
}

// ---------- Retrospectiva: com quem + agregados ----------
{
  assert.strictEqual(topMate([{ mates: ['Bia', 'Zé'] }, { mates: ['Bia'] }]).name, 'Bia');
  assert.strictEqual(topMate([]), null);
  const r = retro([{ at: Date.UTC(2026, 6, 1), myTotal: 5, mates: ['Bia'] }], { now: Date.UTC(2026, 6, 2) });
  assert.strictEqual(r.nights, 1);
  assert.strictEqual(r.topMate.name, 'Bia');
  ok('retro: agrega noites + parceiro de rolê');
}

console.log(`\n${passed} testes de stats/lifestats passaram ✅`);
