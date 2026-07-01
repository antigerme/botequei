// Orquestrador do Botequei: amarra identidade, eventos, malha WebRTC, UI e QR.
// Mantem o log de eventos (com deduplicacao) e deriva o estado localmente.

import { clientId, getName, setName, newRoomCode } from './identity.js';
import { DEFAULT_ITEMS, itemIdFromName } from './catalog.js';
import {
  emptyState, applyEvent, makeAdd, makeRemove, makeItem,
  getCount, itemTotal, userTotal, tableTotal, userMoney, summary,
} from './events.js';
import * as store from './store.js';
import { Mesh } from './mesh.js';
import { makeQR } from './qr.js';
import * as ui from './ui.js';

// ---- Estado em memoria ----
let room = null;
let log = [];              // eventos da mesa atual
let seen = new Set();      // eventIds ja vistos (deduplicacao / idempotencia)
let state = emptyState();
let mesh = null;
let pendingJoin = null;
let saveTimer = null;

const self = clientId();

// ---- Catalogo (padrao + personalizados sincronizados) ----
function customItems() {
  const arr = [];
  for (const { def } of state.items.values()) arr.push(def);
  arr.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return arr;
}
function allItems() { return [...DEFAULT_ITEMS, ...customItems()]; }
function resolveItem(id) {
  const c = state.items.get(id);
  if (c) return c.def;
  return DEFAULT_ITEMS.find((i) => i.id === id) || { id, emoji: '🍺', name: id, price: 0 };
}

// ---- Log / deduplicacao ----
function ingest(ev) {
  if (!ev || !ev.eventId || seen.has(ev.eventId)) return false;
  seen.add(ev.eventId);
  log.push(ev);
  applyEvent(state, ev);
  scheduleSave();
  return true;
}
function rebuildFrom(events) {
  log = []; seen = new Set(); state = emptyState();
  for (const ev of events) ingest(ev);
}
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (room) store.saveEvents(room, log); }, 400);
}

// ---- Acoes locais ----
function act(type, item) {
  if (type === 'REMOVE' && getCount(state, self, item) <= 0) {
    ui.toast('Nada pra tirar aqui 🙂');
    return;
  }
  const ev = type === 'ADD' ? makeAdd(item) : makeRemove(item);
  if (ingest(ev)) {
    if (mesh) mesh.broadcast({ k: 'ev', ev });
    afterChange(item, type === 'REMOVE' ? 'remove' : 'add');
  }
}
function addCustomItem({ emoji, name, price }) {
  const id = itemIdFromName(name);
  const ev = makeItem({ id, emoji, name, price: price || 0 });
  if (ingest(ev)) {
    if (mesh) mesh.broadcast({ k: 'ev', ev });
    render();
    ui.toast(`${emoji} ${name} na mesa!`);
  }
}

// ---- Eventos remotos (via DataChannel: live + anti-entropy) ----
function onRemoteEvent(ev, fromPeer) {
  if (ingest(ev)) {
    if (mesh) mesh.broadcast({ k: 'ev', ev }, fromPeer); // gossip: repassa aos demais
    if (ev.item) afterChange(ev.item, ev.type === 'REMOVE' ? 'remove' : 'add');
    else render();
  }
}

function afterChange(item, kind) {
  render();
  ui.pulse(item, kind);
  if (ui.isBebedeira()) ui.updateBebedeira(getCount(state, self, bebedeiraItem()));
}

// ---- Render ----
function render() {
  if (!room) return;
  const items = allItems().map((it) => ({
    id: it.id,
    emoji: it.emoji,
    name: it.name,
    qty: itemTotal(state, it.id),
    sub: `você ${getCount(state, self, it.id)}`,
  }));
  const showMoney = allItems().some((i) => i.price > 0);
  ui.renderTable({
    code: room,
    myTotal: userTotal(state, self),
    tableTotal: tableTotal(state),
    peerCount: (mesh ? mesh.connectedCount() : 0) + 1,
    showMoney,
    myMoney: userMoney(state, self, resolveItem),
    items,
  });
  renderPeers();
  const alone = (mesh ? mesh.connectedCount() : 0) === 0;
  ui.setConn(alone ? 'Você está sozinho na mesa — toque em MESA pra chamar a turma 🍻' : null);
}

