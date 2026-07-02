// Persistencia local (localStorage) — cache do proprio navegador, nunca central.
// Guarda: o log de eventos da mesa atual (p/ retomar e re-sincronizar) e um historico
// enxuto das mesas passadas.

const K_CURRENT = 'botequei.current';   // { room, createdAt } da mesa aberta
const K_LOG = (room) => 'botequei.log.' + room;
const K_HISTORY = 'botequei.history';   // [ { room, at, myTotal, tableTotal, title } ]

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
  writeJSON(K_HISTORY, list.slice(0, 12));
}
export function removeHistory(room) {
  writeJSON(K_HISTORY, getHistory().filter((e) => e.room !== room));
  localStorage.removeItem(K_LOG(room));
}
