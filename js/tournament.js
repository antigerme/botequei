// Torneio local (puro/testável): acumula pontos por pessoa (por nome) ao longo das noites
// em que você esteve junto da galera. Os pontos vêm do app (idas + hidratação, pra premiar
// quem aparece e se cuida — não quem bebe mais). Fica só no seu aparelho.

export function mergeNight(standings, rows) {
  const out = {};
  for (const k of Object.keys(standings || {})) out[k] = { points: standings[k].points || 0, nights: standings[k].nights || 0 };
  for (const r of rows || []) {
    const name = String(r.name || '').trim();
    if (!name) continue;
    if (!out[name]) out[name] = { points: 0, nights: 0 };
    out[name].points += Math.max(0, Number(r.points) || 0);
    out[name].nights += 1;
  }
  return out;
}

export function rankTournament(standings) {
  return Object.keys(standings || {})
    .map((name) => ({ name, points: standings[name].points || 0, nights: standings[name].nights || 0 }))
    .sort((a, b) => b.points - a.points || b.nights - a.nights || a.name.localeCompare(b.name, 'pt-BR'));
}
