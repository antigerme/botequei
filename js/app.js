// Orquestrador do Botequei: amarra identidade, eventos, malha WebRTC, UI, sons, PIX e share.

import { clientId, getName, setName, newRoomCode } from './identity.js';
import { DEFAULT_ITEMS, itemIdFromName, autoColor, autoAvatar, catOf } from './catalog.js';
import {
  emptyState, applyEvent, makeAdd, makeRemove, makeItem, makeProfile, makeTable, makeHappyHour, makePayFor, makeSong,
  getCount, itemTotal, userTotal, tableTotal, userMoney, summary, getProfile, tableInfo, isDriver, happyHour,
  paysFor, payerOf, songs,
} from './events.js';
import { badgesFor, milestoneLine, ceremonyAwards } from './achievements.js';
import { paceInfo, timeline, estimateBAC, lastDrinkAt, hydration, driveVerdict, projectAt, coachTips } from './stats.js';
import { lifeStats, lifeBadges, monthlyTrend, weekdayInsight, retro } from './lifestats.js';
import { levelFor, weeklyChallenges, seasonAward } from './league.js';
import { mergeNight, rankTournament } from './tournament.js';
import { pickCard } from './deck.js';
import { getSettings, setSettings } from './settings.js';
import * as store from './store.js';
import { Mesh } from './mesh.js';
import { makeQR } from './qr.js';
import { encodeBlob, decodeBlob } from './handshake.js';
import { shareRecap, shareBill, shareCeremony, shareRetro } from './share.js';
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
let lastAwards = [];      // troféus da última cerimônia (p/ compartilhar / mostrar pra mesa)
let myDriver = false;
let deferredPrompt = null;

const self = clientId();
let settings = getSettings();
let offlineWaiting = false;   // convidado esperando o anfitrião ler a resposta (fecha sozinho ao conectar)
let lastTableMilestone = 0;   // comemora a cada 10 rodadas da mesa (marco); sincronizado no sync
let hhEndedFor = 0;           // 'until' do happy hour cujo fechamento já foi comemorado
let limitAlerted = false;   // pra a meta alertar uma vez (mesmo se ultrapassar de vez)
let renderScheduled = false;
let sessionStart = 0;        // quando entrei nesta mesa (p/ duração no histórico)
let lastNudge = 0;           // cooldown do aviso de ritmo
let prevOnline = new Set();  // presença: quem estava online (p/ avisar entrou/saiu)
let presenceSeeded = false;  // 1ª passada de presença só semeia (sem toast)
let sessionMates = new Set(); // nomes que apareceram na mesa (p/ "com quem você mais bebeu")
let pendingBarMenu = false;  // ao abrir "mesa do bar", carrega o cardápio salvo
let lastRetro = null;        // dados da última retrospectiva (p/ compartilhar)
let concernAt = new Map();   // cooldown do "cuida do fulano" por pessoa
let lastCard = null;         // última carta sorteada (p/ mostrar pra mesa)
let shakeHandler = null, shakeLast = 0; // mãos livres (chacoalhar pra +1)

// itens alcoolicos (motorista nao registra esses; contam pro lembrete de agua)
const ALCOHOL = new Set(['cerveja', 'chopp', 'dose', 'drink']);
function myAlcohol() { let n = 0; for (const id of ALCOHOL) n += getCount(state, self, id); return n; }
function leaderName() {
  let best = null, bestN = -1;
  for (const u of state.users) { if (isDriver(state, u)) continue; const t = userTotal(state, u); if (t > bestN) { bestN = t; best = u; } }
  return best ? profOf(best).name : '';
}
// coalesce renders (evita re-render por evento durante o sync em massa)
function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  const run = () => { renderScheduled = false; render(); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run); else setTimeout(run, 16);
}

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
  return { name: p.name || (user === self ? getName() : ''), color: p.color || autoColor(user), emoji: p.emoji || autoAvatar(user), driver: p.driver, level: p.level || 0 };
}

// ---- Log / dedup ----
function ingest(ev) {
  if (!ev || !ev.eventId || seen.has(ev.eventId)) return false;
  seen.add(ev.eventId); log.push(ev); applyEvent(state, ev); scheduleSave();
  return true;
}
function rebuildFrom(events) { log = []; seen = new Set(); state = emptyState(); for (const ev of events) ingest(ev); lastTableMilestone = Math.floor(tableTotal(state) / 10); const hh0 = happyHour(state); hhEndedFor = hh0 && hh0.until <= Date.now() ? hh0.until : 0; }
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (room) store.saveEvents(room, log); }, 400); }

// evento local: registra + propaga
function emitLocal(ev) {
  if (!ingest(ev)) return false;
  if (mesh) mesh.broadcast({ k: 'ev', ev });
  return true;
}

