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

const MON = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
// Total de bebidas por mês, dos últimos `months` até o atual (mais antigo → recente).
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
    out.push({ key, label: MON[((key % 12) + 12) % 12], total: byKey[key] || 0 });
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
  const days = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  let best = null, worst = null;
  for (let i = 0; i < 7; i++) {
    if (!cnt[i]) continue;
    const avg = sum[i] / cnt[i];
    if (!best || avg < best.avg) best = { wd: i, day: days[i], avg };
    if (!worst || avg > worst.avg) worst = { wd: i, day: days[i], avg };
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

// Conquistas acumuladas (derivadas dos números de vida).
export function lifeBadges(stats) {
  const b = [];
  if (stats.nights >= 1) b.push({ id: 'goer1', emoji: '🍺', name: 'Primeira ida' });
  if (stats.nights >= 5) b.push({ id: 'goer5', emoji: '🎉', name: 'Frequentador' });
  if (stats.nights >= 15) b.push({ id: 'goer15', emoji: '🏅', name: 'Veterano do boteco' });
  if (stats.record && stats.record.total >= 10) b.push({ id: 'rec10', emoji: '🔥', name: `Recorde: ${stats.record.total} numa noite` });
  if (stats.streakWeeks >= 3) b.push({ id: 'streak3', emoji: '📅', name: `${stats.streakWeeks} semanas seguidas` });
  if (stats.totalDrinks >= 100) b.push({ id: 'd100', emoji: '💯', name: '100 rodadas na vida' });
  return b;
}
