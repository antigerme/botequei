// Orquestrador do Botequei: amarra identidade, eventos, malha WebRTC, UI, sons, PIX e share.

import { clientId, getName, setName, newRoomCode } from './identity.js';
import { DEFAULT_ITEMS, itemIdFromName, autoColor, autoAvatar } from './catalog.js';
import {
  emptyState, applyEvent, makeAdd, makeRemove, makeItem, makeProfile, makeTable,
  getCount, itemTotal, userTotal, tableTotal, userMoney, summary, getProfile, tableInfo, isDriver,
} from './events.js';
import { badgesFor, mvp, milestoneLine } from './achievements.js';
import { getSettings, setSettings } from './settings.js';
import * as store from './store.js';
import { Mesh } from './mesh.js';
import { makeQR } from './qr.js';
import { shareRecap } from './share.js';
import { pixPayload } from './pix.js';
import * as sound from './sound.js';
import * as ui from './ui.js';

// ---- Estado em memoria ----
let room = null;          // codigo exibido da mesa
let roomPin = '';         // PIN opcional (entra no id do signaling, nunca no link)
let log = [];
let seen = new Set();
let state = emptyState();
let mesh = null;
let pendingJoin = null;
let pendingPin = false;   // o convite pediu PIN?
let saveTimer = null;
let lastAction = null;    // { type, item } para o "desfazer"
let lastBill = null;
let myDriver = false;
let deferredPrompt = null;

const self = clientId();
let settings = getSettings();

// ---- Signaling room (com PIN) ----
function djb2(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); }
function sigRoom(code, pin) { return pin ? code + '~' + djb2(code + ':' + pin) : code; }

// ---- Catalogo (padrao com override de preco + personalizados) ----
function resolveItem(id) {
  const c = state.items.get(id);
  if (c) return c.def;
  return DEFAULT_ITEMS.find((i) => i.id === id) || { id, emoji: '🍺', name: id, price: 0 };
}
function allItems() {
  const seenIds = new Set();
  const out = [];
  for (const d of DEFAULT_ITEMS) { const o = state.items.get(d.id); out.push(o ? o.def : d); seenIds.add(d.id); }
  const customs = [];
  for (const [id, rec] of state.items) if (!seenIds.has(id)) customs.push(rec.def);
  customs.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return out.concat(customs);
}
function profOf(user) {
  const p = getProfile(state, user);
  return { name: p.name || (user === self ? getName() : ''), color: p.color || autoColor(user), emoji: p.emoji || autoAvatar(user), driver: p.driver };
}

// ---- Log / dedup ----
function ingest(ev) {
  if (!ev || !ev.eventId || seen.has(ev.eventId)) return false;
  seen.add(ev.eventId); log.push(ev); applyEvent(state, ev); scheduleSave();
  return true;
}
function rebuildFrom(events) { log = []; seen = new Set(); state = emptyState(); for (const ev of events) ingest(ev); }
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (room) store.saveEvents(room, log); }, 400); }

// evento local: registra + propaga
function emitLocal(ev) {
  if (!ingest(ev)) return false;
  if (mesh) mesh.broadcast({ k: 'ev', ev });
  return true;
}

