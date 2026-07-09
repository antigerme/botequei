// Testes de estatísticas de vida (lifestats.js), liga e catálogo — sem deps.
// Rodar: node tests/stats.test.mjs

import assert from 'node:assert';
import { DEFAULT_ITEMS, catOf, CATEGORIES } from '../js/catalog.js';
import { weekStreak, lifeStats, lifeBadges, monthlyTrend, weekdayInsight, topMate, retro, botecoProfiles } from '../js/lifestats.js';
import { levelFor, weeklyChallenges, seasonAward } from '../js/league.js';

let passed = 0;
const ok = (n) => { console.log('  ✓ ' + n); passed++; };
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

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
  assert.deepStrictEqual(t.map((x) => x.monthIdx), [4, 5, 6]); // mai/jun/jul → índices (a UI traduz)
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

// ---------- Liga: nível/XP, desafios, troféu ----------
{
  const l = levelFor({ totalDrinks: 10, nights: 2 }); // xp = 100 + 60 = 160
  assert.strictEqual(l.level, 2);
  assert.strictEqual(l.xpInLevel, 10);
  assert.strictEqual(l.xpForNext, 300);
  assert.strictEqual(levelFor({ totalDrinks: 0, nights: 0 }).level, 1);
  ok('liga: XP → nível (o título viaja por número, traduzido na UI)');

  const WEEK = 7 * 864e5, now = 100 * WEEK + 3 * 864e5;
  const hist = [{ at: now, items: { cerveja: 1 } }];
  const ch = weeklyChallenges(hist, { items: { agua: 1, dose: 1, cerveja: 1, drink: 1 } }, { now });
  const by = Object.fromEntries(ch.map((c) => [c.id, c]));
  assert.strictEqual(by.visits.progress, 2); assert.strictEqual(by.visits.done, true);   // 1 noite + a atual
  assert.strictEqual(by.variety.done, true);  // 4 itens na noite atual
  const ch2 = weeklyChallenges([], { items: { cerveja: 1 } }, { now });
  assert.strictEqual(ch2.find((c) => c.id === 'visits').done, false);
  ok('liga: desafios da semana com noite em curso');

  const sa = seasonAward([{ at: Date.UTC(2026, 6, 15), myTotal: 30 }, { at: Date.UTC(2026, 4, 1), myTotal: 99 }], { now: Date.UTC(2026, 6, 20) });
  assert.strictEqual(sa.month, 30); // só julho
  assert.strictEqual(sa.tier, 2); // 25 <= 30 < 50 → tier "destaque" (a UI traduz)
  assert.strictEqual(sa.monthIdx, 6); // julho → índice
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

// ---------- Perfil por boteco (cruza check-in + histórico + cardápio) ----------
{
  // mesmo normalizador do store.botecoKey (minúsculo, sem acento, espaços colapsados)
  const keyOf = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
  const history = [
    { title: 'Bar do Zé', at: 100, myMoney: 30, items: { 'x-chopp': 5, 'x-porcao': 1 } },
    { title: 'bar do zé', at: 200, myMoney: 20, items: { 'x-chopp': 2 } }, // MESMA chave
    { title: 'Outro Bar', at: 150, myMoney: 10, items: { 'x-lata': 3 } },
  ];
  const checkins = [
    { name: 'Bar do Zé', at: 300, lat: -23.5, lng: -46.6 },
    { name: 'Bar do Zé', at: 90 },
    { name: 'Boteco Sem Mesa', at: 50 }, // só check-in (sem histórico/cardápio)
  ];
  const menus = [{ name: 'BAR DO ZE', defs: [{ id: 'x-chopp' }, { id: 'x-porcao' }] }];
  const profs = botecoProfiles(history, checkins, menus, keyOf);

  const ze = profs.find((p) => p.key === keyOf('Bar do Zé'));
  assert.strictEqual(ze.visits, 2);        // 2 check-ins
  assert.strictEqual(ze.sessions, 2);      // 2 mesas nomeadas no histórico
  assert.strictEqual(ze.spent, 50);        // 30 + 20
  assert.strictEqual(ze.favDrink, 'x-chopp'); // 5+2 = 7 chopps vence
  assert.strictEqual(ze.favN, 7);
  assert.strictEqual(ze.hasMenu, true);
  assert.strictEqual(ze.menuCount, 2);
  assert.strictEqual(ze.lastAt, 300);      // check-in mais recente
  assert.strictEqual(ze.lat, -23.5);       // GPS do último check-in com coords
  ok('botecoProfiles: junta check-in+histórico+cardápio pela chave normalizada');

  const sem = profs.find((p) => p.key === keyOf('Boteco Sem Mesa'));
  assert.strictEqual(sem.visits, 1);
  assert.strictEqual(sem.spent, 0);
  assert.strictEqual(sem.hasMenu, false);
  assert.strictEqual(profs[0].key, keyOf('Bar do Zé')); // ordenado por visitas desc
  ok('botecoProfiles: lugar só de check-in aparece; lista ordena por visitas');
}

console.log(`\n${passed} testes de lifestats/liga passaram ✅`);
