// Estatísticas de vida (puro/testável): agrega o histórico local de mesas em números
// pessoais — média por noite, recorde, total do mês, bebida favorita, streak de semanas e
// conquistas acumuladas. Só lê o histórico do próprio aparelho (nada central).

const WEEK = 7 * 864e5;
const weekOf = (ts) => Math.floor(ts / WEEK);
function ymKey(ts) { const d = new Date(ts); return d.getUTCFullYear() * 100 + (d.getUTCMonth() + 1); }

// Streak = semanas consecutivas com pelo menos uma ida, terminando na semana atual (ou na
// passada, se a atual ainda não teve visita — a semana em curso não quebra a sequência).
export function weekStreak(history, now) {
  const weeks = new Set();
  for (const h of history || []) if (h && typeof h.at === 'number') weeks.add(weekOf(h.at));
  if (!weeks.size) return 0;
  const cur = weekOf(now);
  const start = weeks.has(cur) ? cur : cur - 1;
  if (!weeks.has(start)) return 0;
  let n = 0;
  for (let w = start; weeks.has(w); w--) n++;
  return n;
}

export function lifeStats(history, { now }) {
  const list = (history || []).filter((h) => h && typeof h.at === 'number');
  let totalDrinks = 0, totalSpent = 0, record = null, thisMonth = 0;
  const itemTotals = {};
  const monthKey = ymKey(now);
  for (const h of list) {
    const my = Math.max(0, Number(h.myTotal) || 0);
    totalDrinks += my;
    totalSpent += Math.max(0, Number(h.myMoney) || 0);
    if (!record || my > record.total) record = { total: my, at: h.at, room: h.room, title: h.title || '' };
    if (ymKey(h.at) === monthKey) thisMonth += my;
    if (h.items) for (const k of Object.keys(h.items)) itemTotals[k] = (itemTotals[k] || 0) + (Number(h.items[k]) || 0);
  }
  const nights = list.length;
  let favDrink = '', favN = 0;
  for (const k of Object.keys(itemTotals)) if (itemTotals[k] > favN) { favN = itemTotals[k]; favDrink = k; }
  return {
    nights, totalDrinks, totalSpent, record, thisMonth, favDrink, favN, itemTotals,
    avgPerNight: nights ? totalDrinks / nights : 0,
    streakWeeks: weekStreak(list, now),
  };
}

// Total de bebidas por mês, dos últimos `months` até o atual (mais antigo → recente).
// O mês viaja por ÍNDICE (0-11) — a UI traduz via t('mon.'+monthIdx).
export function monthlyTrend(history, { now, months = 6 }) {
  const byKey = {};
  for (const h of history || []) {
    if (!h || typeof h.at !== 'number') continue;
    const d = new Date(h.at);
    const key = d.getUTCFullYear() * 12 + d.getUTCMonth();
    byKey[key] = (byKey[key] || 0) + Math.max(0, Number(h.myTotal) || 0);
  }
  const base = new Date(now);
  const baseKey = base.getUTCFullYear() * 12 + base.getUTCMonth();
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const key = baseKey - i;
    out.push({ key, monthIdx: ((key % 12) + 12) % 12, total: byKey[key] || 0 });
  }
  return out;
}

// Média de bebidas por dia da semana → dia mais leve (best) e mais pesado (worst).
export function weekdayInsight(history) {
  const sum = new Array(7).fill(0), cnt = new Array(7).fill(0);
  for (const h of history || []) {
    if (!h || typeof h.at !== 'number') continue;
    const wd = new Date(h.at).getUTCDay();
    sum[wd] += Math.max(0, Number(h.myTotal) || 0); cnt[wd] += 1;
  }
  // o dia viaja por ÍNDICE (0=domingo..6=sábado) — a UI traduz via t('wd.'+wd)
  let best = null, worst = null;
  for (let i = 0; i < 7; i++) {
    if (!cnt[i]) continue;
    const avg = sum[i] / cnt[i];
    if (!best || avg < best.avg) best = { wd: i, avg };
    if (!worst || avg > worst.avg) worst = { wd: i, avg };
  }
  return { best, worst };
}