// ---- Acoes de consumo ----
function act(type, item) {
  if (type === 'ADD' && isDriver(state, self) && !['agua', 'refri'].includes(item)) {
    ui.toast('🚗 Você é o motorista! Bora de água ou refri?'); return;
  }
  if (type === 'REMOVE' && getCount(state, self, item) <= 0) { ui.toast('Nada pra tirar aqui 🙂'); return; }
  const ev = type === 'ADD' ? makeAdd(item) : makeRemove(item);
  if (!emitLocal(ev)) return;
  lastAction = { type, item };
  afterChange(item, type === 'REMOVE' ? 'remove' : 'add');
  if (type === 'ADD') { sound.plus(); ui.vibrate(15); afterMyAdd(item); showUndo(item, '+1'); }
  else { sound.minus(); ui.vibrate([25, 40, 25]); showUndo(item, '−1'); }
}
function showUndo(item, label) {
  const it = resolveItem(item);
  ui.actionToast(`${it.emoji} ${label} · ${it.name}`, 'desfazer', undoLast);
}
function undoLast() {
  if (!lastAction) return;
  const inv = lastAction.type === 'ADD' ? makeRemove(lastAction.item) : makeAdd(lastAction.item);
  if (emitLocal(inv)) afterChange(lastAction.item, lastAction.type === 'ADD' ? 'remove' : 'add');
  lastAction = null;
}
function afterMyAdd(item) {
  const mine = userTotal(state, self);
  if (settings.limit > 0 && mine === settings.limit) {
    sound.alarm(); ui.vibrate([100, 50, 100]);
    ui.actionToast(`🎯 Você chegou na meta de ${settings.limit}!`, '🚗 Chamar carro', callCar);
  }
  const alcoholic = !['agua', 'refri'].includes(item);
  if (alcoholic && settings.waterEvery > 0) {
    const alc = mine - getCount(state, self, 'agua') - getCount(state, self, 'refri');
    if (alc > 0 && alc % settings.waterEvery === 0) ui.toast('💧 Hora da água!');
  }
}
function callCar() { try { window.open('https://m.uber.com/ul/', '_blank', 'noopener'); } catch { /* ignore */ } }

function addCustomItem({ emoji, name, price }) {
  const id = itemIdFromName(name);
  if (emitLocal(makeItem({ id, emoji, name, price: price || 0 }))) { render(); ui.toast(`${emoji} ${name} na mesa!`); }
}

// ---- Rodada coletiva ----
function rodada() {
  const item = 'cerveja';
  const targets = [{ user: self, name: getName() }];
  if (mesh) for (const p of mesh.peers()) if (p.online) targets.push({ user: p.user, name: profOf(p.user).name });
  let n = 0;
  for (const t of targets) {
    if (isDriver(state, t.user)) continue;
    if (emitLocal(makeAdd(item, t.user, t.name))) n++;
  }
  if (mesh) mesh.sendFx({ kind: 'react', emoji: '🍻' });
  ui.floatReaction('🍻'); ui.floatReaction('🍻'); sound.cheers();
  afterChange(item, 'add');
  ui.toast(n ? `🍻 Rodada! +1 pra ${n}` : 'Rodada! 🍻');
}

// ---- Efeitos sociais ----
function onBrinde() { ui.brinde(); if (mesh) mesh.sendFx({ kind: 'brinde' }); }
function onReact(emoji) { ui.floatReaction(emoji); if (mesh) mesh.sendFx({ kind: 'react', emoji }); }
function onFx(fx) {
  if (!fx) return;
  if (fx.kind === 'brinde') ui.brinde();
  else if (fx.kind === 'react') ui.floatReaction(fx.emoji || '🍻');
}

// ---- Eventos remotos ----
function onRemoteEvent(ev, fromPeer) {
  if (!ingest(ev)) return;
  if (mesh) mesh.broadcast({ k: 'ev', ev }, fromPeer); // gossip
  if (ev.type === 'ADD' && ev.user !== self) {
    const p = profOf(ev.user);
    ui.floatPlus(`${p.name || 'alguém'} ${resolveItem(ev.item).emoji}+1`, p.color);
    sound.pop();
    const rows = summary(state, resolveItem);
    const line = milestoneLine(p.name || 'alguém', userTotal(state, ev.user), rows[0] && rows[0].name);
    if (line) ui.toast(line);
  }
  if (ev.item) afterChange(ev.item, ev.type === 'REMOVE' ? 'remove' : 'add');
  else render();
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
    id: it.id, emoji: it.emoji, name: it.name,
    qty: itemTotal(state, it.id), sub: `você ${getCount(state, self, it.id)}`,
  }));
  const t = tableInfo(state);
  ui.renderTable({
    code: room,
    title: t.title || '',
    myTotal: userTotal(state, self),
    tableTotal: tableTotal(state),
    peerCount: (mesh ? mesh.connectedCount() : 0) + 1,
    showMoney: allItems().some((i) => i.price > 0),
    myMoney: userMoney(state, self, resolveItem),
    items,
  });
  renderPeers();
  const mp = mesh ? mesh.peers() : [];
  const online = mp.filter((p) => p.online).length;
  if (mp.length === 0) ui.setConn('Você está sozinho na mesa — toque em MESA pra chamar a turma 🍻');
  else if (online < mp.length) ui.setConn(`Reconectando… 🟡 (${online}/${mp.length} na mesa)`);
  else ui.setConn(null);
}

