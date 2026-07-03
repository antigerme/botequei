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
import {
  clampHand, maxGuess as purrMax, randomNonce, makeCommit, verifyReveal, resolve as purrResolve, sha256Hex,
  makeHandCommit, verifyHandReveal, validGuessTo, guessOrder, classicRound, nextRound,
  clampHandTo, poolsTotal, sticksNext, STICKS_START,
} from './purrinha.js';
import {
  opening, legalMoves, place, pipCount, tileKey as domKey, rngFrom, shuffle, FULL_SET,
  deckCommit, handCommit, combineSeeds, cutDeck, dealFromDeck, verifyDeal,
} from './domino.js';
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
let everSeen = new Set();    // quem já apareceu online na sessão ("entrou!" só na 1ª vez)
let wentAway = new Set();    // quem saiu de verdade (passou da graça) — p/ saudar o "voltou"
let pendingBye = new Map();  // user -> timeout da graça: sumiu agora, ainda não é "saiu"
const BYE_GRACE_MS = 45000;  // tela apagada / elevador / xixi não viram toast de "saiu"
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

// Jogos (dominó/purrinha) precisam que TODA jogada chegue em todo mundo, mesmo se a malha não
// estiver 100% completa (4 pessoas = 6 links; algum par pode faltar/precisar de TURN). Diferente
// das reações, essas fx levam um `mid` e são repassadas (gossip) com dedup — igual aos eventos.
let fxSeq = 0;
const seenFx = new Set();
function gameFx(fx) {
  if (!mesh) return;
  fx.mid = self + ':' + (fxSeq++);
  seenFx.add(fx.mid);
  mesh.sendFx(fx);
}
function onFx(fx, fromId) {
  if (!fx) return;
  // gossip com dedup só pras fx de jogo (têm mid): ignora repetida, repassa a nova pros outros
  if (fx.mid && (fx.kind === 'domino' || fx.kind === 'purrinha')) {
    if (seenFx.has(fx.mid)) return;
    seenFx.add(fx.mid);
    if (mesh) mesh.broadcast({ k: 'fx', fx }, fromId);
  }
  if (fx.kind === 'brinde') ui.brinde();
  else if (fx.kind === 'react') ui.floatReaction(fx.emoji || '🍻');
  else if (fx.kind === 'roulette') { if (Array.isArray(fx.entrants)) ui.runRoulette(fx.entrants, fx.winner); }
  else if (fx.kind === 'poke') { if (fx.to === self) receivePoke(fx); }
  else if (fx.kind === 'challenge') { if (fx.to === self) receiveChallenge(fx); }
  else if (fx.kind === 'ceremony') { if (Array.isArray(fx.awards)) ui.openCeremony({ awards: fx.awards }); }
  else if (fx.kind === 'waiter') receiveWaiter(fx);
  else if (fx.kind === 'water') { ui.floatReaction('💧'); ui.celebrate(['💧', '💦', '🚰']); ui.toast('💧 Rodada de água na mesa!'); sound.plus(); }
  else if (fx.kind === 'card') { ui.openCard({ emoji: fx.emoji, text: fx.text }); sound.pop(); }
  else if (fx.kind === 'purrinha') routePurrFx(fx);
  else if (fx.kind === 'domino') {
    if (fx.ph === 'deal') { if (!dom || dom.gameId !== fx.gameId) beginDomino(fx); }
    else if (fx.ph === 'play') onDomPlay(fx);
    else if (fx.ph === 'pass') onDomPass(fx);
    else if (fx.ph === 'skip') onDomSkip(fx);       // vez pulada de quem caiu (convergente)
    else if (fx.ph === 'reveal') onDomReveal(fx);
    else if (fx.ph === 'noshow') onDomNoshow(fx);   // tranca sem a mão de quem caiu
    else if (fx.ph === 'cancel') {
      const bye = fx.from ? `🛑 ${domName(fx.from)} encerrou o dominó` : '🁫 Dominó cancelado';
      if (dom && dom.gameId === fx.gameId && !dom.over) { dom = null; domClearTimers(); clearGameMin('dom'); ui.closeOverlays(); ui.toast(bye); }
      else if (dv && dv.gameId === fx.gameId && !dv.began) { dv = null; domClearTimers(); clearGameMin('dom'); ui.closeOverlays(); ui.toast(bye); } // ainda no handshake
    }
    else if (fx.ph === 'vsetup') onVsetup(fx);
    else if (fx.ph === 'vseed') onVseed(fx);
    else if (fx.ph === 'vgo') onVgo(fx);
    else if (fx.ph === 'vseedrev') onVseedrev(fx);
    else if (fx.ph === 'vdeal') onVdeal(fx);
    else if (fx.ph === 'vhand') onVhand(fx);
    else if (fx.ph === 'vopen') onVopen(fx);
    else if (fx.ph === 'vopenhand') onVopenhand(fx);
  }
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
  const listed = new Set([self]);
  if (mesh) for (const p of mesh.peers()) { listed.add(p.user); const pr = profOf(p.user); list.push({ user: p.user, emoji: pr.emoji, color: pr.color, name: pr.name || 'alguém', level: pr.level, online: p.online }); }
  // quem sumiu há pouco (dentro da graça) segue na barra como 💤, mesmo se a malha já o removeu
  for (const u of pendingBye.keys()) if (!listed.has(u)) { const pr = profOf(u); list.push({ user: u, emoji: pr.emoji, color: pr.color, name: pr.name || 'alguém', level: pr.level, online: false }); }
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
  maybeStartTour(); // 1ª mesa da vida: mostra o caminho das pedras (espera fechar o convite)

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
  maybeStartTour();
  startMesh([]);
  location.hash = '#/mesa?room=' + room;
}

function onMeshChange() {
  diffPresence();
  render();
  purrTryGates(); // dropout não trava a purrinha: portões re-checam quando alguém cai/volta
  armDomSkip();   // idem no dominó: quem caiu na vez tem a vez pulada
  if (dom && !dom.over && dom.phase === 'reveal') domResolveBlock(); // tranca esperando mão de quem caiu
  updateGamePill();
  // convidado: assim que a conexão sobe, fecha o painel de pareamento offline sozinho
  if (offlineWaiting && mesh && mesh.connectedCount() > 0) {
    offlineWaiting = false;
    ui.closeOverlays();
    ui.toast('🎉 Entrou na mesa sem internet!');
  }
}
// Avisa quem entrou/saiu ao vivo, com HISTERESE: tela apagada derruba o WebRTC em ~12s, então
// quem some entra numa graça de 45s (fica 💤 na barra) e só vira toast de "saiu" se não voltar.
// Piscada (apagou e voltou) = silêncio total; "entrou!" só na primeira vez da sessão.
function diffPresence() {
  if (!mesh) return;
  const cur = new Set(mesh.peers().filter((p) => p.online).map((p) => p.user));
  for (const u of cur) { const n = profOf(u).name; if (n) sessionMates.add(n); } // "com quem você bebeu"
  if (!presenceSeeded) { prevOnline = cur; presenceSeeded = true; for (const u of cur) everSeen.add(u); return; }
  for (const u of cur) {
    const t = pendingBye.get(u);
    if (t) { clearTimeout(t); pendingBye.delete(u); } // voltou dentro da graça: nenhum toast
    else if (!prevOnline.has(u)) {
      if (!everSeen.has(u)) { ui.toast(`🍻 ${profOf(u).name || 'Alguém'} entrou!`); sound.pop(); }
      else if (wentAway.has(u)) ui.toast(`🙌 ${profOf(u).name || 'Alguém'} voltou!`);
    }
    everSeen.add(u); wentAway.delete(u);
  }
  for (const u of prevOnline) {
    if (cur.has(u) || pendingBye.has(u)) continue;
    pendingBye.set(u, setTimeout(() => {
      pendingBye.delete(u);
      const on = mesh && mesh.peers().some((p) => p.user === u && p.online);
      if (!on) { wentAway.add(u); ui.toast(`👋 ${profOf(u).name || 'Alguém'} saiu`); }
      scheduleRender(); // tira (ou reacende) o 💤 da barra
    }, BYE_GRACE_MS));
  }
  prevOnline = cur;
}

