// Modelo de eventos distribuidos + reducer de estado (estilo CRDT PN-Counter).
//
// Eventos sao imutaveis e idempotentes. O estado final e derivado da SOMA dos eventos:
// como somar +1/-1 e comutativo, a ordem de chegada nao altera os totais -> todos os
// navegadores convergem para o mesmo estado mesmo com atrasos, reenvios ou duplicatas.
//
// Tipos de evento:
//   ADD    -> { type:'ADD',    user, name, item, ts, eventId }   (+1 do item p/ o usuario)
//   REMOVE -> { type:'REMOVE', user, name, item, ts, eventId }   (-1)
//   ITEM   -> { type:'ITEM',   def:{id,emoji,name,price}, ts, eventId }  (item personalizado)

import { clientId, getName } from './identity.js';

let _seq = 0;
export function newEventId() {
  return clientId() + '-' + Date.now().toString(36) + '-' + (_seq++).toString(36);
}

// ---- Fabricas (carimbam ts + eventId) ----
export function makeAdd(item) {
  return { type: 'ADD', user: clientId(), name: getName(), item, ts: Date.now(), eventId: newEventId() };
}
export function makeRemove(item) {
  return { type: 'REMOVE', user: clientId(), name: getName(), item, ts: Date.now(), eventId: newEventId() };
}
export function makeItem(def) {
  return { type: 'ITEM', def, ts: Date.now(), eventId: newEventId() };
}

// ---- Estado ----
export function emptyState() {
  return {
    counts: new Map(), // "user\x00item" -> inteiro (pode ficar negativo transitoriamente)
    items: new Map(),  // id -> { def, ts }  (itens personalizados, LWW por ts)
    names: new Map(),  // user -> apelido mais recente visto
    users: new Set(),  // ids que registraram algo
  };
}

const ckey = (u, i) => u + '\x00' + i;

// Aplica um evento ja "novo" (a deduplicacao por eventId acontece no log, fora daqui).
// Retorna true se o evento foi reconhecido/aplicado.
export function applyEvent(state, ev) {
  if (!ev || typeof ev !== 'object') return false;
  switch (ev.type) {
    case 'ADD':
    case 'REMOVE': {
      if (!ev.user || !ev.item) return false;
      const k = ckey(ev.user, ev.item);
      const delta = ev.type === 'ADD' ? 1 : -1;
      state.counts.set(k, (state.counts.get(k) || 0) + delta);
      state.users.add(ev.user);
      if (ev.name) state.names.set(ev.user, ev.name);
      return true;
    }
    case 'ITEM': {
      const def = ev.def;
      if (!def || !def.id) return false;
      const cur = state.items.get(def.id);
      // last-writer-wins: ts maior vence; empate resolvido por eventId
      if (!cur || ev.ts > cur.ts || (ev.ts === cur.ts && ev.eventId > cur.eventId)) {
        state.items.set(def.id, { def, ts: ev.ts, eventId: ev.eventId });
      }
      return true;
    }
    default:
      return false;
  }
}

// ---- Seletores ----
export function getCount(state, user, item) {
  return Math.max(0, state.counts.get(ckey(user, item)) || 0);
}

export function itemTotal(state, item) {
  let t = 0;
  for (const u of state.users) t += getCount(state, u, item);
  return t;
}

export function userTotal(state, user) {
  let t = 0;
  for (const [k, v] of state.counts) {
    if (k.startsWith(user + '\x00')) t += Math.max(0, v);
  }
  return t;
}

export function tableTotal(state) {
  let t = 0;
  for (const v of state.counts.values()) t += Math.max(0, v);
  return t;
}

// Gasto de um usuario, somando preco * quantidade de cada item.
export function userMoney(state, user, resolveItem) {
  let total = 0;
  for (const [k, v] of state.counts) {
    const [u, item] = k.split('\x00');
    if (u !== user) continue;
    const def = resolveItem(item);
    if (def && def.price) total += Math.max(0, v) * def.price;
  }
  return total;
}

// Resumo por participante (para historico / painel de participantes).
export function summary(state, resolveItem) {
  const rows = [];
  for (const u of state.users) {
    rows.push({
      user: u,
      name: state.names.get(u) || '',
      total: userTotal(state, u),
      money: userMoney(state, u, resolveItem),
    });
  }
  rows.sort((a, b) => b.total - a.total);
  return rows;
}