function renderPeers() {
  const rows = summary(state, resolveItem).map((r) => {
    const p = profOf(r.user);
    return { ...r, name: p.name, color: p.color, emoji: p.emoji, badges: badgesFor(state, r.user) };
  });
  // garante que eu apareço mesmo sem ter consumido
  if (!rows.some((r) => r.user === self)) {
    const p = profOf(self);
    rows.push({ user: self, name: p.name, color: p.color, emoji: p.emoji, driver: p.driver, total: 0, money: 0, badges: badgesFor(state, self) });
  }
  ui.renderPeers({ rows, selfId: self, mvp: mvp(state, resolveItem), myBadges: badgesFor(state, self) });
}

function bebedeiraItem() {
  let best = 'cerveja', bestN = -1;
  for (const it of allItems()) { const n = getCount(state, self, it.id); if (n > bestN) { bestN = n; best = it.id; } }
  return best;
}

// ---- Mesa ----
async function enterTable(code, { create = false, pin = '' } = {}) {
  room = code; roomPin = pin;
  store.setCurrent(room);
  rebuildFrom(store.getEvents(room));
  ui.showScreen('table');
  render();
  if (create) openInvite();

  const iceServers = await loadIce();
  if (room !== code) return;

  startMesh(iceServers);
  location.hash = '#/mesa?room=' + room;
}

function startMesh(iceServers) {
  mesh = new Mesh({
    room: sigRoom(room, roomPin), selfId: self, name: getName(), iceServers,
    onEvent: onRemoteEvent, onFx, onPeersChange: () => render(), onStatus: () => render(),
    getSyncPayload: () => log,
  });
  mesh.start();
  // publica meu perfil (cor/avatar) pra galera
  emitLocal(makeProfile({ color: settings.profColor || autoColor(self), emoji: settings.profEmoji || autoAvatar(self), driver: myDriver }));
}

function restartMesh() {
  if (mesh) { mesh.close(); mesh = null; }
  loadIce().then((ice) => { if (room) startMesh(ice); });
}

async function loadIce() {
  const fallback = [{ urls: 'stun:stun.l.google.com:19302' }];
  try {
    const r = await fetch('turn.php', { cache: 'no-store' });
    if (r.status !== 200) return fallback;
    const d = await r.json();
    return Array.isArray(d.iceServers) && d.iceServers.length ? d.iceServers : fallback;
  } catch { return fallback; }
}

function leaveTable() {
  if (room) {
    store.saveEvents(room, log);
    store.pushHistory({ room, at: Date.now(), myTotal: userTotal(state, self), tableTotal: tableTotal(state) });
  }
  if (mesh) { mesh.close(); mesh = null; }
  store.clearCurrent();
  room = null; roomPin = ''; myDriver = false;
  location.hash = '';
  ui.closeOverlays(); ui.showScreen('home'); ui.renderHome(store.getHistory());
}