function startMesh(iceServers) {
  presenceSeeded = false; prevOnline = new Set();
  for (const t of pendingBye.values()) clearTimeout(t);
  pendingBye = new Map(); everSeen = new Set(); wentAway = new Set();
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
  for (const t of pendingBye.values()) clearTimeout(t);
  pendingBye = new Map(); everSeen = new Set(); wentAway = new Set();
  purr = null; dom = null; dv = null; seenFx.clear(); purrPreFx = [];
  domClearTimers(); gameMinned.clear(); ui.setGameMin('dom', false); ui.setGameMin('purr', false); ui.setGamePill(null);
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

// ---- Jogo minimizado (✕ = minimizar; encerrar pra mesa toda é ação explícita) ----
// Fechar o overlay NÃO cancela mais a partida de ninguém: o jogo segue rolando por baixo
// (fx continuam aplicando/renderizando) e o pill na mesa traz de volta num toque. "Encerrar"
// pede confirmação e avisa a mesa com o nome de quem encerrou.
const gameMinned = new Set(); // 'dom' | 'purr'
function purrActive() { return !!purr && purr.phase !== 'revealed' && purr.phase !== 'done'; }
function minimizeGame(kind) { gameMinned.add(kind); ui.setGameMin(kind, true); ui.closeOverlays(); updateGamePill(); }
function reopenGame(kind) { gameMinned.delete(kind); ui.showGame(kind); updateGamePill(); }
function clearGameMin(kind) { gameMinned.delete(kind); ui.setGameMin(kind, false); updateGamePill(); }
function updateGamePill() {
  // poda flags de jogo que já morreu (cancelado/terminado enquanto minimizado)
  if (gameMinned.has('dom') && !((dom && !dom.over) || (dv && !dv.began && !dom))) { gameMinned.delete('dom'); ui.setGameMin('dom', false); }
  if (gameMinned.has('purr') && !purrActive()) { gameMinned.delete('purr'); ui.setGameMin('purr', false); }
  const parts = [];
  if (gameMinned.has('dom')) {
    const myTurn = dom && !dom.over && dom.order[dom.turnIdx] === self;
    parts.push({ urgent: myTurn, label: myTurn ? '🁫 SUA VEZ no dominó' : '🁫 Dominó rolando' });
  }
  if (gameMinned.has('purr')) parts.push({ urgent: false, label: '🫲 Purrinha rolando' });
  ui.setGamePill(parts.length ? { label: parts.map((p) => p.label).join(' · ') + ' — voltar', urgent: parts.some((p) => p.urgent) } : null);
}

// ---- Atualização automática do app (service worker) ----
// A versão nova instala em segundo plano e APLICA sozinha (toast + reload; o hash re-entra na
// mesa). Se tiver jogo rolando ou overlay aberto (alguém digitando), adia — re-checa a cada 5s.
let swPending = null;
function swBusy() {
  if ((dom && !dom.over) || (dv && !dv.began && !dom) || purrActive()) return true;
  return !!document.querySelector('.overlay:not([hidden])');
}
function trySwUpdate() {
  if (!swPending || swBusy()) return;
  const w = swPending; swPending = null;
  ui.toast('🔄 Nova versão do Botequei — atualizando…');
  setTimeout(() => { try { w.postMessage('SKIP_WAITING'); } catch { /* já ativou */ } }, 1200);
}

// ---- Tour guiado da primeira mesa (4 paradas; 1× por aparelho) ----
function maybeStartTour() {
  if (store.getFlag('tourSeen')) return;
  const tick = setInterval(() => {
    if (!room) { clearInterval(tick); return; } // saiu antes do tour começar
    if (document.querySelector('.overlay:not([hidden])')) return; // convite/QR ainda aberto
    if (!document.querySelector('.item-card')) return; // cardápio ainda não renderizou
    clearInterval(tick);
    store.setFlag('tourSeen'); // marca ao MOSTRAR (pular também conta como visto)
    ui.startTour([
      { sel: '.item-card', title: 'Marca aí 🍺', text: 'Toque no card = +1. Segure = −1 (desfaz).' },
      { sel: '.total-hero', title: 'A mesa mandou', text: 'O total da mesa e o seu, ao vivo em todo mundo.' },
      { sel: '#btn-games', title: 'Quem paga? 🎮', text: 'Roleta, purrinha e dominó — a mesa decide jogando.' },
      { sel: '#btn-menu', title: 'O resto mora no menu', text: 'Fechar a conta, placar, garçom, configurações.' },
    ]);
  }, 600);
}

// ---- Purrinha (P2P honesta via commit-reveal; efêmera, não entra no log) ----
// Dois modos, escolhidos por quem inicia:
//   'fast'    — variante rápida: 1 rodada, mão+palpite lacrados juntos, quem chuta mais longe paga.
//   'classic' — palitinho de verdade: só a MÃO é secreta (lacre por rodada); o palpite é falado
//               em voz alta na vez de cada um (girando a mesa, SEM repetir número). Quem crava o
//               total se livra e sai; os que sobram jogam de novo; o ÚLTIMO que resta paga.
let purr = null;
function purrEntrants() {
  const me = profOf(self);
  const out = [{ id: self, name: getName() || 'você', avatar: me.emoji, color: me.color }];
  if (mesh) for (const p of mesh.peers()) if (p.online) { const pr = profOf(p.user); out.push({ id: p.user, name: pr.name || 'alguém', avatar: pr.emoji, color: pr.color }); }
  return out;
}
function purrOnline(id) { if (id === self) return true; if (!mesh) return false; const p = mesh.peers().find((x) => x.user === id); return !!(p && p.online); }
// só cobra lacre/reveal de quem ainda está online (dropout não trava o jogo)
function purrExpected() {
  if (!purr) return [];
  const base = purr.mode === 'fast' ? purr.entrants.map((e) => e.id) : purr.alive;
  return base.filter((id) => purrOnline(id));
}
function purrName(id) { return profOf(id).name || (purr.entrants.find((e) => e.id === id) || {}).name || 'alguém'; }

// Roteia toda fx de purrinha. Com gossip, uma fase (ex.: hcommit de um peer rápido) pode chegar
// ANTES do próprio convite — nesse caso guarda e re-aplica quando o jogo abrir (senão o lacre
// se perde pra sempre e o portão da rodada trava esperando ele).
let purrPreFx = [];
function routePurrFx(fx) {
  if (fx.ph === 'invite') { if (!purr || purr.gameId !== fx.gameId) beginPurrinha(fx.gameId, fx.entrants, fx.mode); return; }
  if (fx.ph === 'cancel') {
    if (purr && purr.gameId === fx.gameId && purr.phase !== 'revealed' && purr.phase !== 'done') {
      purr = null; clearGameMin('purr'); ui.closeOverlays();
      ui.toast(fx.from ? `🛑 ${profOf(fx.from).name || 'Alguém'} encerrou a purrinha` : '🫲 Purrinha cancelada');
    }
    return;
  }
  if (!purr || purr.gameId !== fx.gameId) { purrPreFx.push(fx); if (purrPreFx.length > 60) purrPreFx.shift(); return; }
  if (fx.ph === 'commit') onPurrCommit(fx);
  else if (fx.ph === 'reveal') onPurrReveal(fx);
  else if (fx.ph === 'hcommit') onPurrHCommit(fx);   // clássico: lacre da mão da rodada
  else if (fx.ph === 'guess') onPurrGuessFx(fx);      // clássico: palpite falado (público)
  else if (fx.ph === 'hreveal') onPurrHReveal(fx);    // clássico: abre a mão
}

function startPurrinha() { // abre a escolha do modo (quem inicia decide)
  if (!room) { ui.toast('Entre numa mesa 🙂'); return; }
  if (purrEntrants().length < 2) { ui.toast('Precisa de pelo menos 2 na mesa 🫲'); return; }
  ui.purrinhaStartChoice();
}
function startPurrinhaMode(mode) {
  if (!room) return;
  const entrants = purrEntrants();
  if (entrants.length < 2) { ui.toast('Precisa de pelo menos 2 na mesa 🫲'); return; }
  const gameId = randomNonce().slice(0, 8);
  gameFx({ kind: 'purrinha', ph: 'invite', gameId, entrants, mode });
  beginPurrinha(gameId, entrants, mode);
}
function beginPurrinha(gameId, entrants, mode) {
  clearGameMin('purr'); // convite novo abre na cara (jogo anterior minimizado já era)
  purr = {
    gameId, mode: mode === 'classic' || mode === 'sticks' ? mode : 'fast', entrants, cheats: new Set(),
    mine: null, commits: new Map(), reveals: new Map(), phase: 'pick',
    // por turnos (clássica/3-2-1): assentos fixos (ordem dos entrants), vivos, livres, rodada, starter
    alive: entrants.map((e) => e.id), freed: [], rd: 1, startIdx: 0,
    guesses: new Map(), saidSeq: [], early: [],
    // 3-2-1: estoque público de palitos por pessoa (cravou → descarta; zerou → livre)
    pools: entrants.map((e) => ({ id: e.id, sticks: STICKS_START })),
  };
  renderPurrPick();
  // re-aplica fases que chegaram antes do convite (corrida do gossip)
  const q = purrPreFx.filter((f) => f.gameId === gameId);
  purrPreFx = purrPreFx.filter((f) => f.gameId !== gameId);
  for (const f of q) routePurrFx(f);
}
// helpers do 3-2-1 (estoques públicos, deterministicamente derivados das rodadas)
function purrPool(id) { const p = purr && purr.pools ? purr.pools.find((x) => x.id === id) : null; return p ? p.sticks : 0; }
function purrPoolsStr(pools) { return (pools || purr.pools).filter((p) => p.sticks > 0).map((p) => `${purrName(p.id)} ${p.sticks}`).join(' · '); }
// teto do palpite da rodada: 3-2-1 = soma dos estoques; clássica = 3·vivos
function purrCeil() { return purr.mode === 'sticks' ? poolsTotal(purr.pools) : purrMax(purr.alive.length); }

function renderPurrPick() {
  if (!purr) return;
  if (purr.mode === 'fast') { ui.openPurrinha({ maxGuess: purrMax(purr.entrants.length) }); return; }
  if (!purr.alive.includes(self)) { renderPurrWait(); return; } // você já se livrou — só assiste
  const vm = { classic: true, maxGuess: 0 };
  if (purr.mode === 'sticks') {
    vm.maxHand = purrPool(self);
    vm.status = `Rodada ${purr.rd} · 🥢 ${purrPoolsStr()}`;
    vm.sub = 'Cravou o total? Descarta um palito e fala primeiro. Zerou? Tá livre — o último com palitos paga.';
  } else if (purr.rd > 1) vm.status = `Rodada ${purr.rd}`;
  ui.openPurrinha(vm);
}
// fx da rodada seguinte/fase seguinte pode chegar antes de eu transicionar → guarda e re-aplica
function purrDrainEarly() {
  if (!purr || !purr.early.length) return;
  const q = purr.early; purr.early = [];
  for (const fx of q) {
    if (fx.rd < purr.rd) continue;
    if (fx.ph === 'hcommit') onPurrHCommit(fx);
    else if (fx.ph === 'guess') onPurrGuessFx(fx);
    else if (fx.ph === 'hreveal') onPurrHReveal(fx);
  }
}

// ---------- modo rápido (1 rodada; mão+palpite no mesmo lacre) ----------
async function purrSeal(hand, guess) {
  if (!purr || purr.mode !== 'fast' || purr.mine) return;
  hand = clampHand(hand);
  guess = Math.max(0, Math.min(purrMax(purr.entrants.length), Math.floor(Number(guess) || 0)));
  const nonce = randomNonce();
  const commit = await makeCommit(hand, guess, nonce);
  purr.mine = { hand, guess, nonce, commit };
  purr.commits.set(self, commit);
  purr.phase = 'sealed';
  gameFx({ kind: 'purrinha', ph: 'commit', gameId: purr.gameId, from: self, commit });
  sound.pop();
  renderPurrWait();
  maybePurrReveal();
}
function renderPurrWait() {
  if (!purr) return;
  const exp = purrExpected();
  const done = purr.mode !== 'fast' && purr.phase === 'revealing' ? purr.reveals : purr.commits;
  const seals = exp.map((id) => ({ name: purrName(id), avatar: profOf(id).emoji, sealed: done.has(id) }));
  let sub;
  if (purr.mode !== 'fast') {
    if (purr.phase === 'revealing') sub = 'Todos palpitaram — abrindo as mãos… 🫲';
    else if (!purr.alive.includes(self)) sub = `Você já se livrou 🍀 — rodada ${purr.rd} rolando…`;
    else sub = `Rodada ${purr.rd} — esperando os lacres…`;
  }
  ui.purrinhaSealed({ count: exp.filter((id) => done.has(id)).length, total: exp.length, seals, sub });
}
function onPurrCommit(fx) {
  if (!purr || purr.mode !== 'fast' || fx.gameId !== purr.gameId) return;
  purr.commits.set(fx.from, fx.commit);
  if (purr.phase === 'sealed') renderPurrWait();
  maybePurrReveal();
}
function maybePurrReveal() {
  if (!purr || purr.mode !== 'fast' || !purr.mine || purr.phase === 'revealed') return;
  const exp = purrExpected();
  if (!exp.every((id) => purr.commits.has(id))) return; // ainda faltam lacres
  if (!purr.reveals.has(self)) {
    purr.reveals.set(self, { ...purr.mine });
    gameFx({ kind: 'purrinha', ph: 'reveal', gameId: purr.gameId, from: self, hand: purr.mine.hand, guess: purr.mine.guess, nonce: purr.mine.nonce });
  }
  maybePurrResolve();
}
async function onPurrReveal(fx) {
  if (!purr || purr.mode !== 'fast' || fx.gameId !== purr.gameId) return;
  const commit = purr.commits.get(fx.from);
  const good = commit && await verifyReveal({ hand: fx.hand, guess: fx.guess, nonce: fx.nonce, commit });
  if (!good) { purr.cheats.add(fx.from); ui.toast(`🚫 ${purrName(fx.from)} tentou trapacear na purrinha!`); return; }
  purr.reveals.set(fx.from, { hand: fx.hand, guess: fx.guess, nonce: fx.nonce });
  maybePurrReveal();  // o lacre dele pode ter sido o último que faltava pra eu revelar
  maybePurrResolve();
}
function maybePurrResolve() {
  if (!purr || purr.mode !== 'fast' || purr.phase === 'revealed') return;
  const exp = purrExpected();
  if (!exp.length || !exp.every((id) => purr.reveals.has(id))) return;
  purr.phase = 'revealed';
  if (gameMinned.has('purr')) reopenGame('purr'); // acabou: o resultado aparece mesmo minimizado
  const reveals = exp.map((id) => ({ id, hand: purr.reveals.get(id).hand, guess: purr.reveals.get(id).guess }));
  const r = purrResolve(reveals);
  const rows = reveals.map((x) => ({
    name: purrName(x.id), avatar: profOf(x.id).emoji, hand: x.hand, guess: x.guess,
    isSeer: r.seers.includes(x.id), isLoser: x.id === r.loserId, isSelf: x.id === self,
  })).sort((a, b) => (b.isSeer - a.isSeer) || (a.isLoser - b.isLoser));
  let verdict;
  if (r.loserId === self) verdict = { text: '💸 Você paga a próxima!', kind: 'lose' };
  else if (r.seers.includes(self)) verdict = { text: '🔮 Você é vidente! Cravou o total.', kind: 'win' };
  else if (r.loserId) verdict = { text: `💸 ${purrName(r.loserId)} paga a próxima!`, kind: 'other' };
  else verdict = { text: '🔮 Todo mundo cravou! Ninguém paga 😎', kind: 'win' };
  ui.purrinhaResult({ total: r.total, rows, verdict, final: true });
  if (verdict.kind === 'win') { sound.cheers(); ui.celebrate(['🔮', '🫲', '🎉', '🍻']); } else { sound.alarm(); ui.vibrate([80, 40, 80]); }
}

// ---------- modo clássico (rodadas de eliminação; palpite falado em turno) ----------
async function purrSealHand(hand) {
  if (!purr || purr.mode === 'fast' || purr.phase !== 'pick' || purr.mine) return;
  if (!purr.alive.includes(self)) return; // quem já se livrou só assiste
  hand = purr.mode === 'sticks' ? clampHandTo(hand, purrPool(self)) : clampHand(hand); // 3-2-1: mão ≤ estoque
  const nonce = randomNonce();
  const commit = await makeHandCommit(hand, nonce);
  purr.mine = { hand, nonce, commit };
  purr.commits.set(self, commit);
  gameFx({ kind: 'purrinha', ph: 'hcommit', gameId: purr.gameId, rd: purr.rd, from: self, commit });
  sound.pop();
  renderPurrWait();
  purrTryGates();
}
function onPurrHCommit(fx) {
  if (!purr || purr.mode === 'fast' || fx.gameId !== purr.gameId) return;
  if (fx.rd > purr.rd) { purr.early.push(fx); return; } // peer rápido já foi pra próxima rodada
  if (fx.rd !== purr.rd) return;
  if (!purr.alive.includes(fx.from) || purr.commits.has(fx.from)) return;
  purr.commits.set(fx.from, fx.commit);
  if (purr.phase === 'pick' && (purr.mine || !purr.alive.includes(self))) renderPurrWait();
  purrTryGates();
}
// palpite público: aceito de quem está vivo, lacrou e ainda não falou — número válido e inédito
function onPurrGuessFx(fx) {
  if (!purr || purr.mode === 'fast' || fx.gameId !== purr.gameId) return;
  if (fx.rd > purr.rd || (fx.rd === purr.rd && purr.phase === 'pick')) { purr.early.push(fx); return; }
  if (fx.rd !== purr.rd || purr.phase !== 'guessing') return;
  applyPurrGuess(fx.from, Math.floor(Number(fx.guess)));
}
function applyPurrGuess(from, n) {
  if (!purr.alive.includes(from) || !purr.commits.has(from) || purr.guesses.has(from)) return;
  if (!validGuessTo(n, purrCeil(), [...purr.guesses.values()])) return; // repetido/fora da faixa → não vale
  purr.guesses.set(from, n);
  purr.saidSeq.push({ id: from, guess: n });
  purrTryGates();
  if (purr && purr.phase === 'guessing') renderPurrGuessing();
}
function myPurrGuess(n) {
  if (!purr || purr.mode === 'fast' || purr.phase !== 'guessing') return;
  if (!purr.alive.includes(self) || purr.guesses.has(self)) return;
  n = Math.floor(Number(n));
  if (!validGuessTo(n, purrCeil(), [...purr.guesses.values()])) { ui.toast('Esse número já foi dito 🙃'); return; }
  applyPurrGuess(self, n);
  gameFx({ kind: 'purrinha', ph: 'guess', gameId: purr.gameId, rd: purr.rd, from: self, guess: n });
  sound.pop();
}
function renderPurrGuessing() {
  if (!purr || purr.phase !== 'guessing') return;
  const order = guessOrder(purr.alive, purr.startIdx).filter((id) => purr.commits.has(id) && purrOnline(id));
  const turnId = order.find((id) => !purr.guesses.has(id)) ?? null;
  const livres = purr.freed.length ? ` · livres 🍀: ${purr.freed.map(purrName).join(', ')}` : '';
  const status = purr.mode === 'sticks'
    ? `Rodada ${purr.rd} · 🥢 ${purrPoolsStr()}${livres}`
    : `Rodada ${purr.rd} · na mesa: ${purr.alive.map(purrName).join(', ')}${livres}`;
  ui.purrinhaGuessing({
    status,
    said: purr.saidSeq.map((s) => ({ name: purrName(s.id), avatar: profOf(s.id).emoji, guess: s.guess, isSelf: s.id === self })),
    myTurn: turnId === self, turnName: turnId ? purrName(turnId) : '',
    maxGuess: purrCeil(), taken: [...purr.guesses.values()],
  });
}
async function onPurrHReveal(fx) {
  if (!purr || purr.mode === 'fast' || fx.gameId !== purr.gameId) return;
  if (fx.rd > purr.rd || (fx.rd === purr.rd && purr.phase !== 'revealing')) { purr.early.push(fx); return; }
  if (fx.rd !== purr.rd) return;
  const commit = purr.commits.get(fx.from);
  if (!commit || purr.reveals.has(fx.from)) return;
  const good = await verifyHandReveal({ hand: fx.hand, nonce: fx.nonce, commit });
  if (!good) { purr.cheats.add(fx.from); ui.toast(`🚫 ${purrName(fx.from)} tentou trapacear na purrinha!`); return; }
  // 3-2-1: todo peer confere que ninguém escondeu mais palitos do que TEM (estoque é público)
  if (purr.mode === 'sticks' && clampHand(fx.hand) > purrPool(fx.from)) {
    purr.cheats.add(fx.from); ui.toast(`🚫 ${purrName(fx.from)} jogou mais palitos do que tem!`); return;
  }
  purr.reveals.set(fx.from, { hand: clampHand(fx.hand), nonce: fx.nonce });
  renderPurrWait();
  purrTryGates();
}
// portões do clássico (e re-check do rápido): avançam a fase quando todo mundo esperado cumpriu
function purrTryGates() {
  if (!purr) return;
  if (purr.mode === 'fast') { maybePurrReveal(); maybePurrResolve(); return; }
  if (purr.phase === 'pick') {
    const exp = purrExpected();
    if (exp.length >= 2 && exp.every((id) => purr.commits.has(id))) {
      purr.phase = 'guessing';
      purrDrainEarly();
      renderPurrGuessing();
    }
  }
  if (purr.phase === 'guessing') {
    const order = guessOrder(purr.alive, purr.startIdx).filter((id) => purr.commits.has(id) && purrOnline(id));
    if (order.length && order.every((id) => purr.guesses.has(id))) {
      purr.phase = 'revealing';
      if (purr.mine && purr.alive.includes(self) && !purr.reveals.has(self)) {
        purr.reveals.set(self, { hand: purr.mine.hand, nonce: purr.mine.nonce });
        gameFx({ kind: 'purrinha', ph: 'hreveal', gameId: purr.gameId, rd: purr.rd, from: self, hand: purr.mine.hand, nonce: purr.mine.nonce });
      }
      purrDrainEarly();
      renderPurrWait();
    }
  }
  if (purr.phase === 'revealing') {
    const exp = purr.alive.filter((id) => purr.commits.has(id) && purrOnline(id));
    if (exp.length && exp.every((id) => purr.reveals.has(id))) {
      if (purr.mode === 'sticks') finishSticksRound(); else finishClassicRound();
    }
  }
}
function finishClassicRound() {
  const reveals = [...purr.reveals.entries()].map(([id, r]) => ({ id, hand: r.hand }));
  const { total, winnerId } = classicRound(reveals, purr.saidSeq);
  const step = nextRound(purr.alive, purr.startIdx, winnerId);
  const rdNow = purr.rd;
  const rows = reveals.map((x) => ({
    name: purrName(x.id), avatar: profOf(x.id).emoji, hand: x.hand,
    guess: purr.guesses.has(x.id) ? purr.guesses.get(x.id) : '—',
    isSeer: x.id === winnerId, isLoser: step.done && x.id === step.loserId, isSelf: x.id === self,
  })).sort((a, b) => (b.isSeer - a.isSeer) || (a.isLoser - b.isLoser));
  if (step.done) {
    purr.phase = 'done';
    if (gameMinned.has('purr')) reopenGame('purr'); // fim de jogo fura o minimizado
    if (winnerId) purr.freed.push(winnerId);
    const loser = step.loserId;
    let verdict;
    if (loser === self) verdict = { text: '💸 Você paga a próxima!', kind: 'lose' };
    else if (winnerId === self) verdict = { text: `🍀 Você cravou ${total} e se livrou — ${purrName(loser)} paga!`, kind: 'win' };
    else verdict = { text: `💸 ${purrName(loser)} paga a próxima!`, kind: 'other' };
    ui.purrinhaResult({ status: `Rodada ${rdNow} · fim de jogo`, total, rows, verdict, final: true });
    if (loser === self) { sound.alarm(); ui.vibrate([80, 40, 80]); } else { sound.cheers(); ui.celebrate(['🫲', '🍀', '🍻']); }
    return;
  }
  if (winnerId) purr.freed.push(winnerId);
  const msg = winnerId
    ? (winnerId === self ? `🍀 Você cravou ${total} e se livrou!` : `🍀 ${purrName(winnerId)} cravou ${total} e se livrou!`)
    : `Ninguém cravou ${total} — vai de novo!`;
  ui.purrinhaResult({
    status: `Rodada ${rdNow} · seguem na disputa: ${step.alive.map(purrName).join(', ')}`,
    total, rows, verdict: { text: msg, kind: winnerId === self ? 'win' : 'other' }, final: false,
  });
  if (winnerId === self) { sound.cheers(); ui.celebrate(['🍀', '🫲']); } else sound.pop();
  // o estado avança JÁ (determinístico em todo peer); a UI segura o resultado por um instante
  purr.alive = step.alive; purr.startIdx = step.startIdx; purr.rd = rdNow + 1;
  purr.mine = null; purr.commits = new Map(); purr.guesses = new Map(); purr.saidSeq = []; purr.reveals = new Map();
  purr.phase = 'pick';
  purrDrainEarly();
  const gid = purr.gameId, r = purr.rd;
  setTimeout(() => { if (purr && purr.gameId === gid && purr.rd === r && purr.phase === 'pick') renderPurrPick(); }, 2600);
}
// 3-2-1: cravou → descarta 1 palito (e fala primeiro na próxima); zerou → livre; último com palitos paga
function finishSticksRound() {
  const reveals = [...purr.reveals.entries()].map(([id, r]) => ({ id, hand: r.hand }));
  const { total, winnerId } = classicRound(reveals, purr.saidSeq);
  const step = sticksNext(purr.pools, purr.startIdx, winnerId);
  const rdNow = purr.rd;
  const rows = reveals.map((x) => ({
    name: purrName(x.id), avatar: profOf(x.id).emoji, hand: x.hand,
    guess: purr.guesses.has(x.id) ? purr.guesses.get(x.id) : '—',
    isSeer: x.id === winnerId, isLoser: step.done && x.id === step.loserId, isSelf: x.id === self,
  })).sort((a, b) => (b.isSeer - a.isSeer) || (a.isLoser - b.isLoser));
  if (step.done) {
    purr.pools = step.pools; purr.alive = step.alive; purr.phase = 'done';
    if (gameMinned.has('purr')) reopenGame('purr'); // fim de jogo fura o minimizado
    if (step.freedId) purr.freed.push(step.freedId);
    const loser = step.loserId;
    let verdict;
    if (loser === self) verdict = { text: '💸 Você paga a próxima!', kind: 'lose' };
    else if (winnerId === self) verdict = { text: `🍀 Você zerou os palitos — ${purrName(loser)} paga!`, kind: 'win' };
    else verdict = { text: `💸 ${purrName(loser)} paga a próxima!`, kind: 'other' };
    ui.purrinhaResult({ status: `Rodada ${rdNow} · fim de jogo`, total, rows, verdict, final: true });
    if (loser === self) { sound.alarm(); ui.vibrate([80, 40, 80]); } else { sound.cheers(); ui.celebrate(['🥢', '🍀', '🍻']); }
    return;
  }
  if (step.freedId) purr.freed.push(step.freedId);
  let msg;
  if (winnerId == null) msg = `Ninguém cravou ${total} — vai de novo!`;
  else if (step.freedId === winnerId) msg = winnerId === self ? '🍀 Você zerou os palitos e se livrou!' : `🍀 ${purrName(winnerId)} zerou os palitos e se livrou!`;
  else {
    const left = (step.pools.find((p) => p.id === winnerId) || {}).sticks;
    msg = winnerId === self
      ? `🎯 Você cravou ${total} — descartou um palito (restam ${left}). Você fala primeiro!`
      : `🎯 ${purrName(winnerId)} cravou ${total} — descartou um palito (restam ${left}) e fala primeiro.`;
  }
  ui.purrinhaResult({
    status: `Rodada ${rdNow} · 🥢 ${purrPoolsStr(step.pools)}`,
    total, rows, verdict: { text: msg, kind: winnerId === self ? 'win' : 'other' }, final: false,
  });
  if (winnerId === self) { sound.cheers(); ui.celebrate(['🥢', '🎯']); } else sound.pop();
  purr.pools = step.pools; purr.alive = step.alive; purr.startIdx = step.startIdx; purr.rd = rdNow + 1;
  purr.mine = null; purr.commits = new Map(); purr.guesses = new Map(); purr.saidSeq = []; purr.reveals = new Map();
  purr.phase = 'pick';
  purrDrainEarly();
  const gid = purr.gameId, r = purr.rd;
  setTimeout(() => { if (purr && purr.gameId === gid && purr.rd === r && purr.phase === 'pick') renderPurrPick(); }, 2600);
}
function cancelPurrinha(broadcast) {
  if (!purr) return;
  if (broadcast && purr.phase !== 'revealed' && purr.phase !== 'done') gameFx({ kind: 'purrinha', ph: 'cancel', gameId: purr.gameId, from: self });
  purr = null;
}

// ---- Dominó (P2P; MÃOS privadas via canal direto `sendTo`, JOGADAS públicas e validadas) ----
let dom = null;
function domEntrants() { const out = [self]; if (mesh) for (const p of mesh.peers()) if (p.online) out.push(p.user); return out; }
function domName(id) { return id === self ? (getName() || 'você') : (profOf(id).name || 'alguém'); }
function cryptoSeed() { try { const b = new Uint32Array(1); crypto.getRandomValues(b); return b[0]; } catch { return Date.now() >>> 0; } }

function beginDomino(d) {
  const order = d.order;
  dom = {
    gameId: d.gameId, players: order.length, order, idxOf: new Map(order.map((id, i) => [id, i])),
    chain: [], ends: [null, null], counts: { ...d.counts }, myHand: (d.hand || []).map((t) => t.slice()),
    turnIdx: 0, passes: 0, over: false, winner: null, reason: null, phase: 'play', reveals: new Map(),
    // mesa verificada (só preenchido no modo verificado)
    verified: !!d.verified, isHost: !!d.isHost, vinfo: d.vinfo || null,
    initialHand: (d.hand || []).map((t) => t.slice()), opens: {}, audit: null, auditStarted: false,
  };
  domApplyPlay(d.starter, d.firstTile, 'L'); // abertura forçada (maior carroça)
  if (dvWatch) { clearTimeout(dvWatch); dvWatch = null; } // handshake concluiu
  if (!gameMinned.has('dom')) ui.openDomino(); // quem minimizou no handshake segue no contador
  renderDom();
}
function domApplyPlay(fromId, tile, side) {
  if (!dom || dom.over) return false;
  const placed = place(dom.chain, dom.ends, tile, side);
  if (!placed) return false; // jogada ilegal — ignora (jogada pública não confia no remetente)
  dom.chain = placed.chain; dom.ends = placed.ends; dom.passes = 0;
  dom.lastBy = fromId; dom.lastSide = side; // quem jogou a última peça (e em que ponta) → feedback
  dom.counts[fromId] = Math.max(0, (dom.counts[fromId] || 0) - 1);
  if (fromId === self) { const k = domKey(tile); const i = dom.myHand.findIndex((t) => domKey(t) === k); if (i >= 0) dom.myHand.splice(i, 1); }
  if (dom.counts[fromId] <= 0) { dom.over = true; dom.winner = fromId; dom.reason = 'batida'; }
  else dom.turnIdx = (dom.idxOf.get(fromId) + 1) % dom.players;
  return true;
}
function domApplyPass(fromId) {
  if (!dom || dom.over) return;
  dom.passes += 1;
  if (dom.passes >= dom.players) domBlocked();
  else dom.turnIdx = (dom.idxOf.get(fromId) + 1) % dom.players;
}
function domBlocked() {
  if (!dom || dom.phase === 'reveal') return;
  dom.phase = 'reveal';
  dom.reveals.set(self, dom.myHand.slice());
  gameFx({ kind: 'domino', ph: 'reveal', gameId: dom.gameId, from: self, hand: dom.myHand });
  domResolveBlock();
}
function domResolveBlock() {
  if (!dom || dom.over) return;
  const missing = dom.order.filter((id) => !dom.reveals.has(id));
  if (missing.length) { armDomNoshow(missing); return; } // espera as mãos (com teto pra quem caiu)
  if (domNoshow) { clearTimeout(domNoshow); domNoshow = null; }
  let winner = null, best = Infinity;
  for (const id of dom.order) {
    const h = dom.reveals.get(id);
    if (!h) continue; // 'noshow': quem caiu sem abrir a mão fica de fora da apuração
    const c = pipCount(h);
    if (c < best) { best = c; winner = id; }
  }
  dom.over = true; dom.winner = winner; dom.reason = 'trancou';
  renderDom(); domCelebrate();
}
function onDomPlay(fx) { if (!dom || fx.gameId !== dom.gameId) return; domApplyPlay(fx.from, fx.tile, fx.side); renderDom(); domCelebrate(); if (fx.from !== self) sound.pop(); }
function onDomPass(fx) { if (!dom || fx.gameId !== dom.gameId) return; if (fx.from !== self) ui.toast(`🁫 ${domName(fx.from)} passou`); domApplyPass(fx.from); renderDom(); domCelebrate(); }
function onDomReveal(fx) { if (!dom || fx.gameId !== dom.gameId) return; dom.reveals.set(fx.from, fx.hand || []); if (dom.phase !== 'reveal') domBlocked(); domResolveBlock(); }
function myDomPlay(key, side) {
  if (!dom || dom.over || dom.order[dom.turnIdx] !== self) { ui.toast('Calma, não é sua vez 🙂'); return; }
  const tile = dom.myHand.find((t) => domKey(t) === key);
  if (!tile || !place(dom.chain, dom.ends, tile, side)) { ui.toast('Essa não encaixa aí 🙂'); return; }
  gameFx({ kind: 'domino', ph: 'play', gameId: dom.gameId, from: self, tile, side });
  domApplyPlay(self, tile, side); sound.pop(); renderDom(); domCelebrate();
}
function myDomPass() {
  if (!dom || dom.over || dom.order[dom.turnIdx] !== self) return;
  if (legalMoves(dom.myHand, dom.ends).length) { ui.toast('Você tem encaixe — não pode passar'); return; }
  gameFx({ kind: 'domino', ph: 'pass', gameId: dom.gameId, from: self });
  domApplyPass(self); renderDom(); domCelebrate();
}
function domCelebrate() {
  if (!dom || !dom.over) return;
  if (gameMinned.has('dom')) reopenGame('dom'); // fim de jogo fura o minimizado (hora de ver quem paga)
  if (dom.verified) domStartAudit(); // mesa verificada: dispara a auditoria no fim
  if (dom.cheered) return;
  dom.cheered = true;
  if (dom.winner === self) { sound.cheers(); ui.celebrate(['🁫', '🎉', '🍻', '🏆']); } else { sound.alarm(); ui.vibrate([80, 40, 80]); }
}
function renderDom() {
  if (!dom) return;
  const myTurn = !dom.over && dom.order[dom.turnIdx] === self;
  const moves = myTurn ? legalMoves(dom.myHand, dom.ends) : [];
  const sidesByKey = new Map();
  for (const m of moves) { const k = domKey(m.tile); if (!sidesByKey.has(k)) sidesByKey.set(k, []); sidesByKey.get(k).push(m.side); }
  const hand = dom.myHand.map((t) => ({ key: domKey(t), a: t[0], b: t[1], sides: sidesByKey.get(domKey(t)) || [] }));
  const opponents = dom.order.filter((id) => id !== self).map((id) => ({ name: domName(id), avatar: profOf(id).emoji, count: dom.counts[id] || 0, isTurn: !dom.over && dom.order[dom.turnIdx] === id, justPlayed: id === dom.lastBy }));
  // feedback de quem jogou a última peça: índice da peça no tabuleiro (ponta L=0, R=última) + avatar
  const lastPlayIdx = (dom.lastBy && dom.chain.length) ? (dom.lastSide === 'L' ? 0 : dom.chain.length - 1) : -1;
  const lastPlayAvatar = dom.lastBy ? profOf(dom.lastBy).emoji : '';
  const lastPlayName = dom.lastBy ? (dom.lastBy === self ? 'Você' : domName(dom.lastBy)) : '';
  let result = null;
  if (dom.over) { const wn = dom.winner === self ? 'Você' : domName(dom.winner); result = dom.reason === 'batida' ? `${wn} bateu! 🁫` : `Trancou 🔒 — ${wn} fez menos pontos`; }
  let verified = null;
  if (dom.verified) {
    if (dom.audit && dom.audit.ok === true) verified = { ok: true, text: '🔒✅ Mesa verificada — embaralho auditado, limpo' };
    else if (dom.audit && dom.audit.ok === false) verified = { ok: false, text: '🚫 ' + dom.audit.reason };
    else if (dom.audit) verified = { ok: null, text: '🔒 ' + dom.audit.reason }; // incompleta (alguém saiu sem abrir)
    else if (dom.over) verified = { ok: null, text: '🔒 Auditando o embaralho…' };
    else verified = { ok: null, text: '🔒 Mesa verificada' };
  }
  ui.renderDomino({
    board: dom.chain.map((t) => ({ a: t[0], b: t[1] })), ends: dom.ends, hand, opponents,
    turn: dom.over ? '' : (myTurn ? 'Sua vez!' : `Vez de ${domName(dom.order[dom.turnIdx])}`),
    myTurn, canPass: myTurn && moves.length === 0, over: dom.over, iWon: dom.winner === self, result, verified,
    lastPlayIdx, lastPlayAvatar, lastPlayName,
  });
  armDomAutoPass(myTurn && moves.length === 0 && !dom.over);
  armDomSkip();       // dono da vez sumiu? conta a graça pro pulo automático
  updateGamePill();   // minimizado: o pill reflete "sua vez" na hora
}
// Sem encaixe, o passe sai sozinho em 5s (contagem no botão) — ninguém fica esperando quem
// só tem "passar" a fazer. Com encaixe na mão, nada é automático.
let domPassTimer = null;
function armDomAutoPass(shouldRun) {
  if (domPassTimer) { clearInterval(domPassTimer); domPassTimer = null; }
  if (!shouldRun) return;
  let left = 5;
  ui.setDomPassCount(left);
  domPassTimer = setInterval(() => {
    if (!dom || dom.over || dom.order[dom.turnIdx] !== self) { clearInterval(domPassTimer); domPassTimer = null; return; }
    left--;
    if (left <= 0) { clearInterval(domPassTimer); domPassTimer = null; myDomPass(); return; }
    ui.setDomPassCount(left);
  }, 1000);
}

// ---- Ausente no dominó: a mesa nunca trava ----
// A mão é PRIVADA ⇒ um "bot" jogar por quem caiu é impossível (ninguém conhece as pedras dele).
// Em vez disso a vez é PULADA: com o dono da vez offline por 20s, o participante online de MENOR
// id emite um 'skip' (gossip com dedup) e todo peer o aplica como passe SE a vez ainda for daquela
// pessoa — emissão atrasada/duplicada morre nesse portão, então converge. Quem volta joga normal
// nas vezes seguintes. O mesmo padrão cobre a tranca (mão que nunca vai abrir) e a auditoria.
const DOM_SKIP_MS = 20000;
let domSkip = { timer: null, for: null };
let domNoshow = null;    // tranca: teto de espera pela mão de quem caiu
let domAuditWait = null; // auditoria do fim: vira "incompleta" em vez de pendurar
let dvWatch = null;      // handshake verificado: o dono re-embaralha sem quem caiu

function domOnlineIds() {
  const on = new Set([self]);
  if (mesh) for (const p of mesh.peers()) if (p.online) on.add(p.user);
  return on;
}
function domClearTimers() {
  armDomAutoPass(false);
  if (domSkip.timer) clearTimeout(domSkip.timer);
  domSkip = { timer: null, for: null };
  if (domNoshow) { clearTimeout(domNoshow); domNoshow = null; }
  if (domAuditWait) { clearTimeout(domAuditWait); domAuditWait = null; }
  if (dvWatch) { clearTimeout(dvWatch); dvWatch = null; }
}
function armDomSkip() {
  const holder = dom && !dom.over ? dom.order[dom.turnIdx] : null;
  const offline = holder && holder !== self && !domOnlineIds().has(holder);
  if (!offline) {
    if (domSkip.timer) clearTimeout(domSkip.timer);
    domSkip = { timer: null, for: null };
    return;
  }
  if (domSkip.timer && domSkip.for === holder) return; // já contando pra esse
  if (domSkip.timer) clearTimeout(domSkip.timer);
  const gid = dom.gameId;
  domSkip = {
    for: holder,
    timer: setTimeout(() => {
      domSkip = { timer: null, for: null };
      if (!dom || dom.over || dom.gameId !== gid || dom.order[dom.turnIdx] !== holder) return;
      const on = domOnlineIds();
      if (on.has(holder)) return; // voltou a tempo — joga normal
      const cands = dom.order.filter((id) => on.has(id)).sort();
      if (cands[0] !== self) return; // outro peer emite; se ele também caiu, onMeshChange re-arma
      ui.toast(`⏭️ Pulando a vez de ${domName(holder)} (fora da mesa)`);
      gameFx({ kind: 'domino', ph: 'skip', gameId: gid, for: holder, from: self });
      domApplyPass(holder); renderDom(); domCelebrate();
    }, DOM_SKIP_MS),
  };
}
function onDomSkip(fx) {
  if (!dom || fx.gameId !== dom.gameId || dom.over) return;
  if (dom.order[dom.turnIdx] !== fx.for) return; // a vez já andou — skip atrasado não vale
  ui.toast(fx.for === self ? '⏭️ Sua vez foi pulada (a mesa não te via online)' : `⏭️ Pulando a vez de ${domName(fx.for)} (fora da mesa)`);
  domApplyPass(fx.for); renderDom(); domCelebrate();
}
// Trancou mas falta a mão de alguém OFFLINE: espera um pouco (o reveal pode estar em voo);
// se não vier, o peer de menor id manda 'noshow' e a apuração sai só entre as mãos abertas.
function armDomNoshow(missing) {
  if (domNoshow) return;
  if (missing.some((id) => domOnlineIds().has(id))) return; // tem gente online ainda revelando
  const gid = dom.gameId;
  domNoshow = setTimeout(() => {
    domNoshow = null;
    if (!dom || dom.over || dom.gameId !== gid || dom.phase !== 'reveal') return;
    const on = domOnlineIds();
    const miss = dom.order.filter((id) => !dom.reveals.has(id) && !on.has(id));
    if (!miss.length) { domResolveBlock(); return; }
    const cands = dom.order.filter((id) => on.has(id)).sort();
    if (cands[0] !== self) return; // outro emite; se ele caiu, onMeshChange re-arma
    gameFx({ kind: 'domino', ph: 'noshow', gameId: gid, miss, from: self });
    onDomNoshow({ gameId: gid, miss });
  }, 12000);
}
function onDomNoshow(fx) {
  if (!dom || fx.gameId !== dom.gameId || dom.over) return;
  const skipped = [];
  for (const id of fx.miss || []) if (!dom.reveals.has(id)) { dom.reveals.set(id, null); skipped.push(domName(id)); }
  if (skipped.length) ui.toast(`🁫 Trancou sem a mão de ${skipped.join(', ')} (offline) — apurando entre as abertas`);
  domResolveBlock();
}

// ---- Dominó: MESA VERIFICADA (commit-to-deck + corte coletivo + auditoria no fim) ----
// Handshake antes do jogo: todos lacram um seed (commit) → revelam → o corte coletivo σ sai dos
// seeds; o dono lacra o baralho antes de ver σ (não mira num baralho favorável) e entrega cada
// mão com um lacre que o dono confere na hora. No fim, o baralho é revelado e todos AUDITAM.
let dv = null;
async function startDominoVerified() {
  if (!room) { ui.toast('Entre numa mesa 🙂'); return; }
  const order = domEntrants();
  if (order.length < 2 || order.length > 4) { ui.toast('Dominó é de 2 a 4 pessoas 🙂'); return; }
  const gameId = 'dv' + cryptoSeed();
  const deck = shuffle(FULL_SET, rngFrom(cryptoSeed())); // baralho do dono (secreto até o fim)
  const salt = randomNonce(); const mySeed = randomNonce();
  const dc = await deckCommit(deck, salt); const mySc = await sha256Hex(mySeed);
  dv = { gameId, order, host: true, deck, salt, mySeed, deckCommit: dc, seeds: { [self]: mySeed }, seedCommits: { [self]: mySc }, phase: 'commit', began: false };
  clearGameMin('dom'); // jogo novo abre na cara
  ui.openDomino(); renderVwait();
  gameFx({ kind: 'domino', ph: 'vsetup', gameId, order, deckCommit: dc });
  gameFx({ kind: 'domino', ph: 'vseed', gameId, from: self, sc: mySc });
  armDvWatch();
}
// Handshake pendurado (alguém caiu antes de lacrar/revelar o seed): o DONO re-embaralha só com
// quem ficou; convidado espera o dono — e fecha se foi o próprio dono que caiu.
function armDvWatch() {
  if (dvWatch) clearTimeout(dvWatch);
  const gid = dv.gameId;
  dvWatch = setTimeout(() => {
    dvWatch = null;
    if (!dv || dv.gameId !== gid || dv.began || dv.phase === 'dealt') return;
    const on = domOnlineIds();
    if (dv.host) {
      const still = dv.order.filter((id) => on.has(id));
      dv = null;
      if (still.length >= 2) { ui.toast('🔄 Alguém caiu no embaralho — re-embaralhando com quem ficou'); startDominoVerified(); }
      else { clearGameMin('dom'); ui.closeOverlays(); ui.toast('🁫 Dominó cancelado — a mesa esvaziou'); }
    } else if (!on.has(dv.order[0])) { // order[0] = quem deu as cartas
      dv = null; clearGameMin('dom'); ui.closeOverlays(); ui.toast('🁫 Quem embaralhava caiu — dominó cancelado');
    } else armDvWatch(); // dono online: ele vai re-embaralhar; segue de olho
  }, 20000);
}
async function onVsetup(fx) {
  if (dv && dv.gameId === fx.gameId) return;
  const mySeed = randomNonce(); const mySc = await sha256Hex(mySeed);
  dv = { gameId: fx.gameId, order: fx.order, host: false, deckCommit: fx.deckCommit, mySeed, seeds: { [self]: mySeed }, seedCommits: { [self]: mySc }, phase: 'commit', began: false };
  clearGameMin('dom'); // convite novo abre na cara
  ui.openDomino(); renderVwait();
  gameFx({ kind: 'domino', ph: 'vseed', gameId: fx.gameId, from: self, sc: mySc });
  armDvWatch();
}
function onVseed(fx) {
  if (!dv || dv.gameId !== fx.gameId) return;
  dv.seedCommits[fx.from] = fx.sc; renderVwait();
  if (dv.host && dv.phase === 'commit' && dv.order.every((id) => dv.seedCommits[id])) {
    dv.phase = 'reveal';
    gameFx({ kind: 'domino', ph: 'vgo', gameId: dv.gameId });
    gameFx({ kind: 'domino', ph: 'vseedrev', gameId: dv.gameId, from: self, seed: dv.mySeed });
  }
}
function onVgo(fx) {
  if (!dv || dv.gameId !== fx.gameId || dv.host || dv.phase !== 'commit') return;
  dv.phase = 'reveal';
  gameFx({ kind: 'domino', ph: 'vseedrev', gameId: dv.gameId, from: self, seed: dv.mySeed });
}
async function onVseedrev(fx) {
  if (!dv || dv.gameId !== fx.gameId) return;
  dv.seeds[fx.from] = fx.seed; renderVwait(); // guarda sempre (converge); valida vs commit na auditoria
  if (dv.host && dv.phase === 'reveal' && dv.order.every((id) => dv.seeds[id])) { dv.phase = 'dealt'; await hostDealVerified(); }
}
async function hostDealVerified() {
  dv.began = true; // o watchdog do handshake não vale mais a partir do deal
  const R = await combineSeeds(dv.seeds);
  const F = cutDeck(dv.deck, R);
  const { hands } = dealFromDeck(F, dv.order.length);
  const op = opening(hands);
  const counts = {}, handCommits = {}, salts = {};
  for (let k = 0; k < dv.order.length; k++) { counts[dv.order[k]] = hands[k].length; salts[k] = randomNonce(); handCommits[dv.order[k]] = await handCommit(hands[k], salts[k]); }
  // vdeal carrega os seeds/lacres (autoritativo, completo) — a auditoria fica auto-contida e não
  // depende do que cada peer juntou do gossip; o cross-check vs o que o peer coletou pega adulteração.
  const pub = { kind: 'domino', ph: 'vdeal', gameId: dv.gameId, order: dv.order, starter: dv.order[op.player], firstTile: op.tile, counts, deckCommit: dv.deckCommit, handCommits, seeds: dv.seeds, seedCommits: dv.seedCommits };
  gameFx(pub);
  for (let k = 0; k < dv.order.length; k++) {
    const id = dv.order[k];
    if (id === self) beginDomino({ ...pub, hand: hands[k], verified: true, isHost: true, vinfo: { deckCommit: dv.deckCommit, handCommits, seeds: dv.seeds, seedCommits: dv.seedCommits, mySalt: salts[k], deck: dv.deck, salt: dv.salt } });
    else if (mesh) mesh.sendTo(id, { k: 'fx', fx: { kind: 'domino', ph: 'vhand', gameId: dv.gameId, hand: hands[k], salt: salts[k] } });
  }
}
function onVdeal(fx) { if (!dv || dv.gameId !== fx.gameId || dv.host) return; dv.deal = fx; tryBeginVerified(); }
function onVhand(fx) { if (!dv || dv.gameId !== fx.gameId) return; dv.hand = fx.hand; dv.mySalt = fx.salt; tryBeginVerified(); }
async function tryBeginVerified() {
  if (!dv || dv.began || !dv.deal || !dv.hand) return;
  dv.began = true;
  const d = dv.deal;
  if ((await handCommit(dv.hand, dv.mySalt)) !== d.handCommits[self]) ui.toast('🚫 Sua mão não bate com o lacre da mesa!');
  beginDomino({ ...d, hand: dv.hand, verified: true, isHost: false, vinfo: { deckCommit: d.deckCommit, handCommits: d.handCommits, seeds: d.seeds, seedCommits: d.seedCommits, mySalt: dv.mySalt } });
}
// No fim: cada um revela a mão INICIAL que recebeu; o dono revela o baralho; todos auditam.
function domStartAudit() {
  if (!dom || !dom.over || !dom.verified || dom.auditStarted) return;
  dom.auditStarted = true;
  dom.opens[self] = { hand: dom.initialHand, salt: dom.vinfo.mySalt };
  gameFx({ kind: 'domino', ph: 'vopenhand', gameId: dom.gameId, from: self, hand: dom.initialHand, salt: dom.vinfo.mySalt });
  if (dom.isHost) { dom.revealedDeck = dom.vinfo.deck; dom.revealedSalt = dom.vinfo.salt; gameFx({ kind: 'domino', ph: 'vopen', gameId: dom.gameId, deck: dom.vinfo.deck, salt: dom.vinfo.salt }); }
  armDomAuditWait(); // quem saiu antes de abrir a mão não pendura o badge pra sempre
  tryAudit();
}
function armDomAuditWait() {
  if (domAuditWait) return;
  const gid = dom.gameId;
  domAuditWait = setTimeout(() => {
    domAuditWait = null;
    if (!dom || dom.gameId !== gid || !dom.verified || dom.audit) return;
    const on = domOnlineIds();
    const missOpen = dom.order.filter((id) => !dom.opens[id] && !on.has(id));
    if (!missOpen.length && dom.revealedDeck) return; // está vindo — tryAudit fecha
    const who = missOpen.length ? missOpen.map(domName).join(', ') : 'quem embaralhou';
    dom.audit = { ok: null, reason: `auditoria incompleta — ${who} saiu sem abrir` };
    renderDom();
  }, 15000);
}
function onVopen(fx) { if (!dom || dom.gameId !== fx.gameId) return; dom.revealedDeck = fx.deck; dom.revealedSalt = fx.salt; domStartAudit(); tryAudit(); }
function onVopenhand(fx) { if (!dom || dom.gameId !== fx.gameId) return; dom.opens[fx.from] = { hand: fx.hand, salt: fx.salt }; domStartAudit(); tryAudit(); }
async function tryAudit() {
  if (!dom || !dom.verified || (dom.audit && dom.audit.ok !== null) || !dom.revealedDeck) return; // 'incompleta' ainda upgrada
  if (!dom.order.every((id) => dom.opens[id])) return; // espera o baralho + todas as mãos reveladas
  const fail = (reason) => { dom.audit = { ok: false, reason }; renderDom(); ui.toast('🚫 ' + reason); };
  const seeds = dom.vinfo.seeds || {}, seedCommits = dom.vinfo.seedCommits || {};
  // cross-check (best-effort): os seeds/lacres do vdeal batem com os que EU coletei direto no handshake?
  if (dv) for (const id of dom.order) {
    if (dv.seedCommits && dv.seedCommits[id] && dv.seedCommits[id] !== seedCommits[id]) return fail(`o dono trocou o lacre de seed de ${domName(id)}`);
    if (dv.seeds && dv.seeds[id] && dv.seeds[id] !== seeds[id]) return fail(`o dono trocou o seed de ${domName(id)}`);
  }
  for (const id of dom.order) { // cada um revelou a mesma mão que lacrou?
    if ((await handCommit(dom.opens[id].hand, dom.opens[id].salt)) !== dom.vinfo.handCommits[id]) return fail(`${domName(id)} revelou mão diferente do lacre`);
  }
  const initialHands = dom.order.map((id) => dom.opens[id].hand);
  dom.audit = await verifyDeal({ deck: dom.revealedDeck, salt: dom.revealedSalt, deckCommit: dom.vinfo.deckCommit, seeds, seedCommits, players: dom.order.length, initialHands });
  renderDom();
  ui.toast(dom.audit.ok ? '🔒✅ Mesa auditada — embaralho limpo!' : `🚫 ${dom.audit.reason}`);
}
function renderVwait() {
  if (!dv || dv.began) return;
  const have = dv.phase === 'commit' ? Object.keys(dv.seedCommits).length : Object.keys(dv.seeds).length;
  ui.dominoSetup(`🔒 Mesa verificada — ${dv.phase === 'commit' ? 'trocando os lacres' : 'revelando os cortes'} (${have}/${dv.order.length})…`);
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

// ---- Liga & desafios (renderizada dentro do Placar & conquistas) ----
function renderLeagueInfo() {
  const now = Date.now();
  const hist = store.getHistory();
  const current = room ? { at: now, items: myItems() } : null;
  ui.renderLeague({ level: levelFor(lifeStats(hist, { now })), challenges: weeklyChallenges(hist, current, { now }), season: seasonAward(hist, { now }) });
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
  onPeers: () => { renderPeers(); renderLeagueInfo(); ui.openPeers(); },
  onBrinde, onReact,
  // rodada é generosa demais pra sair num toque acidental: explica e confirma antes
  onRodada: () => ui.actionToast('🍻 Rodada = +1 cerveja pra todo mundo online (menos motoristas). Bora?', 'Bora!', rodada, 6000),
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
  onPurrinha: startPurrinha,
  onPurrStart: (mode) => startPurrinhaMode(mode),
  onPurrSeal: (hand, guess) => (purr && purr.mode !== 'fast' ? purrSealHand(hand) : purrSeal(hand, guess)),
  onPurrGuess: (n) => myPurrGuess(n),
  // ✕ = minimizar (a partida segue; pill traz de volta). Encerrar pra mesa toda = confirmação.
  onPurrClose: () => {
    if (purrActive()) { minimizeGame('purr'); return; }
    purr = null; clearGameMin('purr'); ui.closeOverlays();
  },
  onPurrEnd: () => ui.actionToast('Encerrar a purrinha pra mesa toda?', 'Encerrar', () => {
    cancelPurrinha(true); clearGameMin('purr'); ui.closeOverlays(); ui.toast('🫲 Partida encerrada');
  }),
  onDomino: () => startDominoVerified(), // sempre mesa verificada (regras iguais; só o embaralho é auditável)
  onDomPlay: (key, side) => myDomPlay(key, side),
  onDomPass: myDomPass,
  onDomClose: () => {
    if ((dom && !dom.over) || (dv && !dv.began && !dom)) { minimizeGame('dom'); return; }
    dom = null; domClearTimers(); clearGameMin('dom'); ui.closeOverlays();
  },
  onDomEnd: () => ui.actionToast('Encerrar o dominó pra mesa toda?', 'Encerrar', () => {
    const gid = dom && !dom.over ? dom.gameId : (dv && !dv.began ? dv.gameId : null);
    if (gid) gameFx({ kind: 'domino', ph: 'cancel', gameId: gid, from: self });
    dom = null; dv = null; domClearTimers(); clearGameMin('dom'); ui.closeOverlays(); ui.toast('🁫 Partida encerrada');
  }),
  onGameBack: () => {
    const domTurn = gameMinned.has('dom') && dom && !dom.over && dom.order[dom.turnIdx] === self;
    const kind = domTurn || gameMinned.has('dom') ? 'dom' : (gameMinned.has('purr') ? 'purr' : null);
    if (kind) reopenGame(kind);
  },
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

// gancho de debug (só leitura; usado pelos e2e pra diagnosticar estado interno)
try {
  window.__purrState = () => (purr ? {
    mode: purr.mode, phase: purr.phase, rd: purr.rd, alive: purr.alive, startIdx: purr.startIdx,
    commits: [...purr.commits.keys()], guesses: [...purr.guesses.entries()], reveals: [...purr.reveals.keys()],
    early: purr.early.map((f) => f.ph), self, online: mesh ? mesh.peers().map((p) => [p.user, !!p.online]) : [],
  } : null);
} catch { /* ambiente sem window */ }

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
  } else if (!getName() && !store.getHistory().length && !store.getFlag('welcomeSeen')) {
    store.setFlag('welcomeSeen'); // marca AO MOSTRAR: reload (ex.: troca de SW) não repete o guia
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
          // nova versão pronta e já havia uma controlando -> aplica SOZINHO (sem botão),
          // mas espera acabar jogo/overlay aberto pra não trocar o app embaixo de alguém
          if (nw.state === 'installed' && navigator.serviceWorker.controller) { swPending = nw; trySwUpdate(); }
        });
      });
    }).catch(() => {});
    setInterval(trySwUpdate, 5000); // re-tenta quando o jogo/overlay liberar
    // 1ª instalação: o claim() dispara controllerchange sem haver versão velha — NÃO recarrega
    // (era isso que piscava a tela e mostrava o guia de boas-vindas duas vezes).
    let hadController = !!navigator.serviceWorker.controller;
    let swReloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) { hadController = true; return; }
      if (!swReloaded) { swReloaded = true; location.reload(); } // hash re-entra na mesa sozinho
    });
  }
}

boot();
