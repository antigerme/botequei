// Liga & desafios (puro/testável): nível/XP, desafios da semana e troféu do mês, tudo
// derivado do histórico local + da noite em curso. Nada central; é só engajamento local.

// XP acumulado a partir dos números de vida.
function xpOf(stats) {
  return (Number(stats && stats.totalDrinks) || 0) * 10 + (Number(stats && stats.nights) || 0) * 30;
}
// XP total necessário pra CHEGAR no nível L (cresce quadrático: 150·(1+2+…+(L-1))).
const cum = (L) => 75 * L * (L - 1);
const TITLES = ['', 'Novato do boteco', 'Frequentador', 'Veterano', 'Mestre da mesa', 'Lenda do boteco'];

export function levelFor(stats) {
  const xp = xpOf(stats);
  let level = 1;
  while (cum(level + 1) <= xp) level++;
  const base = cum(level), next = cum(level + 1);
  return {
    xp, level,
    xpInLevel: xp - base,
    xpForNext: next - base,
    title: TITLES[Math.min(level, TITLES.length - 1)] || 'Lenda do boteco',
  };
}

const WEEK = 7 * 864e5;
// Desafios da semana atual. `current` (opcional) = a noite em curso { at, items:{id:n} }.
export function weeklyChallenges(history, current, { now }) {
  const weekStart = Math.floor(now / WEEK) * WEEK;
  const nights = (history || []).filter((h) => h && typeof h.at === 'number' && h.at >= weekStart);
  if (current && current.items) nights.push(current);
  const visits = nights.length;
  const maxOf = (id) => nights.reduce((m, h) => Math.max(m, (h.items && Number(h.items[id])) || 0), 0);
  const maxVariety = nights.reduce((m, h) => Math.max(m, h.items ? Object.keys(h.items).length : 0), 0);
  const defs = [
    { id: 'visits', emoji: '📅', title: 'Ir ao boteco 2x essa semana', goal: 2, progress: visits },
    { id: 'hydrate', emoji: '💧', title: '3 águas numa noite', goal: 3, progress: maxOf('agua') },
    { id: 'variety', emoji: '🍽️', title: 'Provar 4 itens diferentes', goal: 4, progress: maxVariety },
  ];
  return defs.map((c) => ({ ...c, progress: Math.min(c.progress, c.goal), done: c.progress >= c.goal }));
}

// Troféu da temporada (mês corrente): total do mês + rótulo temático.
export function seasonAward(history, { now }) {
  const d = new Date(now);
  const key = d.getUTCFullYear() * 100 + (d.getUTCMonth() + 1);
  let month = 0, nights = 0;
  for (const h of history || []) {
    if (!h || typeof h.at !== 'number') continue;
    const hd = new Date(h.at);
    if (hd.getUTCFullYear() * 100 + (hd.getUTCMonth() + 1) === key) { month += Math.max(0, Number(h.myTotal) || 0); nights++; }
  }
  const MON = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][d.getUTCMonth()];
  let emoji = '🌱', title = 'Começando o mês';
  if (month >= 50) { emoji = '👑'; title = 'Rei do mês'; }
  else if (month >= 25) { emoji = '🏆'; title = 'Destaque do mês'; }
  else if (month >= 10) { emoji = '🔥'; title = 'Esquentando'; }
  return { month, nights, label: MON, emoji, title };
}