// ---- Convite ----
function inviteUrl() { return location.origin + location.pathname + '#/join?room=' + room + (roomPin ? '&pin=1' : ''); }
function openInvite() {
  let qrNode; try { qrNode = makeQR(inviteUrl()); } catch { qrNode = document.createTextNode('—'); }
  const t = tableInfo(state);
  ui.openInvite({ code: room, qrNode, title: t.title, emoji: t.emoji, pin: roomPin });
}
function setTable(patch) {
  const cur = tableInfo(state);
  emitLocal(makeTable({ title: patch.title !== undefined ? patch.title : cur.title, emoji: patch.emoji !== undefined ? patch.emoji : cur.emoji }));
  render();
}

// ---- Conta ----
function computeBill() {
  const o = ui.billOptions();
  const rows = summary(state, resolveItem);
  const N = rows.length || 1;
  const sumConsumo = rows.reduce((a, r) => a + r.money, 0);
  const mult = o.service ? 1.1 : 1;
  const out = rows.map((r) => {
    const p = profOf(r.user);
    const consumo = o.equal ? sumConsumo / N : r.money;
    return { user: r.user, name: p.name, color: p.color, emoji: p.emoji, amount: consumo * mult + o.couvert };
  });
  return { rows: out, total: out.reduce((a, r) => a + r.amount, 0), hasPrices: allItems().some((i) => i.price > 0) };
}
function renderBill() {
  const b = computeBill(); lastBill = b;
  const note = b.hasPrices ? 'Divisão por consumo — ajuste as opções.' : 'Sem preços nos itens: use “rachar igual” ou couvert.';
  ui.renderBill({ rows: b.rows, total: b.total, note, canPix: !!settings.pixKey, selfId: self });
}

