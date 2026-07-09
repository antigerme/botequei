// Persistencia local (localStorage) — cache do proprio navegador, nunca central.
// Guarda: o log de eventos da mesa atual (p/ retomar e re-sincronizar) e um historico
// enxuto das mesas passadas.

const K_CURRENT = 'botequei.current';   // { room, createdAt } da mesa aberta
const K_LOG = (room) => 'botequei.log.' + room;
// [ { room, at, myTotal, tableTotal, title, myMoney, durationMs, items:{id:n} } ]
const K_HISTORY = 'botequei.history';

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota: ignora */ }
}

// ---- Mesa atual ----
export function setCurrent(room) {
  writeJSON(K_CURRENT, { room, createdAt: Date.now() });
}
export function getCurrent() {
  return readJSON(K_CURRENT, null);
}
export function clearCurrent() {
  localStorage.removeItem(K_CURRENT);
}

// ---- Log de eventos (por mesa) ----
export function getEvents(room) {
  const v = readJSON(K_LOG(room), []);
  return Array.isArray(v) ? v : [];
}
export function saveEvents(room, events) {
  writeJSON(K_LOG(room), events);
}

// ---- Historico ----
export function getHistory() {
  const v = readJSON(K_HISTORY, []);
  return Array.isArray(v) ? v : [];
}
export function pushHistory(entry) {
  const list = getHistory().filter((e) => e.room !== entry.room);
  list.unshift(entry);
  writeJSON(K_HISTORY, list.slice(0, 60)); // guarda bastante p/ as estatísticas de vida
}
export function removeHistory(room) {
  writeJSON(K_HISTORY, getHistory().filter((e) => e.room !== room));
  localStorage.removeItem(K_LOG(room));
}

// ---- Flags de primeira vez (welcome 1×, tour guiado da 1ª mesa) ----
const K_FLAGS = 'botequei.flags';
export function getFlag(name) { const v = readJSON(K_FLAGS, {}); return !!(v && v[name]); }
export function setFlag(name) { const v = readJSON(K_FLAGS, {}) || {}; v[name] = Date.now(); writeJSON(K_FLAGS, v); }

// ---- Passaporte de botecos (check-ins locais) ----
const K_PASS = 'botequei.passport';
export function getCheckins() { const v = readJSON(K_PASS, []); return Array.isArray(v) ? v : []; }
export function addCheckin(c) { const list = getCheckins(); list.unshift(c); writeJSON(K_PASS, list.slice(0, 100)); return list; }

// ---- Cardápio por boteco (lembra os itens de cada lugar pra recarregar quando você volta) ----
// Chaveado pelo NOME do boteco = o título da mesa (normalizado: minúsculo, sem acento, espaços
// colapsados) — o mesmo "lugar" do passaporte. Tudo local (localStorage); nada central.
const K_BOTECO = 'botequei.botecomenu';
export function botecoKey(name) {
  // NFD separa a letra do acento; \p{M} (marca combinante) tira só o acento — "Bar do Zé" ⇒ "bar do ze"
  return String(name || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ');
}
export function saveBotecoMenu(name, defs) {
  const key = botecoKey(name);
  if (!key || !Array.isArray(defs) || !defs.length) return; // só guarda boteco com nome e itens
  const all = readJSON(K_BOTECO, {}) || {};
  all[key] = { name: String(name).slice(0, 40), defs, at: Date.now() }; // "latest wins": converge pro mais completo
  writeJSON(K_BOTECO, all);
}
export function getBotecoMenu(name) {
  const all = readJSON(K_BOTECO, {}) || {};
  const rec = all[botecoKey(name)];
  return rec && Array.isArray(rec.defs) ? rec.defs : [];
}
export function hasBotecoMenu(name) { return getBotecoMenu(name).length > 0; }
export function listBotecoMenus() {
  const all = readJSON(K_BOTECO, {}) || {};
  return Object.values(all).sort((a, b) => (b.at || 0) - (a.at || 0)); // mais recentes primeiro (p/ Fase 2)
}

// ---- Backup (exportar/importar tudo que é local do Botequei) ----
export function exportAll() {
  const data = {};
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('botequei.')) continue;
    const raw = localStorage.getItem(k);
    try { data[k] = JSON.parse(raw); } catch { data[k] = raw; }
  }
  return { app: 'botequei', v: 1, at: Date.now(), data };
}
export function importAll(obj) {
  if (!obj || obj.app !== 'botequei' || !obj.data || typeof obj.data !== 'object') throw new Error('backup inválido');
  let n = 0;
  for (const k of Object.keys(obj.data)) {
    if (!k.startsWith('botequei.')) continue; // só chaves do app
    const v = obj.data[k];
    try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); n++; } catch { /* quota */ }
  }
  return n;
}
