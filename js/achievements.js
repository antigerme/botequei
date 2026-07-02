// Conquistas/badges e MVP da noite — derivados do estado (puro, testavel).

import { userTotal, getCount, isDriver, summary } from './events.js';
import { alcoholG } from './catalog.js';

// Badges de um participante.
export function badgesFor(state, user) {
  const total = userTotal(state, user);
  const list = [];
  if (isDriver(state, user)) list.push({ id: 'driver', emoji: '🚗', name: 'Motorista da rodada' });
  if (total >= 1) list.push({ id: 'first', emoji: '🌱', name: 'Primeira rodada' });
  if (total >= 5) list.push({ id: 'five', emoji: '🔥', name: 'Esquentou' });
  if (total >= 10) list.push({ id: 'ten', emoji: '🏅', name: 'Maratonista' });
  if (total >= 20) list.push({ id: 'twenty', emoji: '👑', name: 'Lenda da mesa' });
  if (getCount(state, user, 'agua') >= 1) list.push({ id: 'water', emoji: '💧', name: 'Hidratado' });
  return list;
}

// MVP = quem mais consumiu (ignora motoristas). null se ninguem consumiu.
export function mvp(state, resolveItem) {
  const rows = summary(state, resolveItem).filter((r) => !r.driver && r.total > 0);
  return rows.length ? rows[0] : null;
}

// Cerimônia de fim de noite: troféus derivados do estado (+ log p/ ritmo). Uma pessoa pode
// levar mais de um. Só entram prêmios com ganhador de verdade. `resolveItem` dá as gramas.
export function ceremonyAwards(state, resolveItem, opts = {}) {
  const { log = [], now = 0 } = opts;
  const rows = summary(state, resolveItem);
  const byUser = new Map(rows.map((r) => [r.user, r]));
  const out = [];
  const add = (id, emoji, title, user, detail) => {
    const r = byUser.get(user);
    if (!r) return;
    out.push({ id, emoji, title, user, name: r.name || 'anônimo', avatar: r.emoji, color: r.color, detail });
  };

  // 🏆 MVP: maior total (sem motoristas)
  const mvps = rows.filter((r) => !r.driver && r.total > 0);
  if (mvps.length) add('mvp', '🏆', 'MVP da noite', mvps[0].user, `${mvps[0].total} rodadas`);

  // 🥃 Cabeça de ferro: mais destilados (dose + drink)
  let ferro = null, ferroN = 0;
  for (const r of rows) { if (r.driver) continue; const n = getCount(state, r.user, 'dose') + getCount(state, r.user, 'drink'); if (n > ferroN) { ferroN = n; ferro = r.user; } }
  if (ferro && ferroN > 0) add('ferro', '🥃', 'Cabeça de ferro', ferro, `${ferroN} destilado${ferroN === 1 ? '' : 's'}`);

  // 💧 Hidratado: mais águas
  let agua = null, aguaN = 0;
  for (const r of rows) { const n = getCount(state, r.user, 'agua'); if (n > aguaN) { aguaN = n; agua = r.user; } }
  if (agua && aguaN > 0) add('agua', '💧', 'Hidratado', agua, `${aguaN} água${aguaN === 1 ? '' : 's'}`);

  // 💸 Patrão: maior gasto
  const spenders = rows.filter((r) => r.money > 0).sort((a, b) => b.money - a.money);
  if (spenders.length) add('patrao', '💸', 'Patrão da mesa', spenders[0].user, 'R$ ' + spenders[0].money.toFixed(2));

  // 🚗 Anjo da guarda: motorista(s)
  const drivers = rows.filter((r) => r.driver);
  if (drivers.length) add('driver', '🚗', 'Anjo da guarda', drivers[0].user, drivers.length > 1 ? `+${drivers.length} motoristas` : 'levou a galera em casa');

  // 🌶️ Pé no acelerador: maior ritmo (bebidas/hora) no log — mín. 3 pra evitar ruído
  if (log.length && now) {
    const per = new Map();
    for (const ev of log) {
      if (ev.type !== 'ADD' && ev.type !== 'REMOVE') continue;
      if (alcoholG(resolveItem(ev.item)) <= 0) continue;
      const rec = per.get(ev.user) || { count: 0, first: 0 };
      rec.count += ev.type === 'ADD' ? 1 : -1;
      if (ev.type === 'ADD') rec.first = rec.first ? Math.min(rec.first, ev.ts) : ev.ts;
      per.set(ev.user, rec);
    }
    let fast = null, fastRate = 0;
    for (const [u, rec] of per) {
      const row = byUser.get(u);
      if (!row || row.driver || rec.count < 3 || !rec.first) continue;
      const rate = rec.count / Math.max(0.5, (now - rec.first) / 3600000);
      if (rate > fastRate) { fastRate = rate; fast = u; }
    }
    if (fast) add('fast', '🌶️', 'Pé no acelerador', fast, `${fastRate.toFixed(1)} por hora`);
  }

  return out;
}

// "Zoa"/frase de marco quando alguem assume a lideranca ou cruza um numero redondo.
export function milestoneLine(name, total, leaderName) {
  if (total > 0 && total % 10 === 0) return `${name} chegou a ${total} 🍺!`;
  if (leaderName && leaderName === name && total >= 3) return `${name} assumiu a liderança 👑`;
  if (total === 5) return `${name} tá esquentando 🔥`;
  return null;
}