// ---- Handlers ----
const handlers = {
  onName: (v) => setName(v),
  onCreate: () => { if (!getName()) { ui.toast('Bota teu apelido primeiro 😉'); return; } enterTable(newRoomCode(), { create: true }); },
  onJoinCode: (code) => {
    code = (code || '').trim().toUpperCase();
    if (!code) { ui.toast('Digite o código da mesa'); return; }
    pendingJoin = code; pendingPin = false;
    if (getName()) enterTable(code); else ui.openJoin(code, false);
  },
  onJoinConfirm: (name, pin) => {
    const n = setName(name);
    if (!n) { ui.toast('Bota teu apelido 😉'); return; }
    ui.closeOverlays();
    if (pendingJoin) enterTable(pendingJoin, { pin: pendingPin ? (pin || '').trim() : '' });
  },
  onLeave: leaveTable,
  onAdd: (item) => act('ADD', item),
  onRemove: (item) => act('REMOVE', item),
  onAddItemConfirm: addCustomItem,
  onInvite: openInvite,
  onPeers: () => { renderPeers(); ui.openPeers(); },
  onMenu: () => {},
  onBrinde, onReact, onRodada: rodada,
  onBrindeGo: () => sound.cheers(),
  onProfile: () => { const p = profOf(self); ui.openProfile({ name: getName(), color: p.color, emoji: p.emoji, driver: myDriver }); },
  onProfileSave: ({ name, color, emoji, driver }) => {
    if (name) { setName(name); ui.setNameInput(getName()); }
    settings = setSettings({ profColor: color, profEmoji: emoji });
    myDriver = !!driver;
    emitLocal(makeProfile({ color, emoji, driver })); render(); ui.toast('Perfil salvo 🎨');
  },
  onTableName: (name) => setTable({ title: name }),
  onTableEmoji: (emoji) => setTable({ emoji }),
  onInvitePin: (pin) => {
    pin = (pin || '').trim();
    if (mesh && mesh.connectedCount() > 0) { ui.toast('Defina o PIN antes da galera entrar 🙂'); return; }
    roomPin = pin; restartMesh(); openInvite();
    ui.toast(pin ? '🔒 PIN ativado nesta mesa' : 'PIN removido');
  },
  onBill: () => { ui.openBill(); renderBill(); },
  onBillChange: renderBill,
  onPrices: () => ui.openPrices(allItems()),
  onPriceChange: (id, price) => {
    const it = resolveItem(id);
    emitLocal(makeItem({ id, emoji: it.emoji, name: it.name, price: Math.max(0, parseFloat(String(price).replace(',', '.')) || 0) }));
    render();
  },
  onPix: (user) => {
    if (!settings.pixKey) { ui.toast('Configure sua chave PIX nas ⚙️ configurações'); return; }
    const r = (lastBill && lastBill.rows || []).find((x) => x.user === user);
    if (!r) return;
    const payload = pixPayload({ key: settings.pixKey, name: getName() || 'Recebedor', city: settings.pixCity || 'BRASIL', amount: r.amount, txid: 'BOTEQUEI', description: 'Botequei' });
    let qrNode; try { qrNode = makeQR(payload); } catch { qrNode = null; }
    ui.openPix({ title: `Cobrar ${r.name || ''}`, code: payload, qrNode });
  },
  onPixCopy: async () => { try { await navigator.clipboard.writeText(ui.pixCode()); ui.toast('PIX copiado! 📋'); } catch { ui.toast('Selecione e copie o código'); } },
  onShareNight: async () => {
    const res = await shareRecap(state, resolveItem).catch(() => 'error');
    if (res === 'download') ui.toast('Imagem salva 📸'); else if (res === 'error') ui.toast('Não consegui gerar 😕');
  },
  onBebedeira: () => { const id = bebedeiraItem(); ui.openBebedeira({ item: id, emoji: resolveItem(id).emoji, count: getCount(state, self, id) }); },
  onBebedeiraClose: () => render(),
  onCopyLink: async () => { try { await navigator.clipboard.writeText(inviteUrl()); ui.toast('Link copiado! 📋'); } catch { ui.toast(inviteUrl()); } },
  onShareInvite: async () => { try { await navigator.share({ title: 'Botequei', text: 'Bora pra mesa!', url: inviteUrl() }); } catch { /* cancelado */ } },
  onNfc: async () => {
    if (!('NDEFReader' in window)) { ui.toast('NFC não suportado neste aparelho'); return; }
    try { await new window.NDEFReader().write({ records: [{ recordType: 'url', data: inviteUrl() }] }); ui.toast('📡 Aproxime o outro celular'); }
    catch { ui.toast('Não consegui usar o NFC 😕'); }
  },
  onOpenHistory: (code) => enterTable(code),
  onOpenSettings: () => ui.fillSettings(settings),
  onSetting: (patch) => { settings = setSettings(patch); ui.applyTheme(settings); sound.setEnabled(settings.sound); if (room) render(); },
  onClearData: () => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('botequei.')) localStorage.removeItem(k);
    location.reload();
  },
  onInstall: async () => {
    if (!deferredPrompt) { ui.toast('Use “Adicionar à tela inicial” no menu do navegador'); return; }
    deferredPrompt.prompt(); deferredPrompt = null; ui.showInstall(false);
  },
};

// ---- Boot ----
function parseInvite() {
  const src = (location.hash || '') + ' ' + (location.search || '');
  const room = (src.match(/room=([A-Za-z0-9_-]+)/) || [])[1];
  const needPin = /[?&#]pin=1\b/.test(src);
  return room ? { room: room.toUpperCase(), needPin } : null;
}

function boot() {
  ui.init(handlers);
  ui.applyTheme(settings);
  sound.setEnabled(settings.sound);
  ui.setNameInput(getName());
  ui.renderHome(store.getHistory());

  const inv = parseInvite();
  if (inv) {
    pendingJoin = inv.room; pendingPin = inv.needPin;
    if (getName() && !inv.needPin) enterTable(inv.room);
    else ui.openJoin(inv.room, inv.needPin);
  }

  window.addEventListener('pagehide', () => { if (room) { store.saveEvents(room, log); if (mesh) mesh.sig.leave(); } });
  const wake = () => { if (!document.hidden && mesh) mesh.wake(); };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; ui.showInstall(true); });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