function renderPeers() {
  const online = new Set((mesh ? mesh.peers() : []).filter((p) => p.online).map((p) => p.user));
  const rows = new Map();
  rows.set(self, {
    user: self, name: getName() || 'você', online: true,
    total: userTotal(state, self), money: userMoney(state, self, resolveItem),
  });
  for (const r of summary(state, resolveItem)) {
    rows.set(r.user, { ...r, online: r.user === self ? true : online.has(r.user) });
  }
  if (mesh) for (const p of mesh.peers()) {
    if (!rows.has(p.user)) rows.set(p.user, { user: p.user, name: p.name, total: 0, money: 0, online: p.online });
  }
  ui.renderPeers([...rows.values()], self);
}

// ---- Item padrao do modo bebedeira: o mais consumido por mim, senao cerveja ----
function bebedeiraItem() {
  let best = 'cerveja', bestN = -1;
  for (const it of allItems()) {
    const n = getCount(state, self, it.id);
    if (n > bestN) { bestN = n; best = it.id; }
  }
  return best;
}

// ---- Mesa ----
function enterTable(code, { create = false } = {}) {
  room = code;
  store.setCurrent(room);
  rebuildFrom(store.getEvents(room));

  ui.showScreen('table');
  render();

  mesh = new Mesh({
    room,
    selfId: self,
    name: getName(),
    onEvent: onRemoteEvent,
    onPeersChange: () => render(),
    onStatus: () => render(),
    getSyncPayload: () => log,
  });
  mesh.start();

  location.hash = '#/mesa?room=' + room;
  if (create) openInvite();
}

function leaveTable() {
  if (room) {
    store.saveEvents(room, log);
    store.pushHistory({
      room, at: Date.now(),
      myTotal: userTotal(state, self),
      tableTotal: tableTotal(state),
    });
  }
  if (mesh) { mesh.close(); mesh = null; }
  store.clearCurrent();
  room = null;
  location.hash = '';
  ui.closeOverlays();
  ui.showScreen('home');
  ui.renderHome(store.getHistory());
}

// ---- Convite ----
function inviteUrl() {
  return location.origin + location.pathname + '#/join?room=' + room;
}
function openInvite() {
  let qrNode;
  try { qrNode = makeQR(inviteUrl()); }
  catch { qrNode = document.createTextNode('—'); }
  ui.openInvite({ code: room, qrNode });
}

// ---- Handlers da UI ----
const handlers = {
  onName: (v) => setName(v),
  onCreate: () => {
    if (!getName()) { ui.toast('Bota teu apelido primeiro 😉'); return; }
    enterTable(newRoomCode(), { create: true });
  },
  onJoinCode: (code) => {
    code = (code || '').trim().toUpperCase();
    if (!code) { ui.toast('Digite o código da mesa'); return; }
    pendingJoin = code;
    if (getName()) enterTable(code);
    else ui.openJoin(code);
  },
  onJoinConfirm: (name) => {
    const n = setName(name);
    if (!n) { ui.toast('Bota teu apelido 😉'); return; }
    ui.closeOverlays();
    if (pendingJoin) enterTable(pendingJoin);
  },
  onLeave: () => leaveTable(),
  onAdd: (item) => act('ADD', item),
  onRemove: (item) => act('REMOVE', item),
  onAddItemConfirm: (def) => addCustomItem(def),
  onInvite: () => openInvite(),
  onPeers: () => { renderPeers(); ui.openPeers(); },
  onBebedeira: () => {
    const id = bebedeiraItem();
    ui.openBebedeira({ item: id, emoji: resolveItem(id).emoji, count: getCount(state, self, id) });
  },
  onBebedeiraClose: () => render(),
  onCopyLink: async () => {
    try { await navigator.clipboard.writeText(inviteUrl()); ui.toast('Link copiado! 📋'); }
    catch { ui.toast(inviteUrl()); }
  },
  onShare: async () => {
    try { await navigator.share({ title: 'Botequei', text: 'Bora pra mesa!', url: inviteUrl() }); }
    catch { /* cancelado */ }
  },
  onOpenHistory: (code) => enterTable(code),
};

// ---- Boot ----
function parseInviteRoom() {
  const src = (location.hash || '') + ' ' + (location.search || '');
  const m = src.match(/room=([A-Za-z0-9_-]+)/);
  return m ? m[1].toUpperCase() : null;
}

function boot() {
  ui.init(handlers);
  ui.setNameInput(getName());
  ui.renderHome(store.getHistory());

  const invited = parseInviteRoom();
  if (invited) {
    pendingJoin = invited;
    if (getName()) enterTable(invited);
    else ui.openJoin(invited);
  }

  // salvar/limpar ao fechar a aba
  window.addEventListener('pagehide', () => {
    if (room) { store.saveEvents(room, log); if (mesh) mesh.sig.leave(); }
  });

  // service worker (PWA / offline)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* ok sem SW */ });
  }
}

boot();
