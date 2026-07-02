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
