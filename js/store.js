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
export function getFlags() { return readJSON(K_FLAGS, {}) || {}; } // cru, pro relatório do modo dev

// ---- Diário técnico (modo desenvolvedor) ----
// Anel FIFO com teto: caça-bug não pode inchar o localStorage (a foto de perfil já come quota).
// Só entra algo aqui com o switch dev LIGADO (o dlog do app.js é no-op desligado).
// 1500 entradas curtas (~100B cada ≈ 150KB): aguenta o rabo de uma noite inteira com jogos.
const K_DEVLOG = 'botequei.devlog';
const DEVLOG_MAX = 1500;
export function getDevLog() { const v = readJSON(K_DEVLOG, []); return Array.isArray(v) ? v : []; }
export function addDevLog(entry) { const list = getDevLog(); list.push(entry); writeJSON(K_DEVLOG, list.slice(-DEVLOG_MAX)); }
// Raio-x do localStorage pro relatório: tamanho de cada chave botequei.* (acha a inchada) +
// quais NÃO parseiam como JSON (dado corrompido é bug INVISÍVEL — hoje o readJSON engole calado).
export function storageScan() {
  const sizes = {}; const corrompidos = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('botequei.')) continue;
      const raw = localStorage.getItem(k) || '';
      sizes[k] = raw.length;
      if (raw && raw[0] !== undefined && '{['.includes(raw[0])) { try { JSON.parse(raw); } catch { corrompidos.push(k); } }
    }
  } catch { /* storage indisponível: relatório segue sem isso */ }
  return { sizes, corrompidos };
}

// ---- Passaporte de botecos (check-ins locais) ----
const K_PASS = 'botequei.passport';
export function getCheckins() { const v = readJSON(K_PASS, []); return Array.isArray(v) ? v : []; }
export function addCheckin(c) { const list = getCheckins(); list.unshift(c); writeJSON(K_PASS, list.slice(0, 100)); return list; }
// Enriquece um check-in JÁ salvo com as coordenadas do GPS (que chegam depois): o check-in
// grava na HORA e o GPS é bônus — nunca porteiro. Casa pelo `at` (carimbo do momento).
export function enrichCheckin(at, lat, lng) {
  const list = getCheckins();
  const c = list.find((x) => x.at === at);
  if (c) { c.lat = lat; c.lng = lng; writeJSON(K_PASS, list); }
  return list;
}

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
// Apaga só o CARDÁPIO salvo de um lugar (os check-ins/histórico dele continuam no passaporte).
export function deleteBotecoMenu(name) {
  const all = readJSON(K_BOTECO, {}) || {};
  const key = botecoKey(name);
  if (all[key]) { delete all[key]; writeJSON(K_BOTECO, all); return true; }
  return false;
}
// Renomeia o LUGAR INTEIRO: cardápio salvo + check-ins do passaporte + títulos do histórico.
// Assim a ficha do boteco (que cruza os três) passa a agregar tudo sob o novo nome.
export function renameBoteco(oldName, newName) {
  const from = botecoKey(oldName);
  const to = botecoKey(newName);
  const nm = String(newName || '').slice(0, 40).trim();
  if (!from || !nm) return false;
  // 1) cardápio salvo: move o registro pra nova chave (se o destino já existe, mantém o mais recente)
  const all = readJSON(K_BOTECO, {}) || {};
  if (all[from]) {
    const rec = all[from];
    if (to !== from) delete all[from];
    const dst = to !== from ? all[to] : null;
    const keep = (!dst || (rec.at || 0) >= (dst.at || 0)) ? rec : dst;
    all[to] = { name: nm, defs: keep.defs, at: keep.at || Date.now() };
    writeJSON(K_BOTECO, all);
  } else if (all[to]) {
    all[to] = { ...all[to], name: nm }; // sem origem, mas o destino existe → só atualiza o nome exibido
    writeJSON(K_BOTECO, all);
  }
  // 2) check-ins do passaporte: renomeia os do mesmo lugar
  const pass = getCheckins();
  let pc = false;
  for (const c of pass) if (botecoKey(c.name) === from) { c.name = nm; pc = true; }
  if (pc) writeJSON(K_PASS, pass);
  // 3) histórico: renomeia o título das noites do mesmo lugar
  const hist = getHistory();
  let hc = false;
  for (const e of hist) if (botecoKey(e.title) === from) { e.title = nm; hc = true; }
  if (hc) writeJSON(K_HISTORY, hist);
  return true;
}

