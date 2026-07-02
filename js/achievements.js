// Conquistas/badges e MVP da noite — derivados do estado (puro, testavel).

import { userTotal, getCount, isDriver, summary } from './events.js';

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

// "Zoa"/frase de marco quando alguem assume a lideranca ou cruza um numero redondo.
export function milestoneLine(name, total, leaderName) {
  if (total > 0 && total % 10 === 0) return `${name} chegou a ${total} 🍺!`;
  if (leaderName && leaderName === name && total >= 3) return `${name} assumiu a liderança 👑`;
  if (total === 5) return `${name} tá esquentando 🔥`;
  return null;
}