// Com quem você mais bebeu (agrega os `mates` guardados por noite no histórico).
export function topMate(history) {
  const cnt = {};
  for (const h of history || []) for (const m of (h && h.mates) || []) if (m) cnt[m] = (cnt[m] || 0) + 1;
  let name = null, nights = 0;
  for (const k of Object.keys(cnt)) if (cnt[k] > nights) { nights = cnt[k]; name = k; }
  return name ? { name, nights } : null;
}

// Retrospectiva "Seu rolê": os números pra montar os slides/card compartilhável.
export function retro(history, { now }) {
  const s = lifeStats(history, { now });
  return {
    nights: s.nights, totalDrinks: s.totalDrinks, thisMonth: s.thisMonth,
    favDrink: s.favDrink, record: s.record, streakWeeks: s.streakWeeks,
    totalSpent: s.totalSpent, topMate: topMate(history),
  };
}

// Conquistas acumuladas (derivadas dos números de vida). O rótulo viaja pelo id
// — a UI traduz via t('lbadge.'+id, {n}); emoji é universal, n alimenta os interpolados.
export function lifeBadges(stats) {
  const b = [];
  if (stats.nights >= 1) b.push({ id: 'goer1', emoji: '🍺' });
  if (stats.nights >= 5) b.push({ id: 'goer5', emoji: '🎉' });
  if (stats.nights >= 15) b.push({ id: 'goer15', emoji: '🏅' });
  if (stats.record && stats.record.total >= 10) b.push({ id: 'rec10', emoji: '🔥', n: stats.record.total });
  if (stats.streakWeeks >= 3) b.push({ id: 'streak3', emoji: '📅', n: stats.streakWeeks });
  if (stats.totalDrinks >= 100) b.push({ id: 'd100', emoji: '💯' });
  return b;
}

// Perfil por BOTECO (Fase 2 do cardápio): cruza o histórico (visitas de mesa nomeada → gasto e
// bebida favorita ali), os check-ins do passaporte (contagem "estive lá" + último GPS) e os
// cardápios salvos (tem menu / quantos itens). Agrupa pelo nome NORMALIZADO — `keyOf` é injetado
// (store.botecoKey) pra o módulo seguir puro. Devolve a lista ordenada (mais visitado primeiro).
export function botecoProfiles(history, checkins, menus, keyOf) {
  const key = typeof keyOf === 'function' ? keyOf : (s) => String(s || '').trim().toLowerCase();
  const byKey = new Map();
  const get = (name) => {
    const k = key(name);
    if (!k) return null;
    if (!byKey.has(k)) byKey.set(k, { key: k, name: name || '', visits: 0, sessions: 0, spent: 0, favDrink: '', favN: 0, lastAt: 0, lat: null, lng: null, hasMenu: false, menuCount: 0, items: {} });
    return byKey.get(k);
  };
  // check-ins do passaporte: cada carimbo conta como visita; guarda o último lat/lng
  for (const c of checkins || []) {
    const p = get(c && c.name);
    if (!p) continue;
    p.visits += 1;
    if (typeof c.at === 'number' && c.at > p.lastAt) { p.lastAt = c.at; p.name = c.name; }
    if (c.lat != null && c.lng != null) { p.lat = c.lat; p.lng = c.lng; }
  }
  // histórico de mesas NOMEADAS: gasto + bebida favorita naquele lugar (o título já bate com o
  // boteco desde o cardápio-por-boteco — a mesa herda o nome do check-in/boteco).
  for (const h of history || []) {
    if (!h || !h.title) continue;
    const p = get(h.title);
    if (!p) continue;
    p.sessions += 1;
    p.spent += Math.max(0, Number(h.myMoney) || 0);
    if (typeof h.at === 'number' && h.at > p.lastAt) { p.lastAt = h.at; p.name = h.title; }
    if (h.items) for (const id of Object.keys(h.items)) p.items[id] = (p.items[id] || 0) + (Number(h.items[id]) || 0);
  }
  // cardápios salvos
  for (const m of menus || []) {
    const p = get(m && m.name);
    if (!p) continue;
    p.hasMenu = true;
    p.menuCount = Array.isArray(m.defs) ? m.defs.length : 0;
  }
  const out = [];
  for (const p of byKey.values()) {
    for (const id of Object.keys(p.items)) if (p.items[id] > p.favN) { p.favN = p.items[id]; p.favDrink = id; }
    delete p.items;
    out.push(p);
  }
  out.sort((a, b) => (b.visits - a.visits) || (b.lastAt - a.lastAt));
  return out;
}