// ---- Couvert por boteco (varia por bar; lembra o último valor digitado, igual à gorjeta) ----
// Chaveado pelo NOME do boteco normalizado (mesma chave do cardápio/passaporte). Local; entra no
// backup botequei.* de graça. Mesa anônima (sem nome) não salva nem prefila (o app passa 0).
const K_COUVERT = 'botequei.botecocouvert';
export function saveBotecoCouvert(name, v) {
  const key = botecoKey(name);
  if (!key) return;
  const all = readJSON(K_COUVERT, {}) || {};
  all[key] = Number(v) || 0;
  writeJSON(K_COUVERT, all);
}
export function getBotecoCouvert(name) {
  const all = readJSON(K_COUVERT, {}) || {};
  return Number(all[botecoKey(name)]) || 0;
}

// ---- Apagar granular ("Meus dados": deleção por categoria + por item + por lugar) ----
// Tudo é LOCAL — apagar aqui NÃO mexe na cópia dos outros aparelhos (a mesa vive em CRDT em cada
// um). Cada função some com uma fatia bem definida; o painel "Meus dados" (app.js/ui.js) as chama.
function logKeys() {
  const out = [];
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('botequei.log.')) out.push(k); } } catch { /* storage indisponível */ }
  return out;
}
// Passaporte: um check-in (casa pelo carimbo `at`) ou todos.
export function removeCheckin(at) { writeJSON(K_PASS, getCheckins().filter((c) => c.at !== at)); return getCheckins(); }
export function clearCheckins() { localStorage.removeItem(K_PASS); }
// Mesas & Meus Números: histórico + os logs de CADA mesa (inclusive órfãos) + a mesa aberta.
export function clearHistory() { for (const k of logKeys()) localStorage.removeItem(k); localStorage.removeItem(K_HISTORY); localStorage.removeItem(K_CURRENT); }
// Cardápios salvos: os cardápios + os couverts lembrados por boteco.
export function clearBotecoMenus() { localStorage.removeItem(K_BOTECO); localStorage.removeItem(K_COUVERT); }
// Diário técnico do modo dev.
export function clearDevLog() { localStorage.removeItem(K_DEVLOG); }
// Rever boas-vindas/tour: zera as flags de 1ª vez, MAS preserva o `devUnlocked` (senão a seção do
// modo dev desapareceria de quem já a destravou com os 7 toques).
export function resetOnboarding() {
  const v = readJSON(K_FLAGS, {}) || {};
  const keep = {}; if (v.devUnlocked) keep.devUnlocked = v.devUnlocked;
  writeJSON(K_FLAGS, keep);
}
// Apagar um LUGAR inteiro: cardápio + couvert + check-ins + histórico (e os logs das mesas) do
// MESMO boteco (chave normalizada). Irmão do renameBoteco — mexe nos mesmos 4 stores.
export function deletePlace(name) {
  const key = botecoKey(name);
  if (!key) return false;
  const menus = readJSON(K_BOTECO, {}) || {}; if (menus[key]) { delete menus[key]; writeJSON(K_BOTECO, menus); }
  const couv = readJSON(K_COUVERT, {}) || {}; if (Object.prototype.hasOwnProperty.call(couv, key)) { delete couv[key]; writeJSON(K_COUVERT, couv); }
  writeJSON(K_PASS, getCheckins().filter((c) => botecoKey(c.name) !== key));
  const keep = [];
  for (const e of getHistory()) { if (botecoKey(e.title) === key) localStorage.removeItem(K_LOG(e.room)); else keep.push(e); }
  writeJSON(K_HISTORY, keep);
  return true;
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