// ---- Acoes de consumo ----
function act(type, item) {
  if (type === 'ADD' && isDriver(state, self) && ALCOHOL.has(item)) {
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
function checkLimit() {
  if (settings.limit <= 0) return;
  const mine = userTotal(state, self);
  if (mine >= settings.limit && !limitAlerted) {
    limitAlerted = true;
    sound.alarm(); ui.vibrate([100, 50, 100]);
    ui.actionToast(`🎯 Você chegou na meta de ${settings.limit}!`, '🚗 Chamar carro', callCar);
  } else if (mine < settings.limit) {
    limitAlerted = false; // desfez e voltou pra baixo -> pode alertar de novo
  }
}
function afterMyAdd(item) {
  checkLimit();
  if (ALCOHOL.has(item) && settings.waterEvery > 0) {
    const alc = myAlcohol();
    if (alc > 0 && alc % settings.waterEvery === 0) ui.toast('💧 Hora da água!');
  }
  checkPace();
  checkTableMilestone();
}
// Aviso de ritmo. No "modo responsa" fica mais firme: dispara já no ritmo médio e insiste mais.
function checkPace() {
  if (settings.nudges === false) return;
  const p = paceInfo(log, self, resolveItem, { now: Date.now() });
  const firm = !!settings.responsa;
  const trigger = firm ? (p.level === 'alto' || p.level === 'medio') : p.level === 'alto';
  const cooldown = firm ? 150000 : 240000;
  if (trigger && Date.now() - lastNudge > cooldown) {
    lastNudge = Date.now();
    ui.toast(firm ? '🛟 Segura o ritmo! Manda uma água agora. 💧' : '🐢 Tá voando! Bora uma água? 💧');
    sound.alarm();
  }
}
// "Cuida do fulano": o ritmo de um peer é derivável do log compartilhado (sem expor BAC).
function maybeConcern(user) {
  const p = paceInfo(log, user, resolveItem, { now: Date.now() });
  if (p.level !== 'alto') return;
  if (Date.now() - (concernAt.get(user) || 0) < 300000) return; // 5 min por pessoa
  concernAt.set(user, Date.now());
  ui.toast(`🫶 Fica de olho no ${profOf(user).name || 'pessoal'} — tá num ritmo forte.`);
}
// Rodada de água coletiva: +1 água pra todo mundo online + animação sincronizada.
function waterRound() {
  const targets = [{ user: self, name: getName() }];
  if (mesh) for (const p of mesh.peers()) if (p.online) targets.push({ user: p.user, name: profOf(p.user).name });
  let n = 0;
  for (const t of targets) if (emitLocal(makeAdd('agua', t.user, t.name))) n++;
  if (mesh) mesh.sendFx({ kind: 'water' });
  ui.floatReaction('💧'); ui.floatReaction('💦'); sound.plus();
  ui.celebrate(['💧', '💦', '🚰', '🫗']);
  afterChange('agua', 'add');
  ui.toast(n > 1 ? `💧 Rodada de água! +1 pra ${n}` : '💧 Bebeu água! 👏');
}
function callCar() {
  const url = settings.carApp === '99' ? 'https://99app.com/' : 'https://m.uber.com/ul/';
  try { window.open(url, '_blank', 'noopener'); } catch { /* ignore */ }
}
// Marco da mesa: a cada 10 rodadas, joga confete + aviso. Reajusta se desfizerem.
function checkTableMilestone() {
  const total = tableTotal(state);
  const m = Math.floor(total / 10);
  if (total > 0 && m > lastTableMilestone) {
    lastTableMilestone = m;
    ui.celebrate();
    ui.toast(`🎉 ${total} rodadas na mesa!`);
  } else if (m < lastTableMilestone) {
    lastTableMilestone = m;
  }
}
// Happy hour: atualiza o cronômetro compartilhado e comemora quando fecha.
function tickHappyHour() {
  const hh = happyHour(state);
  const now = Date.now();
  if (hh && hh.until > now) {
    const r = hh.until - now;
    const mm = Math.floor(r / 60000), ss = Math.floor((r % 60000) / 1000);
    const rounds = Math.max(0, tableTotal(state) - hh.startTotal);
    ui.setHappyHour(`🍺 HAPPY HOUR · ${mm}:${String(ss).padStart(2, '0')} · ${rounds} rodada${rounds === 1 ? '' : 's'}`);
  } else {
    ui.setHappyHour(null);
    if (hh && hh.until && hhEndedFor !== hh.until) {
      hhEndedFor = hh.until;
      const rounds = Math.max(0, tableTotal(state) - hh.startTotal);
      if (rounds > 0) { ui.celebrate(['🍺', '🏆', '🎉', '🥂']); ui.toast(`🍺 Happy hour fechou: ${rounds} rodada${rounds === 1 ? '' : 's'}!`); }
    }
  }
}

function addCustomItem({ emoji, name, price, cat, note }) {
  const id = itemIdFromName(name);
  if (emitLocal(makeItem({ id, emoji, name, price: price || 0, cat: cat || 'outros', note: (note || '').slice(0, 40) }))) { render(); ui.toast(`${emoji} ${name} na mesa!`); }
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
  ui.celebrate(['🍻', '🎉', '🥂']);
  afterChange(item, 'add');
  lastTableMilestone = Math.floor(tableTotal(state) / 10); // sincroniza o marco (evita confete duplo)
  ui.toast(n ? `🍻 Rodada! +1 pra ${n}` : 'Rodada! 🍻');
}

// ---- Efeitos sociais ----
function onBrinde() { ui.brinde(); if (mesh) mesh.sendFx({ kind: 'brinde' }); }
function onReact(emoji) { ui.floatReaction(emoji); if (mesh) mesh.sendFx({ kind: 'react', emoji }); }
function onFx(fx) {
  if (!fx) return;
  if (fx.kind === 'brinde') ui.brinde();
  else if (fx.kind === 'react') ui.floatReaction(fx.emoji || '🍻');
  else if (fx.kind === 'roulette') { if (Array.isArray(fx.entrants)) ui.runRoulette(fx.entrants, fx.winner); }
  else if (fx.kind === 'poke') { if (fx.to === self) receivePoke(fx); }
  else if (fx.kind === 'challenge') { if (fx.to === self) receiveChallenge(fx); }
  else if (fx.kind === 'ceremony') { if (Array.isArray(fx.awards)) ui.openCeremony({ awards: fx.awards }); }
  else if (fx.kind === 'waiter') receiveWaiter(fx);
  else if (fx.kind === 'water') { ui.floatReaction('💧'); ui.celebrate(['💧', '💦', '🚰']); ui.toast('💧 Rodada de água na mesa!'); sound.plus(); }
  else if (fx.kind === 'card') { ui.openCard({ emoji: fx.emoji, text: fx.text }); sound.pop(); }
}

// Mãos livres: chacoalhar o celular soma +1 (do item mais consumido). Cooldown + guarda.
function enableShake() {
  if (shakeHandler) return;
  const attach = () => {
    shakeHandler = (e) => {
      const a = e.accelerationIncludingGravity || e.acceleration;
      if (!a) return;
      const mag = Math.abs(a.x || 0) + Math.abs(a.y || 0) + Math.abs(a.z || 0);
      if (mag > 34 && Date.now() - shakeLast > 1200) {
        shakeLast = Date.now();
        if (room && !document.querySelector('.overlay:not([hidden])') && !ui.isBebedeira()) act('ADD', bebedeiraItem());
      }
    };
    window.addEventListener('devicemotion', shakeHandler);
  };
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    DeviceMotionEvent.requestPermission().then((r) => { if (r === 'granted') attach(); else ui.toast('Precisa permitir o movimento 📳'); }).catch(() => {});
  } else attach();
}
function disableShake() { if (shakeHandler) { window.removeEventListener('devicemotion', shakeHandler); shakeHandler = null; } }
function receiveWaiter(fx) {
  ui.toast(`🔔 ${fx.fromName || 'Alguém'} chamou o garçom!`);
  sound.alarm(); ui.vibrate([80, 40, 80]); ui.floatReaction('🔔');
}
function receivePoke(fx) {
  ui.toast(`👉 ${fx.fromName || 'Alguém'} te cutucou!`);
  sound.poke(); ui.vibrate([30, 40, 30]); ui.floatReaction('👉');
}
function receiveChallenge(fx) {
  const it = resolveItem(fx.item || 'dose');
  sound.challenge(); ui.vibrate([60, 40, 60, 40, 60]);
  ui.actionToast(`🥃 ${fx.fromName || 'Alguém'} te desafiou: ${it.emoji} ${it.name}!`, 'Aceitar 😈', () => act('ADD', fx.item || 'dose'), 7000);
}

// ---- Eventos remotos ----
function onRemoteEvent(ev, fromPeer, isSync) {
  if (!ingest(ev)) return;
  if (mesh) mesh.broadcast({ k: 'ev', ev }, fromPeer); // gossip
  if (ev.type === 'HAPPYHOUR' && Number(ev.until) <= Date.now()) hhEndedFor = Number(ev.until); // happy hour já vencido (veio no sync): não comemora
  if (ev.type === 'ADD' && ev.user === self) checkLimit(); // alguém somou pra mim (rodada)
  if (isSync) { if (ev.type === 'ADD') lastTableMilestone = Math.floor(tableTotal(state) / 10); scheduleRender(); return; }
  if (ev.type === 'ADD') checkTableMilestone();
  if (ev.type === 'SONG') ui.renderJukebox(songs(state));
  if (ev.type === 'ADD' && ev.user !== self) {
    const p = profOf(ev.user);
    ui.floatPlus(`${p.name || 'alguém'} ${resolveItem(ev.item).emoji}+1`, p.color);
    sound.pop();
    const line = milestoneLine(p.name || 'alguém', userTotal(state, ev.user), leaderName());
    if (line) ui.toast(line);
    maybeConcern(ev.user); // "cuida do fulano": ritmo do peer é derivável do log compartilhado
  }
  if (ev.item) afterChange(ev.item, ev.type === 'REMOVE' ? 'remove' : 'add');
  else scheduleRender();
}

function afterChange(item, kind) {
  scheduleRender();
  ui.pulse(item, kind);
  if (ui.isBebedeira()) ui.updateBebedeira(getCount(state, self, ui.currentBebedeiraItem()));
}

// ---- Render ----
function render() {
  if (!room) return;
  const list = allItems();
  const items = list.map((it) => ({
    id: it.id, emoji: it.emoji, name: it.name, cat: catOf(it), note: it.note || '',
    qty: itemTotal(state, it.id), sub: `você ${getCount(state, self, it.id)}`,
  }));
  const t = tableInfo(state);
  const tt = tableTotal(state);
  ui.renderTable({
    code: room,
    title: t.title || '',
    myTotal: userTotal(state, self),
    tableTotal: tt,
    peerCount: (mesh ? mesh.connectedCount() : 0) + 1,
    showMoney: list.some((i) => i.price > 0),
    myMoney: userMoney(state, self, resolveItem),
    heroFill: tt === 0 ? 0 : ((tt - 1) % 10 + 1) / 10 * 100, // nível de chopp: enche a cada 10
    items,
  });
  renderPeers();
  renderPresence();
  const mp = mesh ? mesh.peers() : [];
  const online = mp.filter((p) => p.online).length;
  if (mp.length === 0) ui.setConn('Você está sozinho na mesa — toque em MESA pra chamar a turma 🍻');
  else if (online < mp.length) ui.setConn(`Reconectando… 🟡 (${online}/${mp.length} na mesa)`);
  else ui.setConn(null);
  tickHappyHour();
}

function renderPresence() {
  const me = profOf(self);
  const list = [{ user: self, emoji: me.emoji, color: me.color, name: getName() || 'você', level: me.level, online: true, self: true }];
  if (mesh) for (const p of mesh.peers()) { const pr = profOf(p.user); list.push({ user: p.user, emoji: pr.emoji, color: pr.color, name: pr.name || 'alguém', level: pr.level, online: p.online }); }
  ui.renderPresence(list);
}

function renderPeers() {
  const base = summary(state, resolveItem); // uma passada só
  const nets = new Map();
  if (mesh) for (const p of mesh.peers()) nets.set(p.user, { online: p.online, conn: p.conn });
  const rows = base.map((r) => {
    const p = profOf(r.user);
    const net = nets.get(r.user);
    return { ...r, name: p.name, color: p.color, emoji: p.emoji, level: p.level, badges: badgesFor(state, r.user), online: net ? net.online : undefined, conn: net ? net.conn : null };
  });
  // garante que eu apareço mesmo sem ter consumido
  if (!rows.some((r) => r.user === self)) {
    const p = profOf(self);
    rows.push({ user: self, name: p.name, color: p.color, emoji: p.emoji, driver: p.driver, total: 0, money: 0, badges: badgesFor(state, self) });
  }
  const top = base.find((r) => !r.driver && r.total > 0); // MVP derivado (base já vem ordenado)
  ui.renderPeers({ rows, selfId: self, mvp: top ? { name: profOf(top.user).name, total: top.total } : null, myBadges: badgesFor(state, self) });
}

function bebedeiraItem() {
  let best = 'cerveja', bestN = -1;
  for (const it of allItems()) { const n = getCount(state, self, it.id); if (n > bestN) { bestN = n; best = it.id; } }
  return best;
}

// ---- Mesa ----
async function enterTable(code, { create = false, pin = '' } = {}) {
  room = code; roomPin = pin; sessionStart = Date.now(); sessionMates = new Set();
  store.setCurrent(room);
  rebuildFrom(store.getEvents(room));
  ui.showScreen('table');
  render();
  if (create) openInvite();
  if (pendingBarMenu) { pendingBarMenu = false; loadBarMenu(); }

  const iceServers = await loadIce();
  if (room !== code) return;

  startMesh(iceServers);
  location.hash = '#/mesa?room=' + room;
}

// Entra numa mesa SEM depender de internet/signaling (fluxo do convite offline).
// ICE vazio => host candidates (mesma Wi-Fi/hotspot). O signaling ainda tenta em 2º
// plano (falha de boa) — se a internet voltar, a malha se completa sozinha.
function enterTableOffline(code) {
  room = code; roomPin = ''; sessionStart = Date.now(); sessionMates = new Set();
  store.setCurrent(room);
  rebuildFrom(store.getEvents(room));
  ui.showScreen('table');
  render();
  startMesh([]);
  location.hash = '#/mesa?room=' + room;
}

function onMeshChange() {
  diffPresence();
  render();
  // convidado: assim que a conexão sobe, fecha o painel de pareamento offline sozinho
  if (offlineWaiting && mesh && mesh.connectedCount() > 0) {
    offlineWaiting = false;
    ui.closeOverlays();
    ui.toast('🎉 Entrou na mesa sem internet!');
  }
}
// Avisa quem entrou/saiu ao vivo. A 1ª passada só semeia (evita despejar toasts ao entrar).
function diffPresence() {
  if (!mesh) return;
  const cur = new Set(mesh.peers().filter((p) => p.online).map((p) => p.user));
  for (const u of cur) { const n = profOf(u).name; if (n) sessionMates.add(n); } // "com quem você bebeu"
  if (!presenceSeeded) { prevOnline = cur; presenceSeeded = true; return; }
  for (const u of cur) if (!prevOnline.has(u)) { ui.toast(`🍻 ${profOf(u).name || 'Alguém'} entrou!`); sound.pop(); }
  for (const u of prevOnline) if (!cur.has(u)) ui.toast(`👋 ${profOf(u).name || 'Alguém'} saiu`);
  prevOnline = cur;
}

function startMesh(iceServers) {
  presenceSeeded = false; prevOnline = new Set();
  mesh = new Mesh({
    room: sigRoom(room, roomPin), code: room, selfId: self, name: getName(), iceServers,
    onEvent: onRemoteEvent, onFx, onPeersChange: onMeshChange, onStatus: onMeshChange,
    getSyncPayload: () => log,
  });
  mesh.start();
  // publica meu perfil (cor/avatar) pra galera
  emitLocal(makeProfile({ color: settings.profColor || autoColor(self), emoji: settings.profEmoji || autoAvatar(self), driver: myDriver, level: myLevel() }));
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

function myItems() {
  const m = {};
  for (const it of allItems()) { const n = getCount(state, self, it.id); if (n > 0) m[it.id] = n; }
  return m;
}
function leaveTable() {
  if (room) {
    store.saveEvents(room, log);
    const t = tableInfo(state);
    store.pushHistory({
      room, at: Date.now(),
      myTotal: userTotal(state, self), tableTotal: tableTotal(state),
      myMoney: userMoney(state, self, resolveItem),
      title: t.title || '',
      items: myItems(),
      mates: [...sessionMates],
      durationMs: sessionStart ? Date.now() - sessionStart : 0,
    });
  }
  if (mesh) { mesh.close(); mesh = null; }
  store.clearCurrent();
  room = null; roomPin = ''; myDriver = false; limitAlerted = false; offlineWaiting = false;
  lastTableMilestone = 0; hhEndedFor = 0; sessionStart = 0; lastNudge = 0; lastAwards = [];
  prevOnline = new Set(); presenceSeeded = false; sessionMates = new Set(); concernAt = new Map();
  ui.setHappyHour(null);
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

// ---- Pareamento sem internet (QR/código, serverless) ----
// Anfitrião (já numa mesa): gera o convite (offer com ICE embutido) e espera a resposta.
async function offlineHost() {
  if (!mesh || !room) { ui.toast('Entre numa mesa primeiro 🙂'); return; }
  ui.openOfflineHost();
  try {
    const blob = await mesh.createManualOffer();
    blob.room = room;
    const code = await encodeBlob(blob);
    let qr = null; try { qr = makeQR(code); } catch { /* código grande demais p/ QR: fica só o texto */ }
    ui.showOfflineOffer(code, qr);
  } catch { ui.toast('Não consegui gerar o convite offline 😕'); }
}
// Anfitrião: aplica a resposta do convidado -> conexão P2P sobe.
async function offlineConnect(text) {
  const s = (text || '').trim();
  if (!mesh) { ui.toast('Gere o convite primeiro'); return; }
  if (!s) { ui.toast('Cole ou escaneie a resposta'); return; }
  let ans; try { ans = await decodeBlob(s); } catch { ui.toast('Resposta inválida 😕'); return; }
  try {
    await mesh.acceptManualAnswer(ans);
    ui.closeOverlays(); ui.toast('🎉 Conectado sem internet!'); render();
  } catch { ui.toast('Não consegui conectar 😕'); }
}
// Convidado: abre o painel (precisa de apelido).
function offlineJoin() {
  if (!getName()) { ui.toast('Bota teu apelido primeiro 😉'); return; }
  offlineWaiting = false;
  ui.openOfflineGuest();
}
// Convidado: lê o convite, entra na mesa e devolve a resposta (answer com ICE embutido).
async function offlineGenAnswer(text) {
  const s = (text || '').trim();
  if (!getName()) { ui.toast('Bota teu apelido primeiro 😉'); return; }
  if (!s) { ui.toast('Cole ou escaneie o convite'); return; }
  let off; try { off = await decodeBlob(s); } catch { ui.toast('Convite inválido 😕'); return; }
  if (!off || off.t !== 'offer') { ui.toast('Isso não é um convite 😅'); return; }
  try {
    if (!mesh) enterTableOffline(off.room || newRoomCode());
    const ansBlob = await mesh.acceptManualOffer(off);
    const code = await encodeBlob(ansBlob);
    let qr = null; try { qr = makeQR(code); } catch { /* só o texto */ }
    ui.showOfflineAnswer(code, qr);
    offlineWaiting = true; // ao conectar, o painel fecha sozinho (ver onMeshChange)
  } catch { ui.toast('Não consegui gerar a resposta 😕'); }
}

// ---- Conta ----
function itemizeFor(user) {
  const out = [];
  for (const it of allItems()) { const n = getCount(state, user, it.id); if (n > 0) out.push({ emoji: it.emoji, n }); }
  return out;
}
function computeBill() {
  const o = ui.billOptions();               // { tipPct, couvert, equal, excluded:[] }
  const rows = summary(state, resolveItem);
  const excluded = new Set(o.excluded || []);
  const included = (u) => !excluded.has(u);
  const tipMult = 1 + (Math.max(0, o.tipPct) || 0) / 100;
  if (o.tipPct !== settings.tipPct) settings = setSettings({ tipPct: o.tipPct }); // lembra a gorjeta escolhida

  // base de consumo por pessoa (rateio igual entre os incluídos, ou por consumo real)
  const base = new Map();
  if (o.equal) {
    const inc = rows.filter((r) => included(r.user));
    const pool = rows.reduce((a, r) => a + r.money, 0);
    const per = inc.length ? pool / inc.length : 0;
    for (const r of rows) base.set(r.user, included(r.user) ? per : 0);
  } else {
    for (const r of rows) base.set(r.user, r.money);
  }
  // gorjeta sobre o consumo + couvert por pessoa incluída
  const amount = new Map();
  for (const r of rows) amount.set(r.user, base.get(r.user) * tipMult + (included(r.user) ? o.couvert : 0));

  // "eu pago pra fulano": cada coberto vai pro pagador raiz (resolve cadeias, evita loop)
  const covers = payerOf(state);            // to -> from
  const rootPayer = (u) => { const seen = new Set(); let cur = u; while (covers.has(cur) && !seen.has(cur)) { seen.add(cur); cur = covers.get(cur); } return cur; };
  const final = new Map(amount);
  for (const r of rows) {
    if (!covers.has(r.user)) continue;
    const root = rootPayer(r.user);
    if (root !== r.user && final.has(root)) { final.set(root, final.get(root) + amount.get(r.user)); final.set(r.user, 0); }
  }

  const out = rows.map((r) => {
    const p = profOf(r.user);
    const from = covers.get(r.user);
    return {
      user: r.user, name: p.name, color: p.color, emoji: p.emoji,
      amount: Math.max(0, final.get(r.user) || 0),
      items: itemizeFor(r.user),
      coveredByName: from ? (profOf(from).name || 'alguém') : '',
      iPayThem: paysFor(state, self, r.user),
      included: included(r.user),
      isSelf: r.user === self,
    };
  });
  return { rows: out, total: out.reduce((a, r) => a + r.amount, 0), equal: o.equal, hasPrices: allItems().some((i) => i.price > 0) };
}
function renderBill() {
  const b = computeBill(); lastBill = b;
  const note = b.hasPrices ? 'Por consumo — 🙌 = eu pago; ou rache igual.' : 'Sem preços: use “rachar igual” ou o couvert.';
  ui.renderBill({ rows: b.rows, total: b.total, equal: b.equal, note, canPix: !!settings.pixKey, selfId: self });
}

// ---- Meu ritmo (consciência) ----
function openPace() {
  const now = Date.now();
  const p = paceInfo(log, self, resolveItem, { now });
  const tl = timeline(log, self, resolveItem, { now, buckets: 12 });
  const bac = settings.weightKg > 0 ? estimateBAC(log, self, resolveItem, { now, weightKg: settings.weightKg, sex: settings.sex }) : null;
  const hyd = hydration(log, self, resolveItem);
  const mid = new Date(now); mid.setHours(24, 0, 0, 0); // próxima meia-noite
  const proj = projectAt(log, self, resolveItem, { now, targetTs: mid.getTime() });
  const coach = { predicted: p.count > 0 ? proj.predicted : null, tips: coachTips(p, hyd, bac) };
  ui.openPace({ count: p.count, spanMs: p.spanMs, recent: p.recent, level: p.level, label: p.label, bars: tl.bars, bac, coach });
}

// ---- Roleta: quem paga a próxima (sincronizada via fx) ----
function connectedEntrants() {
  const me = profOf(self);
  const out = [{ user: self, name: getName() || 'você', avatar: me.emoji, color: me.color, isSelf: true }];
  if (mesh) for (const p of mesh.peers()) if (p.online) { const pr = profOf(p.user); out.push({ user: p.user, name: pr.name || 'alguém', avatar: pr.emoji, color: pr.color }); }
  return out;
}
function pickIndex(n) {
  try { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0] % n; } catch { return Math.floor(Date.now()) % n; }
}
function doRoulette() {
  const entrants = connectedEntrants();
  if (entrants.length < 2) { ui.toast('Precisa de pelo menos 2 na mesa 🙂'); return; }
  const winner = entrants[pickIndex(entrants.length)].user;
  if (mesh) mesh.sendFx({ kind: 'roulette', entrants, winner });
  ui.runRoulette(entrants, winner);
}

// ---- Cutucar / desafiar ----
function openPokeFor(user) {
  const items = ['dose', 'cerveja', 'drink'].map((id) => { const d = resolveItem(id); return { id, emoji: d.emoji, name: d.name }; });
  ui.openPoke({ user, name: profOf(user).name || 'alguém', items });
}
function sendPoke(user, kind, item) {
  if (!mesh) { ui.toast('Sozinho na mesa 🙂'); return; }
  const fromName = getName() || 'alguém';
  if (kind === 'challenge') { mesh.sendFx({ kind: 'challenge', to: user, from: self, fromName, item: item || 'dose' }); sound.challenge(); ui.toast('🥃 Desafio enviado 😈'); }
  else { mesh.sendFx({ kind: 'poke', to: user, from: self, fromName }); sound.poke(); ui.toast('👉 Cutucada enviada!'); }
}

// ---- Cerimônia de fim de noite ----
function openCeremony() {
  lastAwards = ceremonyAwards(state, resolveItem, { log, now: Date.now() });
  ui.openCeremony({ awards: lastAwards });
}

// ---- Meus números ----
function openStats() {
  const hist = store.getHistory();
  const now = Date.now();
  const s = lifeStats(hist, { now });
  const favDef = s.favDrink ? resolveItem(s.favDrink) : null;
  ui.openStats({
    stats: s, badges: lifeBadges(s), history: hist,
    favEmoji: favDef ? favDef.emoji : '', favName: favDef ? favDef.name : '',
    trend: monthlyTrend(hist, { now, months: 6 }),
    insight: weekdayInsight(hist),
  });
}

// Comanda de uma pessoa (o que ela pediu).
function openComanda(user) {
  const p = profOf(user);
  const rows = [];
  for (const it of allItems()) { const n = getCount(state, user, it.id); if (n > 0) rows.push({ emoji: it.emoji, name: it.name, n, money: (it.price || 0) * n }); }
  ui.openComanda({ user, name: p.name, emoji: p.emoji, rows, total: userTotal(state, user), money: userMoney(state, user, resolveItem) });
}

function fmtAgo(ms) {
  const m = Math.round((ms || 0) / 60000);
  if (m < 1) return 'agora há pouco';
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  return `há ${h}h${String(m % 60).padStart(2, '0')}`;
}
function myLevel() { return levelFor(lifeStats(store.getHistory(), { now: Date.now() })).level; }

// ---- Tô de boa? (segurança) ----
function openSafe() {
  const now = Date.now();
  const bac = settings.weightKg > 0 ? estimateBAC(log, self, resolveItem, { now, weightKg: settings.weightKg, sex: settings.sex }) : null;
  const ld = lastDrinkAt(log, self, resolveItem, { now });
  const hyd = hydration(log, self, resolveItem);
  ui.openSafe({
    verdict: driveVerdict(bac),
    bacText: bac ? `${bac.bac.toFixed(2)} g/L · ${bac.label}` : 'defina seu peso nas ⚙️',
    lastText: ld ? fmtAgo(ld.agoMs) : '',
    hydration: hyd.alc > 0 ? hyd : null,
    hasTrust: !!settings.trustPhone,
  });
}

// ---- Retrospectiva "Seu rolê" ----
function openRetro() {
  const r = retro(store.getHistory(), { now: Date.now() });
  const favDef = r.favDrink ? resolveItem(r.favDrink) : null;
  lastRetro = { ...r, favEmoji: favDef ? favDef.emoji : '', favName: favDef ? favDef.name : '' };
  const slides = [
    { emoji: '🍺', big: r.totalDrinks, sub: 'rodadas na vida' },
    { emoji: '📅', big: r.nights, sub: 'noites de boteco' },
    { emoji: '🔥', big: r.streakWeeks, sub: 'semanas seguidas' },
  ];
  if (r.record) slides.push({ emoji: '👑', big: r.record.total, sub: 'recorde numa noite' });
  if (favDef) slides.push({ emoji: favDef.emoji, big: favDef.name, sub: 'sua favorita' });
  if (r.topMate) slides.push({ emoji: '🤝', big: r.topMate.name, sub: 'parceiro de rolê' });
  if (r.totalSpent > 0) slides.push({ emoji: '💸', big: 'R$ ' + r.totalSpent.toFixed(2), sub: 'já torrado' });
  ui.openRetro({ slides });
}

// ---- Liga & desafios ----
function openLeague() {
  const now = Date.now();
  const hist = store.getHistory();
  const current = room ? { at: now, items: myItems() } : null;
  ui.openLeague({ level: levelFor(lifeStats(hist, { now })), challenges: weeklyChallenges(hist, current, { now }), season: seasonAward(hist, { now }) });
}

// ---- Modo bar ----
function loadBarMenu() {
  let n = 0;
  for (const d of store.getBarMenu()) if (d && d.id) { emitLocal(makeItem(d)); n++; }
  if (n) { render(); ui.toast(`📂 Cardápio carregado (${n} itens)`); }
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
  onBill: () => { ui.openBill({ tipPct: settings.tipPct }); renderBill(); },
  onBillChange: renderBill,
  onBillShare: async () => {
    if (!lastBill) renderBill();
    const t = tableInfo(state);
    const res = await shareBill(lastBill, (t.emoji ? t.emoji + ' ' : '') + (t.title || 'A conta')).catch(() => 'error');
    if (res === 'download') ui.toast('Imagem salva 📸'); else if (res === 'error') ui.toast('Não consegui gerar 😕');
  },
  onPayFor: (user, on) => { emitLocal(makePayFor({ to: user, on })); renderBill(); },
  onPrices: () => ui.openPrices(allItems()),
  onPriceChange: (id, price) => {
    const it = resolveItem(id);
    // preserva emoji/nome/g/cat/note; só troca o preço (senão perde as gramas de álcool!)
    emitLocal(makeItem({ ...it, price: Math.max(0, parseFloat(String(price).replace(',', '.')) || 0) }));
    render();
  },
  onPix: (user) => {
    if (!settings.pixKey) { ui.toast('Configure sua chave PIX nas ⚙️ configurações'); return; }
    const r = (lastBill && lastBill.rows || []).find((x) => x.user === user);
    if (!r) return;
    const payload = pixPayload({ key: settings.pixKey, name: getName() || 'Recebedor', city: settings.pixCity || 'BRASIL', amount: r.amount, txid: 'BOTEQUEI' });
    let qrNode; try { qrNode = makeQR(payload); } catch { qrNode = null; }
    ui.openPix({ title: `Cobrar ${r.name || ''}`, code: payload, qrNode });
  },
  onPixCopy: async () => { try { await navigator.clipboard.writeText(ui.pixCode()); ui.toast('PIX copiado! 📋'); } catch { ui.toast('Selecione e copie o código'); } },
  onShareNight: async () => {
    const res = await shareRecap(state, resolveItem).catch(() => 'error');
    if (res === 'download') ui.toast('Imagem salva 📸'); else if (res === 'error') ui.toast('Não consegui gerar 😕');
  },
  onPace: openPace,
  onRoulette: () => { if (!room) { ui.toast('Entre numa mesa 🙂'); return; } ui.openRoulette({ entrants: connectedEntrants() }); },
  onRouletteSpin: doRoulette,
  onPoke: openPokeFor,
  onPokeSend: sendPoke,
  onCeremony: openCeremony,
  onCeremonyShare: async () => {
    const t = tableInfo(state);
    const res = await shareCeremony(lastAwards, (t.emoji ? t.emoji + ' ' : '') + (t.title || 'Cerimônia')).catch(() => 'error');
    if (res === 'download') ui.toast('Imagem salva 📸'); else if (res === 'error') ui.toast('Não consegui gerar 😕');
  },
  onCeremonyBroadcast: () => { if (mesh) mesh.sendFx({ kind: 'ceremony', awards: lastAwards }); ui.toast('📣 Mandado pra mesa!'); },
  onStats: openStats,
  onComanda: openComanda,
  onSafe: openSafe,
  onRetro: openRetro,
  onLeague: openLeague,
  onBarMode: () => ui.openBar({ menuCount: store.getBarMenu().length }),
  onBarOpenTable: (code, useMenu) => {
    if (!getName()) { ui.toast('Bota teu apelido primeiro 😉'); return; }
    const c = (code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || newRoomCode();
    pendingBarMenu = !!useMenu && store.hasBarMenu();
    ui.closeOverlays();
    enterTable(c, { create: true });
  },
  onSaveMenu: () => {
    const defs = [];
    for (const rec of state.items.values()) defs.push(rec.def);
    store.saveBarMenu(defs);
    ui.toast(defs.length ? `💾 Cardápio salvo (${defs.length} itens)` : 'Adicione itens/preços antes 🙂');
  },
  onCallCar: callCar,
  onWaterRound: () => { if (!room) { ui.toast('Entre numa mesa 🙂'); return; } waterRound(); },
  onJukebox: () => { if (!room) { ui.toast('Entre numa mesa 🙂'); return; } ui.openJukebox({ songs: songs(state) }); },
  onSongAdd: (title) => {
    if (!room) return;
    if (emitLocal(makeSong({ title }))) { ui.renderJukebox(songs(state)); ui.toast('🎵 Na fila!'); }
  },
  onSongPlay: (song) => {
    if (!song) return;
    const url = song.url && /^https?:\/\//.test(song.url) ? song.url : 'https://music.youtube.com/search?q=' + encodeURIComponent(song.title);
    try { window.open(url, '_blank', 'noopener'); } catch { /* ignore */ }
  },
  onGoHome: () => {
    const digits = (settings.trustPhone || '').replace(/\D/g, '');
    if (!digits) { ui.toast('Configure um contato de confiança nas ⚙️'); return; }
    const num = digits.length <= 11 ? '55' + digits : digits;
    if (!navigator.geolocation) { ui.toast('Sem GPS neste aparelho 😕'); return; }
    ui.toast('📍 Pegando sua localização…');
    navigator.geolocation.getCurrentPosition((pos) => {
      const map = `https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;
      const msg = encodeURIComponent(`Oi${settings.trustName ? ' ' + settings.trustName : ''}! Tô voltando do bar, minha localização: ${map} . Fica de olho, tá? 🙏`);
      try { window.open(`https://wa.me/${num}?text=${msg}`, '_blank', 'noopener'); } catch { /* ignore */ }
    }, () => ui.toast('Não consegui a localização 😕'), { timeout: 8000 });
  },
  onTournament: () => ui.openTournament({ rank: rankTournament(store.getTournament().standings) }),
  onTournamentAdd: () => {
    if (!room) { ui.toast('Entre numa mesa 🙂'); return; }
    const rows = summary(state, resolveItem).map((r) => ({ name: profOf(r.user).name, points: 10 + getCount(state, r.user, 'agua') }));
    const t = store.getTournament();
    const merged = { name: t.name || 'Torneio da galera', standings: mergeNight(t.standings, rows), at: Date.now() };
    store.saveTournament(merged);
    ui.openTournament({ rank: rankTournament(merged.standings) });
    ui.toast('🏟️ Noite somada ao torneio!');
  },
  onTournamentReset: () => { store.saveTournament({ name: '', standings: {}, at: 0 }); ui.openTournament({ rank: [] }); ui.toast('Torneio zerado 🆕'); },
  onCard: () => { lastCard = pickCard(pickIndex(1000)); ui.openCard(lastCard); sound.pop(); },
  onCardShow: () => { if (lastCard && mesh) mesh.sendFx({ kind: 'card', emoji: lastCard.emoji, text: lastCard.text }); ui.toast('📣 Carta na mesa!'); },
  // Passaporte de botecos (check-ins locais, opcionalmente com GPS)
  onPassport: () => ui.openPassport({ checkins: store.getCheckins(), suggestName: room ? tableInfo(state).title : '' }),
  onCheckin: (name) => {
    const nm = ((name || '').trim() || (room ? tableInfo(state).title : '') || 'Boteco').slice(0, 40);
    const save = (lat, lng) => {
      store.addCheckin({ name: nm, at: Date.now(), lat, lng });
      ui.openPassport({ checkins: store.getCheckins() });
      ui.toast('📍 Check-in salvo!'); sound.pop();
    };
    if (navigator.geolocation) {
      ui.toast('📍 Pegando o local…');
      navigator.geolocation.getCurrentPosition((pos) => save(pos.coords.latitude, pos.coords.longitude), () => save(null, null), { timeout: 8000 });
    } else save(null, null);
  },
  // Foto da noite: compartilha o arquivo (Web Share) ou baixa (fallback). Fica só local.
  onPhotoShare: async () => {
    const ph = ui.currentPhoto();
    if (!ph) return;
    try {
      const blob = await (await fetch(ph.url)).blob();
      const file = new File([blob], ph.name || 'botequei.jpg', { type: ph.type || blob.type || 'image/jpeg' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Botequei', text: 'Foto da noite 🍺' });
      } else {
        const a = document.createElement('a');
        a.href = ph.url; a.download = ph.name || 'botequei.jpg';
        document.body.appendChild(a); a.click(); a.remove();
        ui.toast('Foto salva 📸');
      }
    } catch { ui.toast('Não consegui compartilhar 😕'); }
  },
  onShakeToggle: (on) => { settings = setSettings({ shake: !!on }); if (on) enableShake(); else disableShake(); ui.toast(on ? '📳 Chacoalha pra +1!' : 'Mãos livres desligado'); },
  onTrustContact: () => {
    const digits = (settings.trustPhone || '').replace(/\D/g, '');
    if (!digits) { ui.toast('Configure um contato de confiança nas ⚙️'); return; }
    const num = digits.length <= 11 ? '55' + digits : digits;
    const msg = encodeURIComponent(`Oi${settings.trustName ? ' ' + settings.trustName : ''}! Tô no bar e queria uma carona/companhia pra voltar. Pode me ajudar?`);
    try { window.open(`https://wa.me/${num}?text=${msg}`, '_blank', 'noopener'); } catch { /* ignore */ }
  },
  onRetroShare: async () => {
    if (!lastRetro) return;
    const res = await shareRetro(lastRetro).catch(() => 'error');
    if (res === 'download') ui.toast('Imagem salva 📸'); else if (res === 'error') ui.toast('Não consegui gerar 😕');
  },
  onWaiter: () => {
    sound.alarm(); ui.floatReaction('🔔');
    if (mesh && mesh.connectedCount() > 0) { mesh.sendFx({ kind: 'waiter', from: self, fromName: getName() || 'alguém' }); ui.toast('🔔 Chamou o garçom pra mesa!'); }
    else ui.toast('🔔 Garçom! (ninguém mais conectado ainda)');
  },
  onExportData: () => {
    try {
      const data = JSON.stringify(store.exportAll(), null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'botequei-backup.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      ui.toast('💾 Backup exportado!');
    } catch { ui.toast('Não consegui exportar 😕'); }
  },
  onImportData: (text) => {
    let obj; try { obj = JSON.parse(text); } catch { ui.toast('Arquivo inválido 😕'); return; }
    let n; try { n = store.importAll(obj); } catch { ui.toast('Backup inválido 😕'); return; }
    ui.toast(`✅ ${n} itens importados. Recarregando…`);
    setTimeout(() => location.reload(), 900);
  },
  onSfx: (kind) => { if (typeof sound[kind] === 'function') sound[kind](); },
  onBebedeira: () => { const id = bebedeiraItem(); ui.openBebedeira({ item: id, emoji: resolveItem(id).emoji, count: getCount(state, self, id) }); },
  onBebedeiraClose: () => render(),
  onHappyHour: (minutes) => {
    if (!room) { ui.toast('Entre numa mesa primeiro 🙂'); return; }
    hhEndedFor = 0;
    emitLocal(makeHappyHour({ minutes, startTotal: tableTotal(state) }));
    tickHappyHour();
    ui.toast(`⏰ Happy hour de ${minutes} min ligado!`);
  },
  onCopyLink: async () => { try { await navigator.clipboard.writeText(inviteUrl()); ui.toast('Link copiado! 📋'); } catch { ui.toast(inviteUrl()); } },
  onShareInvite: async () => { try { await navigator.share({ title: 'Botequei', text: 'Bora pra mesa!', url: inviteUrl() }); } catch { /* cancelado */ } },
  onNfc: async () => {
    if (!('NDEFReader' in window)) { ui.toast('NFC não suportado neste aparelho'); return; }
    try { await new window.NDEFReader().write({ records: [{ recordType: 'url', data: inviteUrl() }] }); ui.toast('📡 Aproxime o outro celular'); }
    catch { ui.toast('Não consegui usar o NFC 😕'); }
  },
  onOfflineHost: offlineHost,
  onOfflineJoin: offlineJoin,
  onOfflineGenAnswer: offlineGenAnswer,
  onOfflineConnect: offlineConnect,
  onOpenHistory: (code) => enterTable(code),
  onOpenSettings: () => ui.fillSettings(settings),
  onSetting: (patch) => {
    settings = setSettings(patch);
    ui.applyTheme(settings);
    if ('lang' in patch) ui.applyLang(settings.lang);
    sound.setEnabled(settings.sound);
    if (room) render();
  },
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
  ui.applyLang(settings.lang);
  sound.setEnabled(settings.sound);
  if (settings.shake) enableShake();
  ui.setNameInput(getName());
  ui.renderHome(store.getHistory());

  const inv = parseInvite();
  if (inv) {
    pendingJoin = inv.room; pendingPin = inv.needPin;
    if (getName() && !inv.needPin) enterTable(inv.room);
    else ui.openJoin(inv.room, inv.needPin);
  } else if (!getName() && !store.getHistory().length) {
    ui.openWelcome(); // primeiro uso: guia rápido (sem convite pendente)
  }

  window.addEventListener('pagehide', () => { if (room) { store.saveEvents(room, log); if (mesh) mesh.sig.leave(); } });
  const wake = () => { if (!document.hidden && mesh) mesh.wake(); };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
  // enquanto o usuário não escolher manualmente, segue o tema claro/escuro do sistema
  try { window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (settings.theme !== 'light' && settings.theme !== 'dark') ui.applyTheme(settings); }); } catch { /* ignore */ }

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; ui.showInstall(true); });

  setInterval(() => { if (room) tickHappyHour(); }, 1000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          // nova versão pronta e já havia uma controlando -> oferece atualizar
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            ui.showUpdate(() => nw.postMessage('SKIP_WAITING'));
          }
        });
      });
    }).catch(() => {});
    let swReloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!swReloaded) { swReloaded = true; location.reload(); } });
  }
}

boot();
