// Modelo de eventos distribuidos + reducer de estado (estilo CRDT PN-Counter).
//
// Eventos sao imutaveis e idempotentes. O estado final e derivado da SOMA dos eventos:
// como somar +1/-1 e comutativo, a ordem de chegada nao altera os totais -> todos os
// navegadores convergem para o mesmo estado mesmo com atrasos, reenvios ou duplicatas.
//
// Tipos de evento:
//   ADD     -> { type:'ADD',    user, name, item, ts, eventId }   (+1 do item p/ o usuario)
//   REMOVE  -> { type:'REMOVE', user, name, item, ts, eventId }   (-1)
//   ITEM    -> { type:'ITEM',   def:{id,emoji,name,price}, ts, eventId }  (item novo/preco, LWW)
//   PROFILE -> { type:'PROFILE', user, name, color, emoji, driver, ts, eventId }  (identidade, LWW)
//   TABLE   -> { type:'TABLE',  title, emoji, ts, eventId }  (nome/emoji da mesa, LWW)

import { clientId, getName } from './identity.js';

let _seq = 0;
export function newEventId() {
  return clientId() + '-' + Date.now().toString(36) + '-' + (_seq++).toString(36);
}

// ---- Fabricas (carimbam ts + eventId) ----
// user/name opcionais: por padrao sou eu; a "rodada" cria ADDs para outros usuarios.
export function makeAdd(item, user, name) {
  return { type: 'ADD', user: user || clientId(), name: name !== undefined ? name : getName(), item, ts: Date.now(), eventId: newEventId() };
}
export function makeRemove(item, user, name) {
  return { type: 'REMOVE', user: user || clientId(), name: name !== undefined ? name : getName(), item, ts: Date.now(), eventId: newEventId() };
}
export function makeItem(def) {
  return { type: 'ITEM', def, ts: Date.now(), eventId: newEventId() };
}
export function makeProfile({ color, emoji, driver }) {
  return { type: 'PROFILE', user: clientId(), name: getName(), color: color || '', emoji: emoji || '', driver: !!driver, ts: Date.now(), eventId: newEventId() };
}
export function makeTable({ title, emoji }) {
  return { type: 'TABLE', title: title || '', emoji: emoji || '', ts: Date.now(), eventId: newEventId() };
}
// Happy hour: janela cronometrada compartilhada. `until` é timestamp absoluto (ms).
export function makeHappyHour({ minutes, startTotal }) {
  const mins = Math.max(1, Math.min(240, Number(minutes) || 30));
  return { type: 'HAPPYHOUR', until: Date.now() + mins * 60000, startTotal: Number(startTotal) || 0, startedBy: clientId(), ts: Date.now(), eventId: newEventId() };
}

// ---- Estado ----
export function emptyState() {
  return {
    counts: new Map(),   // "user\x00item" -> inteiro (pode ficar negativo transitoriamente)
    items: new Map(),    // id -> { def, ts }        (itens/precos, LWW por ts)
    names: new Map(),    // user -> apelido mais recente visto
    users: new Set(),    // ids que registraram algo ou tem perfil
    profiles: new Map(), // user -> { def:{name,color,emoji,driver}, ts, eventId }  (LWW)
    table: null,         // { def:{title,emoji}, ts, eventId }  (LWW)
    happy: null,         // { def:{until,startTotal,by}, ts, eventId }  (LWW) — happy hour
  };
}

const ckey = (u, i) => u + '\x00' + i;
// vence o de maior ts; empate resolvido pelo eventId (deterministico em todos os peers)
const wins = (cur, ev) => !cur || ev.ts > cur.ts || (ev.ts === cur.ts && ev.eventId > cur.eventId);
// nome do usuario tambem por LWW (senao a exibicao diverge conforme a ordem de replay)
function applyName(state, user, name, ev) {
  if (!name) return;
  const cur = state.names.get(user);
  if (wins(cur, ev)) state.names.set(user, { name, ts: ev.ts, eventId: ev.eventId });
}

// Aplica um evento ja "novo" (a deduplicacao por eventId acontece no log, fora daqui).
// Retorna true se o evento foi reconhecido/aplicado.
export function applyEvent(state, ev) {
  if (!ev || typeof ev !== 'object') return false;
  switch (ev.type) {
    case 'ADD':
    case 'REMOVE': {
      if (!ev.user || !ev.item) return false;
      const k = ckey(ev.user, ev.item);
      state.counts.set(k, (state.counts.get(k) || 0) + (ev.type === 'ADD' ? 1 : -1));
      state.users.add(ev.user);
      applyName(state, ev.user, ev.name, ev);
      return true;
    }
    case 'ITEM': {
      const def = ev.def;
      if (!def || !def.id) return false;
      if (wins(state.items.get(def.id), ev)) state.items.set(def.id, { def, ts: ev.ts, eventId: ev.eventId });
      return true;
    }
    case 'PROFILE': {
      if (!ev.user) return false;
      if (wins(state.profiles.get(ev.user), ev)) {
        state.profiles.set(ev.user, {
          def: { name: ev.name || '', color: ev.color || '', emoji: ev.emoji || '', driver: !!ev.driver },
          ts: ev.ts, eventId: ev.eventId,
        });
      }
      state.users.add(ev.user);
      applyName(state, ev.user, ev.name, ev);
      return true;
    }
    case 'TABLE': {
      if (wins(state.table, ev)) state.table = { def: { title: ev.title || '', emoji: ev.emoji || '' }, ts: ev.ts, eventId: ev.eventId };
      return true;
    }
    case 'HAPPYHOUR': {
      if (wins(state.happy, ev)) state.happy = { def: { until: Number(ev.until) || 0, startTotal: Number(ev.startTotal) || 0, by: ev.startedBy || '' }, ts: ev.ts, eventId: ev.eventId };
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

export function getProfile(state, user) {
  const p = state.profiles.get(user);
  const def = p ? p.def : {};
  return {
    name: def.name || (state.names.get(user) || {}).name || '',
    color: def.color || '',
    emoji: def.emoji || '',
    driver: !!def.driver,
  };
}

export function tableInfo(state) {
  return state.table ? state.table.def : { title: '', emoji: '' };
}

export function happyHour(state) {
  return state.happy ? state.happy.def : null;
}

export function isDriver(state, user) {
  const p = state.profiles.get(user);
  return !!(p && p.def.driver);
}

// Resumo por participante (placar, painel, conta, card compartilhavel).
export function summary(state, resolveItem) {
  const rows = [];
  for (const u of state.users) {
    const p = getProfile(state, u);
    rows.push({
      user: u, name: p.name, color: p.color, emoji: p.emoji, driver: p.driver,
      total: userTotal(state, u),
      money: userMoney(state, u, resolveItem),
    });
  }
  rows.sort((a, b) => b.total - a.total);
  return rows;
}
