// ============================================================================
// app.js — O ORQUESTRADOR. Único módulo que conhece todo mundo: amarra
// identidade, eventos (CRDT), malha WebRTC, UI, jogos, sons, PIX e share.
//
// O fluxo de UM +1 (o coração do app, vale pra tudo):
//   toque no card (ui.js) → handler H.onAdd aqui → makeAdd() cria o EVENTO
//   imutável (events.js) → emitLocal(): aplica no reducer, salva no
//   localStorage (store.js) e faz broadcast pela malha (mesh.js) → cada peer
//   recebe, deduplica por eventId e aplica no PRÓPRIO reducer → render().
//   Total = soma dos eventos (comutativa) ⇒ todo mundo converge.
//
// Papéis das camadas (regra de dependência: elas NÃO se importam entre si —
// só o app.js importa todas):
//   - events.js/lifestats.js/league.js/…  → LÓGICA PURA (testável em Node)
//   - mesh.js + signaling.js          → TRANSPORTE (WebRTC + sala de sinalização)
//   - ui.js                           → APRESENTAÇÃO (recebe view-model, dispara H.*)
//   - store.js/settings.js/identity.js→ PERSISTÊNCIA LOCAL (só localStorage)
//   - jogos (purrinha/domino/truco)   → motor puro no js/*.js; PROTOCOLO aqui
//     (fases via fx efêmero com dedup por mid — não entram no log da mesa)
//
// SUMÁRIO (as âncoras "// ----" abaixo, na ordem do arquivo):
//   Estado em memória · Signaling room (PIN) · Catálogo · Log/dedup · Ações de
//   consumo · Rodada coletiva · Efeitos sociais · Eventos remotos · Render ·
//   Mesa · Convite · Pareamento sem internet · Conta · Roleta ·
//   Jogo minimizado · Atualização automática (SW) · Tour guiado · Purrinha
//   (rápida/clássica/3-2-1) · Dominó (+ ausente + mesa verificada) · Truco ·
//   Cutucar · Cerimônia · Meus números · Retrospectiva · Liga ·
//   Modo bar · Handlers (objeto H — a API que a ui.js chama) · Boot
// ============================================================================

import { clientId, getName, setName, newRoomCode } from './identity.js';
import { t } from './i18n.js';
import { DEFAULT_ITEMS, itemIdFromName, autoColor, autoAvatar, catOf, isShare, isCup, isDefault } from './catalog.js';
import {
  emptyState, applyEvent, makeAdd, makeRemove, makeItem, makeProfile, makeTable, makeHappyHour, makePayFor, makeSong,
  getCount, itemTotal, userTotal, tableTotal, userMoney, summary, getProfile, tableInfo, isDriver, happyHour,
  paysFor, payerOf, songs, sharePool, shareSplit, paidCount,
} from './events.js';
import { badgesFor, milestoneLine, ceremonyAwards } from './achievements.js';
import { lifeStats, lifeBadges, monthlyTrend, weekdayInsight, retro } from './lifestats.js';
import { levelFor, weeklyChallenges, seasonAward } from './league.js';
import {
  clampHand, maxGuess as purrMax, randomNonce, makeCommit, verifyReveal, resolve as purrResolve, sha256Hex,
  makeHandCommit, verifyHandReveal, validGuessTo, guessOrder, classicRound, nextRound,
  clampHandTo, poolsTotal, sticksNext, STICKS_START,
} from './purrinha.js';
import {
  opening, legalMoves, place, pipCount, tileKey as domKey, rngFrom, shuffle, FULL_SET,
  deckCommit, handCommit, combineSeeds, cutDeck, dealFromDeck, verifyDeal,
} from './domino.js';
import {
  deckFor as truDeckFor, cardStr as truStr, raiseLabel, nextStake as truNext, canRaise as truCanRaise,
  maoRule, applyResult, teamOf, VARIANTS as TRU_VARIANTS,
  makeHandDeal, verifyOwnHand, verifyPlayReveal, verifyHandAudit,
  newTrucoHand, reduceT, settleEnvido, envidoPoints, hasFlor, florPoints,
} from './truco.js';
import {
  isBot, botProfile, pickBots, makeRng, botThinkMs,
  botPurrHand, botPurrGuess, botDominoMove,
  botTrucoHandStrength, botTrucoPlay, botTrucoRespondRaise, botTrucoWantRaise, botTrucoOnze,
} from './bots.js';
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
let renderScheduled = false;
let sessionStart = 0;        // quando entrei nesta mesa (p/ duração no histórico)
let prevOnline = new Set();  // presença: quem estava online (p/ avisar entrou/saiu)
let presenceSeeded = false;  // 1ª passada de presença só semeia (sem toast)
let everSeen = new Set();    // quem já apareceu online na sessão ("entrou!" só na 1ª vez)
let wentAway = new Set();    // quem saiu de verdade (passou da graça) — p/ saudar o "voltou"
let pendingBye = new Map();  // user -> timeout da graça: sumiu agora, ainda não é "saiu"
const BYE_GRACE_MS = 45000;  // tela apagada / elevador / xixi não viram toast de "saiu"
let sessionMates = new Set(); // nomes que apareceram na mesa (p/ "com quem você mais bebeu")
let pendingBarMenu = false;  // ao abrir "mesa do bar", carrega o cardápio salvo
let lastRetro = null;        // dados da última retrospectiva (p/ compartilhar)
let shakeHandler = null, shakeLast = 0; // mãos livres (chacoalhar pra +1)

// Álcool INDIVIDUAL (trava do motorista + rodada). Recipientes da mesa (share) ficam de fora
// de propósito: motorista PODE marcar "chegou mais uma garrafa" — ele não bebe.
const ALCOHOL = new Set(['chopp', 'lata', 'longneck', 'copo', 'dose', 'drink']);
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
// A mesa nasce VAZIA: item do catálogo só entra quando alguém o adiciona (evento ITEM).
// Item também conta como "da mesa" se tem contagem > 0 — mesas antigas (criadas quando o
// cardápio vinha pronto) e rodadas de itens que o receptor ainda não tinha seguem inteiras.
function allItems() {
  const seenIds = new Set();
  const out = [];
  for (const d of DEFAULT_ITEMS) {
    seenIds.add(d.id);
    const o = state.items.get(d.id);
    if (!o && itemTotal(state, d.id) <= 0) continue; // catálogo é SUGESTÃO, não cardápio
    out.push(o ? o.def : d);
  }
  const customs = [];
  for (const [id, rec] of state.items) if (!seenIds.has(id)) customs.push(rec.def);
  customs.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return out.concat(customs);
}
// Nome de exibição de um item: a MARCA/apelido da mesa (dado da mesa, LWW) vence tudo
// ("Original", "Coca 2L"); sem marca, item PADRÃO é localizado no aparelho (o evento
// carrega só o id — a dor "na Europa cerveja é chopp") e item PERSONALIZADO fica como
// foi digitado.
function itemLabel(def) {
  if (!def) return '';
  if (def.brand) return def.brand;
  return isDefault(def.id) ? t('item.' + def.id) : (def.name || '');
}

function profOf(user) {
  // bot: identidade vem do elenco fixo (todo aparelho resolve igual; não está no CRDT)
  if (isBot(user)) { const b = botProfile(user); if (b) return b; }
  const p = getProfile(state, user);
  return { name: p.name || (user === self ? getName() : ''), color: p.color || autoColor(user), emoji: p.emoji || autoAvatar(user), driver: p.driver, level: p.level || 0, photo: p.photo || '' };
}

// ---- Log / dedup ----
function ingest(ev) {
  if (!ev || !ev.eventId || seen.has(ev.eventId)) return false;
  seen.add(ev.eventId); log.push(ev); applyEvent(state, ev); scheduleSave();
  return true;
}
function rebuildFrom(events) { log = []; seen = new Set(); state = emptyState(); for (const ev of events) ingest(ev); lastTableMilestone = Math.floor(tableTotal(state, resolveItem) / 10); const hh0 = happyHour(state); hhEndedFor = hh0 && hh0.until <= Date.now() ? hh0.until : 0; }
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (room) store.saveEvents(room, log); }, 400); }

// evento local: registra + propaga
function emitLocal(ev) {
  if (!ingest(ev)) return false;
  if (mesh) mesh.broadcast({ k: 'ev', ev });
  return true;
}

// ---- Acoes de consumo ----
function act(type, item) {
  if (type === 'REMOVE' && getCount(state, self, item) <= 0) { ui.toast(t('toast.nothingHere')); return; }
  const ev = type === 'ADD' ? makeAdd(item) : makeRemove(item);
  if (!emitLocal(ev)) return;
  lastAction = { type, item };
  afterChange(item, type === 'REMOVE' ? 'remove' : 'add');
  if (type === 'ADD') { sound.plus(); ui.vibrate(15); afterMyAdd(item); showUndo(item, '+1'); }
  else { sound.minus(); ui.vibrate([25, 40, 25]); showUndo(item, '−1'); }
}
function showUndo(item, label) {
  const it = resolveItem(item);
  ui.actionToast(`${it.emoji} ${label} · ${itemLabel(it)}`, t('common.undo'), undoLast);
}
function undoLast() {
  if (!lastAction) return;
  const inv = lastAction.type === 'ADD' ? makeRemove(lastAction.item) : makeAdd(lastAction.item);
  if (emitLocal(inv)) afterChange(lastAction.item, lastAction.type === 'ADD' ? 'remove' : 'add');
  lastAction = null;
}
function afterMyAdd() {
  checkTableMilestone();
}
// Marco da mesa: a cada 10 rodadas, joga confete + aviso. Reajusta se desfizerem.
function checkTableMilestone() {
  const total = tableTotal(state, resolveItem);
  const m = Math.floor(total / 10);
  if (total > 0 && m > lastTableMilestone) {
    lastTableMilestone = m;
    ui.celebrate();
    ui.toast(t('toast.milestone', { n: total }));
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
    const rounds = Math.max(0, tableTotal(state, resolveItem) - hh.startTotal);
    ui.setHappyHour(t(rounds === 1 ? 'hh.banner1' : 'hh.bannerN', { time: `${mm}:${String(ss).padStart(2, '0')}`, n: rounds }));
  } else {
    ui.setHappyHour(null);
    if (hh && hh.until && hhEndedFor !== hh.until) {
      hhEndedFor = hh.until;
      const rounds = Math.max(0, tableTotal(state, resolveItem) - hh.startTotal);
      if (rounds > 0) { ui.celebrate(['🍺', '🏆', '🎉', '🥂']); ui.toast(t(rounds === 1 ? 'hh.closed1' : 'hh.closedN', { n: rounds })); }
    }
  }
}

function addCustomItem({ emoji, name, price, cat, note, share }) {
  const id = itemIdFromName(name);
  const def = { id, emoji, name, price: price || 0, cat: cat || 'outros', note: (note || '').slice(0, 40) };
  if (share) def.share = 1; // "da mesa": dinheiro rateado, não entra no corpo de ninguém
  if (emitLocal(makeItem(def))) { render(); ui.toast(t('toast.itemAdded', { emoji: emoji, name: name })); }
}

// ---- Rodada coletiva (do item que você escolher; garrafa da mesa não precisa: o card dela
// JÁ é coletivo). Motorista só fica de fora se o item for alcoólico — rodada de refri/água
// inclui todo mundo. ----
function roundChoices() {
  return allItems()
    .filter((it) => !isShare(it) && !isCup(it) && !it.off && ['cerveja', 'destilado', 'sem-alcool'].includes(catOf(it)))
    .map((it) => ({ id: it.id, emoji: it.emoji, name: itemLabel(it) }));
}
function rodada(item) {
  const def = resolveItem(item);
  if (!def || isShare(def) || isCup(def)) return; // rodada é de ITEM de verdade — não da dose pessoal (copo)
  const alcoholic = ALCOHOL.has(item) || (def.g || 0) > 0;
  const targets = [{ user: self, name: getName() }];
  if (mesh) for (const p of mesh.peers()) if (p.online) targets.push({ user: p.user, name: profOf(p.user).name });
  let n = 0;
  for (const t of targets) {
    if (alcoholic && isDriver(state, t.user)) continue;
    if (emitLocal(makeAdd(item, t.user, t.name))) n++;
  }
  settings = setSettings({ roundItem: item }); // lembra a escolha pra próxima
  if (mesh) mesh.sendFx({ kind: 'react', emoji: def.emoji || '🍻' });
  ui.floatReaction(def.emoji || '🍻'); ui.floatReaction('🍻'); sound.cheers();
  ui.celebrate([def.emoji || '🍻', '🎉', '🥂']);
  afterChange(item, 'add');
  lastTableMilestone = Math.floor(tableTotal(state, resolveItem) / 10); // sincroniza o marco (evita confete duplo)
  ui.toast(n ? t('toast.roundN', { n: n }) : t('toast.round0'));
}

// ---- 💸 Pagar uma rodada (perdeu o jogo ou resolveu bancar): item DA MESA com dono ----
// A garrafa segue contando pra mesa (card/herói); só o DINHEIRO muda de bolso — a unidade
// sai do racha (sharePool) e cai inteira na conta de quem pagou (`payer` no evento ADD).
let lastPaid = null; // último pagamento (p/ desfazer)
function payChoices() {
  return allItems().filter((it) => isShare(it) && !it.off)
    .map((it) => ({ id: it.id, emoji: it.emoji, name: itemLabel(it), price: it.price || 0 }));
}
function openPayRound() {
  const items = payChoices();
  if (!items.length) { ui.toast(t('pay.noShare')); return; }
  ui.openPayRound({ items });
}
function payRoundGo(itemId) {
  const def = resolveItem(itemId);
  if (!def || !isShare(def)) return;
  const ev = makeAdd(itemId, self, getName(), self);
  if (!emitLocal(ev)) return;
  lastPaid = ev;
  if (mesh) mesh.sendFx({ kind: 'react', emoji: '💸' });
  ui.floatReaction('💸'); sound.cheers(); ui.celebrate([def.emoji || '🍻', '💸', '🎉']);
  afterChange(itemId, 'add');
  ui.actionToast(t('pay.done', { item: itemLabel(def) }), t('common.undo'), () => {
    if (!lastPaid) return;
    if (emitLocal(makeRemove(lastPaid.item, lastPaid.user, lastPaid.name, self))) { lastPaid = null; scheduleRender(); }
  }, 7000);
}
// Perdeu o jogo NO MEU aparelho: oferece pagar a rodada (abre o escolhedor do item da mesa).
// É OFERTA, não automação — quem perdeu decide; sem item da mesa no cardápio, a zoeira basta.
function offerLoserPay() {
  if (!payChoices().length) return;
  ui.actionToast(t('pay.lostQ'), t('pay.lostGo'), () => openPayRound(), 12000);
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
  if (fx.mid && (fx.kind === 'domino' || fx.kind === 'purrinha' || fx.kind === 'truco')) {
    if (seenFx.has(fx.mid)) return;
    seenFx.add(fx.mid);
    if (mesh) mesh.broadcast({ k: 'fx', fx }, fromId);
  }
  if (fx.kind === 'brinde') ui.brinde();
  else if (fx.kind === 'react') ui.floatReaction(fx.emoji || '🍻');
  else if (fx.kind === 'poke') { if (fx.to === self) receivePoke(fx); }
  else if (fx.kind === 'challenge') { if (fx.to === self) receiveChallenge(fx); }
  else if (fx.kind === 'ceremony') { if (Array.isArray(fx.awards)) ui.openCeremony({ awards: fx.awards }); }
  else if (fx.kind === 'waiter') receiveWaiter(fx);
  else if (fx.kind === 'purrinha') routePurrFx(fx);
  else if (fx.kind === 'truco') routeTrucoFx(fx);
  else if (fx.kind === 'domino') {
    if (fx.ph === 'deal') { if (!dom || dom.gameId !== fx.gameId) beginDomino(fx); }
    else if (fx.ph === 'play') onDomPlay(fx);
    else if (fx.ph === 'pass') onDomPass(fx);
    else if (fx.ph === 'skip') onDomSkip(fx);       // vez pulada de quem caiu (convergente)
    else if (fx.ph === 'reveal') onDomReveal(fx);
    else if (fx.ph === 'noshow') onDomNoshow(fx);   // tranca sem a mão de quem caiu
    else if (fx.ph === 'cancel') {
      const bye = fx.from ? t('dom.endedBy', { name: domName(fx.from) }) : t('dom.cancelled');
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
    DeviceMotionEvent.requestPermission().then((r) => { if (r === 'granted') attach(); else ui.toast(t('toast.motion')); }).catch(() => {});
  } else attach();
}
function disableShake() { if (shakeHandler) { window.removeEventListener('devicemotion', shakeHandler); shakeHandler = null; } }
function receiveWaiter(fx) {
  ui.toast(t('toast.waiterFrom', { name: fx.fromName || t('common.someone') }));
  sound.alarm(); ui.vibrate([80, 40, 80]); ui.floatReaction('🔔');
}
function receivePoke(fx) {
  ui.toast(t('toast.poked', { name: fx.fromName || t('common.someone') }));
  sound.poke(); ui.vibrate([30, 40, 30]); ui.floatReaction('👉');
}
function receiveChallenge(fx) {
  const it = resolveItem(fx.item || 'dose');
  sound.challenge(); ui.vibrate([60, 40, 60, 40, 60]);
  ui.actionToast(t('toast.challenged', { name: fx.fromName || t('common.someone'), emoji: it.emoji, item: it.name }), t('toast.challengeAccept'), () => act('ADD', fx.item || 'dose'), 7000);
}

// ---- Eventos remotos ----
function onRemoteEvent(ev, fromPeer, isSync) {
  if (!ingest(ev)) return;
  if (mesh) mesh.broadcast({ k: 'ev', ev }, fromPeer); // gossip
  if (ev.type === 'HAPPYHOUR' && Number(ev.until) <= Date.now()) hhEndedFor = Number(ev.until); // happy hour já vencido (veio no sync): não comemora
  if (isSync) { if (ev.type === 'ADD') lastTableMilestone = Math.floor(tableTotal(state, resolveItem) / 10); scheduleRender(); return; }
  if (ev.type === 'ADD') checkTableMilestone();
  if (ev.type === 'SONG') ui.renderJukebox(songs(state));
  if (ev.type === 'ADD' && ev.user !== self) {
    const p = profOf(ev.user);
    ui.floatPlus(`${p.name || t('common.someoneLow')} ${resolveItem(ev.item).emoji}+1`, p.color);
    sound.pop();
    const line = milestoneLine(p.name || t('common.someoneLow'), userTotal(state, ev.user), leaderName());
    if (line) ui.toast(line);
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
  // `copo` de mesa antiga nunca vira card (isCup filtra — hoje é só compat de log velho);
  // share mostra o contador DA MESA no número grande (sem contagem pessoal de copo)
  const items = list.filter((it) => !isCup(it) && !it.off).map((it) => ({
    id: it.id, emoji: it.emoji, name: itemLabel(it), cat: catOf(it), note: it.note || '',
    share: isShare(it),
    qty: itemTotal(state, it.id),
    sub: isShare(it) ? '' : t('item.sub', { n: getCount(state, self, it.id) }),
  }));
  const info = tableInfo(state);
  const tt = tableTotal(state, resolveItem);
  ui.renderTable({
    code: room,
    title: info.title || '',
    myTotal: userTotal(state, self, resolveItem),
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
  if (mp.length === 0) ui.setConn(t('conn.alone'));
  else if (online < mp.length) ui.setConn(t('conn.reconnecting', { on: online, total: mp.length }));
  else ui.setConn(null);
  tickHappyHour();
}

function renderPresence() {
  const me = profOf(self);
  const list = [{ user: self, emoji: me.emoji, photo: me.photo, color: me.color, name: getName() || t('common.you'), level: me.level, online: true, self: true }];
  const listed = new Set([self]);
  if (mesh) for (const p of mesh.peers()) { listed.add(p.user); const pr = profOf(p.user); list.push({ user: p.user, emoji: pr.emoji, photo: pr.photo, color: pr.color, name: pr.name || t('common.someoneLow'), level: pr.level, online: p.online }); }
  // quem sumiu há pouco (dentro da graça) segue na barra como 💤, mesmo se a malha já o removeu
  for (const u of pendingBye.keys()) if (!listed.has(u)) { const pr = profOf(u); list.push({ user: u, emoji: pr.emoji, photo: pr.photo, color: pr.color, name: pr.name || t('common.someoneLow'), level: pr.level, online: false }); }
  ui.renderPresence(list);
}

function renderPeers() {
  const base = summary(state, resolveItem); // uma passada só
  const nets = new Map();
  if (mesh) for (const p of mesh.peers()) nets.set(p.user, { online: p.online, conn: p.conn });
  const rows = base.map((r) => {
    const p = profOf(r.user);
    const net = nets.get(r.user);
    return { ...r, name: p.name, color: p.color, emoji: p.emoji, photo: p.photo, level: p.level, badges: badgesFor(state, r.user), online: net ? net.online : undefined, conn: net ? net.conn : null };
  });
  // garante que eu apareço mesmo sem ter consumido
  if (!rows.some((r) => r.user === self)) {
    const p = profOf(self);
    rows.push({ user: self, name: p.name, color: p.color, emoji: p.emoji, photo: p.photo, driver: p.driver, total: 0, money: 0, badges: badgesFor(state, self) });
  }
  const top = base.find((r) => !r.driver && r.total > 0); // MVP derivado (base já vem ordenado)
  ui.renderPeers({ rows, selfId: self, mvp: top ? { name: profOf(top.user).name, total: top.total } : null, myBadges: badgesFor(state, self) });
}

function bebedeiraItem() {
  let best = 'chopp', bestN = -1;
  for (const it of allItems()) { if (isShare(it) || isCup(it) || it.off) continue; const n = getCount(state, self, it.id); if (n > bestN) { bestN = n; best = it.id; } }
  return best;
}

// Linhas da tela "Cardápio da mesa" (marca + preço + esconder). Itens OCULTOS aparecem
// aqui (esmaecidos, pra poder voltar) — é só dos CARDS da mesa que eles somem.
function menuEditorItems() {
  return allItems().filter((it) => !isCup(it)).map((it) => ({
    ...it,
    brand: it.brand || '',
    off: !!it.off,
    // placeholder do campo de marca = o que o item É sem marca (rótulo localizado)
    name: isDefault(it.id) ? t('item.' + it.id) : (it.name || ''),
  }));
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
  if (purr && mesh) for (const p of mesh.peers()) if (p.online) purrSeenAt.set(p.user, Date.now()); // presença fresca p/ a graça da rodada
  purrTryGates(); // dropout não trava a purrinha: portões re-checam quando alguém cai/volta
  armDomSkip();   // idem no dominó: quem caiu na vez tem a vez pulada
  if (dom && !dom.over && dom.phase === 'reveal') domResolveBlock(); // tranca esperando mão de quem caiu
  if (truco && !truco.over) botsTrucoAct(); // idem no truco: bot re-age quando a presença muda (dedup no botDelay)
  updateGamePill();
  // convidado: assim que a conexão sobe, fecha o painel de pareamento offline sozinho
  if (offlineWaiting && mesh && mesh.connectedCount() > 0) {
    offlineWaiting = false;
    ui.closeOverlays();
    ui.toast(t('off.joined'));
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
    const tm = pendingBye.get(u);
    if (tm) { clearTimeout(tm); pendingBye.delete(u); } // voltou dentro da graça: nenhum toast
    else if (!prevOnline.has(u)) {
      if (!everSeen.has(u)) { ui.toast(t('pres.joined', { name: profOf(u).name || t('common.someone') })); sound.pop(); }
      else if (wentAway.has(u)) ui.toast(t('pres.back', { name: profOf(u).name || t('common.someone') }));
    }
    everSeen.add(u); wentAway.delete(u);
  }
  for (const u of prevOnline) {
    if (cur.has(u) || pendingBye.has(u)) continue;
    pendingBye.set(u, setTimeout(() => {
      pendingBye.delete(u);
      const on = mesh && mesh.peers().some((p) => p.user === u && p.online);
      if (!on) { wentAway.add(u); ui.toast(t('pres.bye', { name: profOf(u).name || t('common.someone') })); }
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
  // publica meu perfil (cor/avatar/foto) pra galera
  emitLocal(makeProfile({ color: settings.profColor || autoColor(self), emoji: settings.profEmoji || autoAvatar(self), driver: myDriver, level: myLevel(), photo: settings.profPhoto || '' }));
}

function restartMesh() {
  if (mesh) { mesh.close(); mesh = null; }
  loadIce().then((ice) => { if (room) startMesh(ice); });
}

async function loadIce() {
  const fallback = [{ urls: 'stun:stun.l.google.com:19302' }];
  try {
    const r = await fetch('turn', { cache: 'no-store' });
    if (r.status !== 200) return fallback;
    const d = await r.json();
    return Array.isArray(d.iceServers) && d.iceServers.length ? d.iceServers : fallback;
  } catch { return fallback; }
}

function myItems() {
  const m = {};
  for (const it of allItems()) { if (isShare(it)) continue; const n = getCount(state, self, it.id); if (n > 0) m[it.id] = n; }
  return m;
}
function leaveTable() {
  if (room) {
    store.saveEvents(room, log);
    const info = tableInfo(state);
    store.pushHistory({
      room, at: Date.now(),
      myTotal: userTotal(state, self, resolveItem), tableTotal: tableTotal(state, resolveItem),
      myMoney: userMoney(state, self, resolveItem),
      title: info.title || '',
      items: myItems(),
      mates: [...sessionMates],
      durationMs: sessionStart ? Date.now() - sessionStart : 0,
    });
  }
  if (mesh) { mesh.close(); mesh = null; }
  store.clearCurrent();
  room = null; roomPin = ''; myDriver = false; offlineWaiting = false;
  lastTableMilestone = 0; hhEndedFor = 0; sessionStart = 0; lastAwards = [];
  prevOnline = new Set(); presenceSeeded = false; sessionMates = new Set();
  for (const t of pendingBye.values()) clearTimeout(t);
  pendingBye = new Map(); everSeen = new Set(); wentAway = new Set();
  purr = null; dom = null; dv = null; seenFx.clear(); purrPreFx = [];
  cancelTruco(false); trucoPreFx = [];
  domClearTimers(); gameMinned.clear(); ui.setGameMin('dom', false); ui.setGameMin('purr', false); ui.setGamePill(null);
  ui.setHappyHour(null);
  location.hash = '';
  ui.closeOverlays(); ui.showScreen('home'); ui.renderHome(store.getHistory());
}

// ---- Convite ----
function inviteUrl() { return location.origin + location.pathname + '#/join?room=' + room + (roomPin ? '&pin=1' : ''); }
function openInvite() {
  let qrNode; try { qrNode = makeQR(inviteUrl()); } catch { qrNode = document.createTextNode('—'); }
  const info = tableInfo(state);
  ui.openInvite({ code: room, qrNode, title: info.title, emoji: info.emoji, pin: roomPin });
}
function setTable(patch) {
  const cur = tableInfo(state);
  emitLocal(makeTable({ title: patch.title !== undefined ? patch.title : cur.title, emoji: patch.emoji !== undefined ? patch.emoji : cur.emoji }));
  render();
}

// ---- Pareamento sem internet (QR/código, serverless) ----
// Anfitrião (já numa mesa): gera o convite (offer com ICE embutido) e espera a resposta.
async function offlineHost() {
  if (!mesh || !room) { ui.toast(t('toast.needTableFirst')); return; }
  ui.openOfflineHost();
  try {
    const blob = await mesh.createManualOffer();
    blob.room = room;
    const code = await encodeBlob(blob);
    let qr = null; try { qr = makeQR(code); } catch { /* código grande demais p/ QR: fica só o texto */ }
    ui.showOfflineOffer(code, qr);
  } catch { ui.toast(t('off.errOffer')); }
}
// Anfitrião: aplica a resposta do convidado -> conexão P2P sobe.
async function offlineConnect(text) {
  const s = (text || '').trim();
  if (!mesh) { ui.toast(t('off.needOffer')); return; }
  if (!s) { ui.toast(t('off.pasteAnswer')); return; }
  let ans; try { ans = await decodeBlob(s); } catch { ui.toast(t('off.badAnswer')); return; }
  try {
    await mesh.acceptManualAnswer(ans);
    ui.closeOverlays(); ui.toast(t('off.connected')); render();
  } catch { ui.toast(t('off.errConnect')); }
}
// Convidado: abre o painel (precisa de apelido).
function offlineJoin() {
  if (!getName()) { ui.toast(t('toast.needName')); return; }
  offlineWaiting = false;
  ui.openOfflineGuest();
}
// Convidado: lê o convite, entra na mesa e devolve a resposta (answer com ICE embutido).
async function offlineGenAnswer(text) {
  const s = (text || '').trim();
  if (!getName()) { ui.toast(t('toast.needName')); return; }
  if (!s) { ui.toast(t('off.pasteOffer')); return; }
  let off; try { off = await decodeBlob(s); } catch { ui.toast(t('off.badOffer')); return; }
  if (!off || off.t !== 'offer') { ui.toast(t('off.notOffer')); return; }
  try {
    if (!mesh) enterTableOffline(off.room || newRoomCode());
    const ansBlob = await mesh.acceptManualOffer(off);
    const code = await encodeBlob(ansBlob);
    let qr = null; try { qr = makeQR(code); } catch { /* só o texto */ }
    ui.showOfflineAnswer(code, qr);
    offlineWaiting = true; // ao conectar, o painel fecha sozinho (ver onMeshChange)
  } catch { ui.toast(t('off.errAnswer')); }
}

// ---- Conta ----
function itemizeFor(user) {
  const out = [];
  // recipientes da mesa (share) não são consumo PESSOAL — ficam fora da comanda individual
  for (const it of allItems()) { if (isShare(it)) continue; const n = getCount(state, user, it.id); if (n > 0) out.push({ emoji: it.emoji, n }); }
  return out;
}
function computeBill() {
  const o = ui.billOptions();               // { tipPct, couvert, equal, shareAll, excluded:[] }
  const rows = summary(state, resolveItem);
  const excluded = new Set(o.excluded || []);
  const included = (u) => !excluded.has(u);
  const tipMult = 1 + (Math.max(0, o.tipPct) || 0) / 100;
  if (o.tipPct !== settings.tipPct) settings = setSettings({ tipPct: o.tipPct }); // lembra a gorjeta escolhida

  // o bolo da mesa (garrafas/litrões/torres não têm dono): divide entre os incluídos
  // que não são motoristas — o toggle "shareAll" chama todo mundo pro rateio
  const pool = sharePool(state, resolveItem);
  const incRows = rows.filter((r) => included(r.user));
  const inPool = pool.total > 0 ? shareSplit(state, incRows.map((r) => r.user), { shareAll: o.shareAll }) : new Set();
  const shareEach = inPool.size ? pool.total / inPool.size : 0;

  // base de consumo por pessoa (rateio igual entre os incluídos, ou por consumo real)
  const base = new Map();
  if (o.equal) {
    const all = rows.reduce((a, r) => a + r.money, 0) + pool.total; // rachar igual = TUDO ÷ N (bolo junto)
    const per = incRows.length ? all / incRows.length : 0;
    for (const r of rows) base.set(r.user, included(r.user) ? per : 0);
  } else {
    for (const r of rows) base.set(r.user, r.money + (inPool.has(r.user) ? shareEach : 0));
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
      user: r.user, name: p.name, color: p.color, emoji: p.emoji, photo: p.photo,
      amount: Math.max(0, final.get(r.user) || 0),
      items: itemizeFor(r.user),
      coveredByName: from ? (profOf(from).name || t('common.someoneLow')) : '',
      iPayThem: paysFor(state, self, r.user),
      included: included(r.user),
      isSelf: r.user === self,
    };
  });
  // resumo do bolo pro overlay: o que a mesa pediu, quanto deu e a fatia de cada um
  const poolVm = pool.total > 0 ? {
    total: pool.total,
    each: o.equal ? (incRows.length ? pool.total / incRows.length : 0) : shareEach,
    heads: o.equal ? incRows.length : inPool.size,
    lines: pool.lines.map((l) => ({ ...l, name: itemLabel(resolveItem(l.id)) })),
    // o toggle só aparece quando muda algo: fora do "rachar igual" e com motorista na roda
    canToggle: !o.equal && incRows.some((r) => isDriver(state, r.user)),
    shareAll: !!o.shareAll,
  } : null;
  return { rows: out, total: out.reduce((a, r) => a + r.amount, 0), equal: o.equal, hasPrices: allItems().some((i) => i.price > 0), pool: poolVm };
}
function renderBill() {
  const b = computeBill(); lastBill = b;
  const note = b.hasPrices ? t('bill.noteCons') : t('bill.notePriceless');
  ui.renderBill({ rows: b.rows, total: b.total, equal: b.equal, note, canPix: !!settings.pixKey, selfId: self, pool: b.pool });
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
  if (gameMinned.has('truco') && !(truco && !truco.over)) { gameMinned.delete('truco'); ui.setGameMin('truco', false); }
  const parts = []; // 1 chip por jogo minimizado (rótulo = voltar; ✕ vermelho = encerrar pra mesa)
  if (gameMinned.has('dom')) {
    const myTurn = dom && !dom.over && dom.order[dom.turnIdx] === self;
    parts.push({ kind: 'dom', urgent: myTurn, label: myTurn ? t('game.pillDomTurn') : t('game.pillDom') });
  }
  if (gameMinned.has('purr')) parts.push({ kind: 'purr', urgent: false, label: t('game.pillPurr') });
  if (gameMinned.has('truco')) { // faltava a pill do truco: minimizar sumia com o jogo (sem volta)
    const myTurn = truco && truco.st && !truco.st.over && truco.st.order[truco.st.turnIdx] === self;
    parts.push({ kind: 'truco', urgent: myTurn, label: myTurn ? t('game.pillTruTurn') : t('game.pillTru') });
  }
  ui.setGamePill(parts);
}

// ---- Atualização automática do app (service worker) ----
// A versão nova instala em segundo plano e APLICA sozinha (toast + reload; o hash re-entra na
// mesa). Se tiver jogo rolando ou overlay aberto (alguém digitando), adia — re-checa a cada 5s.
let swPending = null;
function swBusy() {
  if ((dom && !dom.over) || (dv && !dv.began && !dom) || purrActive() || (truco && !truco.over)) return true;
  return !!document.querySelector('.overlay:not([hidden])');
}
function trySwUpdate() {
  if (!swPending || swBusy()) return;
  const w = swPending; swPending = null;
  ui.toast(t('sw.updating'));
  setTimeout(() => { try { w.postMessage('SKIP_WAITING'); } catch { /* já ativou */ } }, 1200);
}

// ---- Tour guiado da primeira mesa (4 paradas; 1× por aparelho) ----
function maybeStartTour() {
  if (store.getFlag('tourSeen')) return;
  const tick = setInterval(() => {
    if (!room) { clearInterval(tick); return; } // saiu antes do tour começar
    if (document.querySelector('.overlay:not([hidden])')) return; // convite/QR ainda aberto
    const hasCards = !!document.querySelector('.item-card');
    const emptyOpen = !!document.querySelector('#menu-empty:not([hidden])');
    if (!hasCards && !emptyOpen) return; // miolo ainda não renderizou
    clearInterval(tick);
    store.setFlag('tourSeen'); // marca ao MOSTRAR (pular também conta como visto)
    ui.startTour([
      // mesa nova nasce LIMPA → a 1ª parada aponta o botão que abre o catálogo; se já
      // tem cards (entrou numa mesa rodando), ensina o toque no card
      hasCards
        ? { sel: '.item-card', title: t('tour.t1'), text: t('tour.x1') }
        : { sel: '#btn-empty-custom', title: t('tour.t0'), text: t('tour.x0') },
      { sel: '.total-hero', title: t('tour.t2'), text: t('tour.x2') },
      { sel: '#btn-games', title: t('tour.t3'), text: t('tour.x3') },
      { sel: '#btn-menu', title: t('tour.t4'), text: t('tour.x4') },
    ], (completed) => {
      // fim do tour: pergunta o tema preferido (quem PULOU quer usar logo — não pergunta;
      // o tema segue à mão nas ⚙️ Configurações)
      if (completed) ui.openThemePick();
    });
  }, 600);
}

// ---- Purrinha (P2P honesta via commit-reveal; efêmera, não entra no log) ----
// Dois modos, escolhidos por quem inicia:
//   'fast'    — variante rápida: 1 rodada, mão+palpite lacrados juntos, quem chuta mais longe paga.
//   'classic' — palitinho de verdade: só a MÃO é secreta (lacre por rodada); o palpite é falado
//               em voz alta na vez de cada um (girando a mesa, SEM repetir número). Quem crava o
//               total se livra e sai; os que sobram jogam de novo; o ÚLTIMO que resta paga.
let purr = null;
let purrSeenAt = new Map();  // purrinha: última vez que vi cada peer online (graça anti-piscada no portão)
const PURR_GRACE_MS = 12000; // piscada de rede (tela apaga, wifi↔4G) não tira ninguém da rodada NA HORA
function purrEntrants() {
  const me = profOf(self);
  const out = [{ id: self, name: getName() || t('common.you'), avatar: me.emoji, photo: me.photo, color: me.color }];
  if (mesh) for (const p of mesh.peers()) if (p.online) { const pr = profOf(p.user); out.push({ id: p.user, name: pr.name || t('common.someoneLow'), avatar: pr.emoji, photo: pr.photo, color: pr.color }); }
  return out;
}
// Presença "grudenta" pro portão da rodada: a malha derruba rec.ready NA HORA numa piscada de rede
// (ICE 'disconnected'/DataChannel close — tela apaga, wifi↔4G), sem carência. Se o portão confiasse
// nisso cru, quem piscou some da rodada, o portão acha que "todos lacraram" e AVANÇA sem o lacre
// dele (os bots palpitam sozinhos; as pontas divergem). Então: online agora → conta e anota; offline
// → só cai da rodada DEPOIS da graça (piscou ≠ saiu). Bot é sempre-online; self idem.
function purrOnline(id) {
  if (id === self || isBot(id)) return true;
  if (!mesh) return false;
  const p = mesh.peers().find((x) => x.user === id);
  if (p && p.online) { purrSeenAt.set(id, Date.now()); return true; }
  const seen = purrSeenAt.get(id);
  return seen != null && Date.now() - seen < PURR_GRACE_MS;
}
// só cobra lacre/reveal de quem ainda está online (dropout não trava o jogo)
function purrExpected() {
  if (!purr) return [];
  const base = purr.mode === 'fast' ? purr.entrants.map((e) => e.id) : purr.alive;
  return base.filter((id) => purrOnline(id));
}
// re-checa os portões quando a graça de um piscante vencer — senão a rodada esperaria pra sempre por
// quem não vai voltar (nenhum fx/mesh dispararia o portão de novo). Assim o dropout não trava.
let purrGraceTimer = null;
function armPurrGrace() {
  if (purrGraceTimer) { clearTimeout(purrGraceTimer); purrGraceTimer = null; }
  if (!purr || purr.phase === 'done' || purr.phase === 'revealed') return;
  const base = purr.mode === 'fast' ? purr.entrants.map((e) => e.id) : purr.alive;
  let wait = 0;
  for (const id of base) {
    if (id === self || isBot(id)) continue;
    const p = mesh && mesh.peers().find((x) => x.user === id);
    if (p && p.online) continue;             // online: sem graça pendente
    const seen = purrSeenAt.get(id);
    if (seen != null) { const left = PURR_GRACE_MS - (Date.now() - seen); if (left > 0) wait = Math.max(wait, left); }
  }
  if (wait > 0) purrGraceTimer = setTimeout(() => { purrGraceTimer = null; if (purr) purrTryGates(); }, wait + 80);
}
function purrName(id) { return profOf(id).name || (purr.entrants.find((e) => e.id === id) || {}).name || t('common.someoneLow'); }

// Roteia toda fx de purrinha. Com gossip, uma fase (ex.: hcommit de um peer rápido) pode chegar
// ANTES do próprio convite — nesse caso guarda e re-aplica quando o jogo abrir (senão o lacre
// se perde pra sempre e o portão da rodada trava esperando ele).
let purrPreFx = [];
function routePurrFx(fx) {
  if (fx.ph === 'invite') { if (!purr || purr.gameId !== fx.gameId) beginPurrinha(fx.gameId, fx.entrants, fx.mode); return; }
  if (fx.ph === 'cancel') {
    if (purr && purr.gameId === fx.gameId && purr.phase !== 'revealed' && purr.phase !== 'done') {
      purr = null; clearGameMin('purr'); ui.closeOverlays();
      ui.toast(fx.from ? t('purr.endedBy', { name: profOf(fx.from).name || t('common.someone') }) : t('purr.cancelled'));
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
  if (!room) { ui.toast(t('toast.needTable')); return; }
  // solo ou com gente: a turma virtual pode completar a mesa (default = 1 bot quando você está só)
  ui.purrinhaStartChoice({ botsDefault: purrEntrants().length < 2 ? 1 : 0 });
}
function startPurrinhaMode(mode, botN = 0) {
  if (!room) return;
  const entrants = purrEntrants();
  for (const id of pickBots(botN)) { const b = botProfile(id); entrants.push({ id, name: b.name, avatar: b.emoji, photo: '', color: b.color }); }
  if (entrants.length < 2) { ui.toast(t('purr.need2')); return; }
  const gameId = randomNonce().slice(0, 8);
  gameFx({ kind: 'purrinha', ph: 'invite', gameId, entrants, mode });
  beginPurrinha(gameId, entrants, mode, true); // eu inicio → eu hospedo os bots
}
function beginPurrinha(gameId, entrants, mode, iHost = false) {
  clearGameMin('purr'); // convite novo abre na cara (jogo anterior minimizado já era)
  clearBotTimers();
  purr = {
    gameId, mode: mode === 'classic' || mode === 'sticks' ? mode : 'fast', entrants, cheats: new Set(),
    mine: null, commits: new Map(), reveals: new Map(), phase: 'pick',
    // por turnos (clássica/3-2-1): assentos fixos (ordem dos entrants), vivos, livres, rodada, starter
    alive: entrants.map((e) => e.id), freed: [], rd: 1, startIdx: 0,
    guesses: new Map(), saidSeq: [], early: [],
    // 3-2-1: estoque público de palitos por pessoa (cravou → descarta; zerou → livre)
    pools: entrants.map((e) => ({ id: e.id, sticks: STICKS_START })),
    // bots: só quem INICIOU hospeda (gera os segredos e emite as jogadas deles)
    iHost: !!iHost && entrants.some((e) => isBot(e.id)), botSecret: new Map(), botRng: makeRng(hashSeed(gameId)),
  };
  renderPurrPick();
  // re-aplica fases que chegaram antes do convite (corrida do gossip)
  const q = purrPreFx.filter((f) => f.gameId === gameId);
  purrPreFx = purrPreFx.filter((f) => f.gameId !== gameId);
  for (const f of q) routePurrFx(f);
  botsPurrAct();
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
    vm.status = t('purr.statusSticks', { n: purr.rd, pools: purrPoolsStr() });
    vm.sub = t('purr.subSticks');
  } else if (purr.rd > 1) vm.status = t('purr.statusRound', { n: purr.rd });
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
  purrTryGates(); // fast: re-checa reveal/resolve + toca os bots
}
function renderPurrWait() {
  if (!purr) return;
  const exp = purrExpected();
  const done = purr.mode !== 'fast' && purr.phase === 'revealing' ? purr.reveals : purr.commits;
  const seals = exp.map((id) => ({ name: purrName(id), avatar: profOf(id).emoji, photo: profOf(id).photo, sealed: done.has(id) }));
  let sub;
  if (purr.mode !== 'fast') {
    if (purr.phase === 'revealing') sub = t('purr.opening');
    else if (!purr.alive.includes(self)) sub = t('purr.freeWatch', { n: purr.rd });
    else sub = t('purr.waitSeals', { n: purr.rd });
  }
  ui.purrinhaSealed({ count: exp.filter((id) => done.has(id)).length, total: exp.length, seals, sub });
}
function onPurrCommit(fx) {
  if (!purr || purr.mode !== 'fast' || fx.gameId !== purr.gameId) return;
  purr.commits.set(fx.from, fx.commit);
  if (purr.phase === 'sealed') renderPurrWait();
  purrTryGates();
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
  if (!good) { purr.cheats.add(fx.from); ui.toast(t('purr.cheat', { name: purrName(fx.from) })); return; }
  purr.reveals.set(fx.from, { hand: fx.hand, guess: fx.guess, nonce: fx.nonce });
  purrTryGates();  // o lacre dele pode ter sido o último que faltava (reveal/resolve + bots)
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
    name: purrName(x.id), avatar: profOf(x.id).emoji, photo: profOf(x.id).photo, hand: x.hand, guess: x.guess,
    isSeer: r.seers.includes(x.id), isLoser: x.id === r.loserId, isSelf: x.id === self,
  })).sort((a, b) => (b.isSeer - a.isSeer) || (a.isLoser - b.isLoser));
  let verdict;
  if (r.loserId === self) verdict = { text: t('purr.youPay'), kind: 'lose' };
  else if (r.seers.includes(self)) verdict = { text: t('purr.seerYou'), kind: 'win' };
  else if (r.loserId) verdict = { text: t('purr.pays', { name: purrName(r.loserId) }), kind: 'other' };
  else verdict = { text: t('purr.allSeers'), kind: 'win' };
  ui.purrinhaResult({ total: r.total, rows, verdict, final: true });
  if (verdict.kind === 'win') { sound.cheers(); ui.celebrate(['🔮', '🫲', '🎉', '🍻']); } else { sound.alarm(); ui.vibrate([80, 40, 80]); }
  if (r.loserId === self) offerLoserPay();
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
  if (!validGuessTo(n, purrCeil(), [...purr.guesses.values()])) { ui.toast(t('purr.numTaken')); return; }
  applyPurrGuess(self, n);
  gameFx({ kind: 'purrinha', ph: 'guess', gameId: purr.gameId, rd: purr.rd, from: self, guess: n });
  sound.pop();
}
function renderPurrGuessing() {
  if (!purr || purr.phase !== 'guessing') return;
  const order = guessOrder(purr.alive, purr.startIdx).filter((id) => purr.commits.has(id) && purrOnline(id));
  const turnId = order.find((id) => !purr.guesses.has(id)) ?? null;
  const livres = purr.freed.length ? t('purr.freeList', { names: purr.freed.map(purrName).join(', ') }) : '';
  const status = purr.mode === 'sticks'
    ? t('purr.statusSticks', { n: purr.rd, pools: purrPoolsStr() }) + livres
    : t('purr.statusTable', { n: purr.rd, names: purr.alive.map(purrName).join(', ') }) + livres;
  ui.purrinhaGuessing({
    status,
    said: purr.saidSeq.map((s) => ({ name: purrName(s.id), avatar: profOf(s.id).emoji, photo: profOf(s.id).photo, guess: s.guess, isSelf: s.id === self })),
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
  if (!good) { purr.cheats.add(fx.from); ui.toast(t('purr.cheat', { name: purrName(fx.from) })); return; }
  // 3-2-1: todo peer confere que ninguém escondeu mais palitos do que TEM (estoque é público)
  if (purr.mode === 'sticks' && clampHand(fx.hand) > purrPool(fx.from)) {
    purr.cheats.add(fx.from); ui.toast(t('purr.cheatSticks', { name: purrName(fx.from) })); return;
  }
  purr.reveals.set(fx.from, { hand: clampHand(fx.hand), nonce: fx.nonce });
  renderPurrWait();
  purrTryGates();
}
// portões do clássico (e re-check do rápido): avançam a fase quando todo mundo esperado cumpriu
function purrTryGates() {
  if (!purr) return;
  if (purr.mode === 'fast') { maybePurrReveal(); maybePurrResolve(); botsPurrAct(); armPurrGrace(); return; }
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
  botsPurrAct(); // clássica/3-2-1: toca o(s) bot(s) na fase corrente
  armPurrGrace(); // se alguém está piscando, re-checa o portão quando a graça vencer
}
function finishClassicRound() {
  const reveals = [...purr.reveals.entries()].map(([id, r]) => ({ id, hand: r.hand }));
  const { total, winnerId } = classicRound(reveals, purr.saidSeq);
  const step = nextRound(purr.alive, purr.startIdx, winnerId);
  const rdNow = purr.rd;
  const rows = reveals.map((x) => ({
    name: purrName(x.id), avatar: profOf(x.id).emoji, photo: profOf(x.id).photo, hand: x.hand,
    guess: purr.guesses.has(x.id) ? purr.guesses.get(x.id) : '—',
    isSeer: x.id === winnerId, isLoser: step.done && x.id === step.loserId, isSelf: x.id === self,
  })).sort((a, b) => (b.isSeer - a.isSeer) || (a.isLoser - b.isLoser));
  if (step.done) {
    purr.phase = 'done';
    if (gameMinned.has('purr')) reopenGame('purr'); // fim de jogo fura o minimizado
    if (winnerId) purr.freed.push(winnerId);
    const loser = step.loserId;
    let verdict;
    if (loser === self) verdict = { text: t('purr.youPay'), kind: 'lose' };
    else if (winnerId === self) verdict = { text: t('purr.youNailedPays', { n: total, name: purrName(loser) }), kind: 'win' };
    else verdict = { text: t('purr.pays', { name: purrName(loser) }), kind: 'other' };
    ui.purrinhaResult({ status: t('purr.statusEnd', { n: rdNow }), total, rows, verdict, final: true });
    if (loser === self) { sound.alarm(); ui.vibrate([80, 40, 80]); offerLoserPay(); } else { sound.cheers(); ui.celebrate(['🫲', '🍀', '🍻']); }
    return;
  }
  if (winnerId) purr.freed.push(winnerId);
  const msg = winnerId
    ? (winnerId === self ? t('purr.youNailed', { n: total }) : t('purr.nailed', { name: purrName(winnerId), n: total }))
    : t('purr.noneNailed', { n: total });
  ui.purrinhaResult({
    status: t('purr.statusRemain', { n: rdNow, names: step.alive.map(purrName).join(', ') }),
    total, rows, verdict: { text: msg, kind: winnerId === self ? 'win' : 'other' }, final: false,
  });
  if (winnerId === self) { sound.cheers(); ui.celebrate(['🍀', '🫲']); } else sound.pop();
  // o estado avança JÁ (determinístico em todo peer); a UI segura o resultado por um instante
  purr.alive = step.alive; purr.startIdx = step.startIdx; purr.rd = rdNow + 1;
  purr.mine = null; purr.commits = new Map(); purr.guesses = new Map(); purr.saidSeq = []; purr.reveals = new Map();
  purr.phase = 'pick';
  purrDrainEarly();
  const gid = purr.gameId, r = purr.rd;
  setTimeout(() => { if (purr && purr.gameId === gid && purr.rd === r && purr.phase === 'pick') { renderPurrPick(); botsPurrAct(); } }, 2600);
}
// 3-2-1: cravou → descarta 1 palito (e fala primeiro na próxima); zerou → livre; último com palitos paga
function finishSticksRound() {
  const reveals = [...purr.reveals.entries()].map(([id, r]) => ({ id, hand: r.hand }));
  const { total, winnerId } = classicRound(reveals, purr.saidSeq);
  const step = sticksNext(purr.pools, purr.startIdx, winnerId);
  const rdNow = purr.rd;
  const rows = reveals.map((x) => ({
    name: purrName(x.id), avatar: profOf(x.id).emoji, photo: profOf(x.id).photo, hand: x.hand,
    guess: purr.guesses.has(x.id) ? purr.guesses.get(x.id) : '—',
    isSeer: x.id === winnerId, isLoser: step.done && x.id === step.loserId, isSelf: x.id === self,
  })).sort((a, b) => (b.isSeer - a.isSeer) || (a.isLoser - b.isLoser));
  if (step.done) {
    purr.pools = step.pools; purr.alive = step.alive; purr.phase = 'done';
    if (gameMinned.has('purr')) reopenGame('purr'); // fim de jogo fura o minimizado
    if (step.freedId) purr.freed.push(step.freedId);
    const loser = step.loserId;
    let verdict;
    if (loser === self) verdict = { text: t('purr.youPay'), kind: 'lose' };
    else if (winnerId === self) verdict = { text: t('purr.youZeroPays', { name: purrName(loser) }), kind: 'win' };
    else verdict = { text: t('purr.pays', { name: purrName(loser) }), kind: 'other' };
    ui.purrinhaResult({ status: t('purr.statusEnd', { n: rdNow }), total, rows, verdict, final: true });
    if (loser === self) { sound.alarm(); ui.vibrate([80, 40, 80]); offerLoserPay(); } else { sound.cheers(); ui.celebrate(['🥢', '🍀', '🍻']); }
    return;
  }
  if (step.freedId) purr.freed.push(step.freedId);
  let msg;
  if (winnerId == null) msg = t('purr.noneNailed', { n: total });
  else if (step.freedId === winnerId) msg = winnerId === self ? t('purr.youZero') : t('purr.zero', { name: purrName(winnerId) });
  else {
    const left = (step.pools.find((p) => p.id === winnerId) || {}).sticks;
    msg = winnerId === self
      ? t('purr.youDiscard', { n: total, left: left })
      : t('purr.discard', { name: purrName(winnerId), n: total, left: left });
  }
  ui.purrinhaResult({
    status: t('purr.statusSticks', { n: rdNow, pools: purrPoolsStr(step.pools) }),
    total, rows, verdict: { text: msg, kind: winnerId === self ? 'win' : 'other' }, final: false,
  });
  if (winnerId === self) { sound.cheers(); ui.celebrate(['🥢', '🎯']); } else sound.pop();
  purr.pools = step.pools; purr.alive = step.alive; purr.startIdx = step.startIdx; purr.rd = rdNow + 1;
  purr.mine = null; purr.commits = new Map(); purr.guesses = new Map(); purr.saidSeq = []; purr.reveals = new Map();
  purr.phase = 'pick';
  purrDrainEarly();
  const gid = purr.gameId, r = purr.rd;
  setTimeout(() => { if (purr && purr.gameId === gid && purr.rd === r && purr.phase === 'pick') { renderPurrPick(); botsPurrAct(); } }, 2600);
}
function cancelPurrinha(broadcast) {
  if (!purr) return;
  if (broadcast && purr.phase !== 'revealed' && purr.phase !== 'done') gameFx({ kind: 'purrinha', ph: 'cancel', gameId: purr.gameId, from: self });
  purr = null; clearBotTimers();
}

// ---- Bots: infraestrutura comum (o iniciador hospeda; agenda com delay humano) ----
// Semente estável por jogo (mesmo elenco de aleatoriedade toda vez que o jogo re-renderiza).
function hashSeed(str) { let h = 2166136261 >>> 0; for (let i = 0; i < String(str).length; i++) { h ^= String(str).charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const botTimers = new Map(); // chave única (jogo:fase:rodada:bot) -> timeout — evita agendar 2×
function botDelay(key, fn) {
  if (botTimers.has(key)) return;
  const id = setTimeout(() => { botTimers.delete(key); try { fn(); } catch { /* jogo pode ter fechado */ } }, botThinkMs());
  botTimers.set(key, id);
}
function clearBotTimers() { for (const id of botTimers.values()) clearTimeout(id); botTimers.clear(); }

// ---- Bots da purrinha: o host sela/revela/palpita pelos bots, pelo mesmo protocolo fx ----
function botsPurrAct() {
  if (!purr || !purr.iHost) return;
  const bots = purr.entrants.map((e) => e.id).filter(isBot);
  if (!bots.length) return;
  if (purr.mode === 'fast') {
    const exp = purrExpected();
    const allCommitted = exp.length > 0 && exp.every((id) => purr.commits.has(id));
    for (const id of bots) {
      if (purr.phase !== 'revealed' && !purr.commits.has(id)) botDelay(`${purr.gameId}:fseal:${id}`, () => botPurrSealFast(id));
      else if (allCommitted && !purr.reveals.has(id)) botDelay(`${purr.gameId}:frev:${id}`, () => botPurrRevealFast(id));
    }
    return;
  }
  // clássica / 3-2-1
  if (purr.phase === 'pick') {
    for (const id of bots) if (purr.alive.includes(id) && !purr.commits.has(id)) botDelay(`${purr.gameId}:hc:${purr.rd}:${id}`, () => botPurrSealHand(id));
  } else if (purr.phase === 'guessing') {
    const order = guessOrder(purr.alive, purr.startIdx).filter((id) => purr.commits.has(id) && purrOnline(id));
    const turn = order.find((id) => !purr.guesses.has(id));
    if (turn && isBot(turn)) botDelay(`${purr.gameId}:gs:${purr.rd}:${turn}`, () => botPurrGuessTurn(turn));
  } else if (purr.phase === 'revealing') {
    for (const id of bots) if (purr.alive.includes(id) && purr.commits.has(id) && !purr.reveals.has(id)) botDelay(`${purr.gameId}:hr:${purr.rd}:${id}`, () => botPurrHReveal(id));
  }
}
async function botPurrSealFast(id) {
  if (!purr || purr.mode !== 'fast' || purr.commits.has(id)) return;
  const nP = purr.entrants.length, ceil = purrMax(nP);
  const hand = botPurrHand(3, purr.botRng);
  const guess = botPurrGuess({ ownHand: hand, nPlayers: nP, ceil, taken: [], rng: purr.botRng });
  const nonce = randomNonce(); const commit = await makeCommit(hand, guess, nonce);
  if (!purr || purr.commits.has(id)) return;
  purr.botSecret.set(id, { hand, guess, nonce }); purr.commits.set(id, commit);
  gameFx({ kind: 'purrinha', ph: 'commit', gameId: purr.gameId, from: id, commit });
  // só troca pra tela de espera se EU já lacrei; senão o pick fica de pé (não engole minha vez)
  if (purr.phase === 'sealed') renderPurrWait();
  purrTryGates();
}
function botPurrRevealFast(id) {
  if (!purr || purr.mode !== 'fast' || purr.reveals.has(id)) return;
  const s = purr.botSecret.get(id); if (!s) return;
  purr.reveals.set(id, { hand: s.hand, guess: s.guess, nonce: s.nonce });
  gameFx({ kind: 'purrinha', ph: 'reveal', gameId: purr.gameId, from: id, hand: s.hand, guess: s.guess, nonce: s.nonce });
  purrTryGates();
}
async function botPurrSealHand(id) {
  if (!purr || purr.mode === 'fast' || purr.phase !== 'pick' || purr.commits.has(id) || !purr.alive.includes(id)) return;
  const maxHand = purr.mode === 'sticks' ? purrPool(id) : 3;
  const hand = botPurrHand(maxHand, purr.botRng);
  const nonce = randomNonce(); const commit = await makeHandCommit(hand, nonce);
  if (!purr || purr.commits.has(id)) return;
  purr.botSecret.set(id, { hand, nonce }); purr.commits.set(id, commit);
  gameFx({ kind: 'purrinha', ph: 'hcommit', gameId: purr.gameId, rd: purr.rd, from: id, commit });
  // NÃO troca pra tela de espera enquanto EU ainda escolho os palitos (só se já lacrei ou sou plateia)
  if (purr.phase === 'pick' && (purr.mine || !purr.alive.includes(self))) renderPurrWait();
  purrTryGates();
}
function botPurrGuessTurn(id) {
  if (!purr || purr.phase !== 'guessing' || purr.guesses.has(id)) return;
  const s = purr.botSecret.get(id); const own = s ? s.hand : 0;
  const g = botPurrGuess({ ownHand: own, nPlayers: purr.alive.length, ceil: purrCeil(), taken: [...purr.guesses.values()], rng: purr.botRng });
  applyPurrGuess(id, g);
  gameFx({ kind: 'purrinha', ph: 'guess', gameId: purr.gameId, rd: purr.rd, from: id, guess: g });
}
function botPurrHReveal(id) {
  if (!purr || purr.mode === 'fast' || purr.reveals.has(id)) return;
  const s = purr.botSecret.get(id); if (!s) return;
  purr.reveals.set(id, { hand: s.hand, nonce: s.nonce });
  gameFx({ kind: 'purrinha', ph: 'hreveal', gameId: purr.gameId, rd: purr.rd, from: id, hand: s.hand, nonce: s.nonce });
  renderPurrWait(); purrTryGates();
}

// ---- Dominó (P2P; MÃOS privadas via canal direto `sendTo`, JOGADAS públicas e validadas) ----
let dom = null;
function domEntrants() { const out = [self]; if (mesh) for (const p of mesh.peers()) if (p.online) out.push(p.user); return out; }
function domName(id) { return id === self ? (getName() || t('common.you')) : (profOf(id).name || t('common.someoneLow')); }
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
  // tranca: o host abre a mão dos bots (ele as guarda) — a apuração precisa de todas
  if (dom.iHost && dom.botHands) for (const id of Object.keys(dom.botHands)) if (!dom.reveals.has(id)) {
    dom.reveals.set(id, dom.botHands[id].slice());
    gameFx({ kind: 'domino', ph: 'reveal', gameId: dom.gameId, from: id, hand: dom.botHands[id] });
  }
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
function onDomPass(fx) { if (!dom || fx.gameId !== dom.gameId) return; if (fx.from !== self) ui.toast(t('dom.passed', { name: domName(fx.from) })); domApplyPass(fx.from); renderDom(); domCelebrate(); }
function onDomReveal(fx) { if (!dom || fx.gameId !== dom.gameId) return; dom.reveals.set(fx.from, fx.hand || []); if (dom.phase !== 'reveal') domBlocked(); domResolveBlock(); }
function myDomPlay(key, side) {
  if (!dom || dom.over || dom.order[dom.turnIdx] !== self) { ui.toast(t('dom.notYourTurn')); return; }
  const tile = dom.myHand.find((t) => domKey(t) === key);
  if (!tile || !place(dom.chain, dom.ends, tile, side)) { ui.toast(t('dom.badFit')); return; }
  gameFx({ kind: 'domino', ph: 'play', gameId: dom.gameId, from: self, tile, side });
  domApplyPlay(self, tile, side); sound.pop(); renderDom(); domCelebrate();
}
function myDomPass() {
  if (!dom || dom.over || dom.order[dom.turnIdx] !== self) return;
  if (legalMoves(dom.myHand, dom.ends).length) { ui.toast(t('dom.mustPlay')); return; }
  gameFx({ kind: 'domino', ph: 'pass', gameId: dom.gameId, from: self });
  domApplyPass(self); renderDom(); domCelebrate();
}
function domCelebrate() {
  if (!dom || !dom.over) return;
  if (gameMinned.has('dom')) reopenGame('dom'); // fim de jogo fura o minimizado (hora de ver quem paga)
  if (dom.verified) domStartAudit(); // mesa verificada: dispara a auditoria no fim
  if (dom.cheered) return;
  dom.cheered = true;
  if (dom.winner === self) { sound.cheers(); ui.celebrate(['🁫', '🎉', '🍻', '🏆']); }
  else { sound.alarm(); ui.vibrate([80, 40, 80]); if (dom.winner && dom.order.length === 2) offerLoserPay(); } // 2p: perdedor único
}
function renderDom() {
  if (!dom) return;
  const myTurn = !dom.over && dom.order[dom.turnIdx] === self;
  const moves = myTurn ? legalMoves(dom.myHand, dom.ends) : [];
  const sidesByKey = new Map();
  for (const m of moves) { const k = domKey(m.tile); if (!sidesByKey.has(k)) sidesByKey.set(k, []); sidesByKey.get(k).push(m.side); }
  const hand = dom.myHand.map((t) => ({ key: domKey(t), a: t[0], b: t[1], sides: sidesByKey.get(domKey(t)) || [] }));
  const opponents = dom.order.filter((id) => id !== self).map((id) => ({ name: domName(id), avatar: profOf(id).emoji, photo: profOf(id).photo, count: dom.counts[id] || 0, isTurn: !dom.over && dom.order[dom.turnIdx] === id, justPlayed: id === dom.lastBy }));
  // feedback de quem jogou a última peça: índice da peça no tabuleiro (ponta L=0, R=última) + avatar
  const lastPlayIdx = (dom.lastBy && dom.chain.length) ? (dom.lastSide === 'L' ? 0 : dom.chain.length - 1) : -1;
  const lastPlayAvatar = dom.lastBy ? profOf(dom.lastBy).emoji : '';
  const lastPlayPhoto = dom.lastBy ? profOf(dom.lastBy).photo : '';
  const lastPlayName = dom.lastBy ? (dom.lastBy === self ? t('common.youCap') : domName(dom.lastBy)) : '';
  let result = null;
  if (dom.over) { const wn = dom.winner === self ? t('common.youCap') : domName(dom.winner); result = dom.reason === 'batida' ? t('dom.won', { name: wn }) : t('dom.blockedWin', { name: wn }); }
  let verified = null;
  if (dom.verified) {
    if (dom.audit && dom.audit.ok === true) verified = { ok: true, text: t('dom.vOk') };
    else if (dom.audit && dom.audit.ok === false) verified = { ok: false, text: '🚫 ' + dom.audit.reason };
    else if (dom.audit) verified = { ok: null, text: '🔒 ' + dom.audit.reason }; // incompleta (alguém saiu sem abrir)
    else if (dom.over) verified = { ok: null, text: t('dom.vAuditing') };
    // durante o jogo NÃO tem badge fixo: "mesa verificada" é sempre-on (virou redundante) — só o
    // SELO de auditoria do fim (🔒✅/🚫) aparece, que é o que prova que o embaralho foi limpo.
  }
  ui.renderDomino({
    board: dom.chain.map((t) => ({ a: t[0], b: t[1] })), ends: dom.ends, hand, opponents,
    turn: dom.over ? '' : (myTurn ? t('dom.yourTurn') : t('dom.turnOf', { name: domName(dom.order[dom.turnIdx]) })),
    myTurn, canPass: myTurn && moves.length === 0, over: dom.over, iWon: dom.winner === self, result, verified,
    lastPlayIdx, lastPlayAvatar, lastPlayPhoto, lastPlayName,
  });
  armDomAutoPass(myTurn && moves.length === 0 && !dom.over);
  armDomSkip();       // dono da vez sumiu? conta a graça pro pulo automático
  updateGamePill();   // minimizado: o pill reflete "sua vez" na hora
  botsDomAct();       // vez de um bot? o host joga por ele (delay humano)
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
  const ord = (dom && dom.order) || (dv && dv.order) || [];
  for (const id of ord) if (isBot(id)) on.add(id); // bot é sempre "online" (o host joga por ele; nunca pula/vira noshow)
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
  clearBotTimers();
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
      ui.toast(t('dom.skip', { name: domName(holder) }));
      gameFx({ kind: 'domino', ph: 'skip', gameId: gid, for: holder, from: self });
      domApplyPass(holder); renderDom(); domCelebrate();
    }, DOM_SKIP_MS),
  };
}
function onDomSkip(fx) {
  if (!dom || fx.gameId !== dom.gameId || dom.over) return;
  if (dom.order[dom.turnIdx] !== fx.for) return; // a vez já andou — skip atrasado não vale
  ui.toast(fx.for === self ? t('dom.skippedYou') : t('dom.skip', { name: domName(fx.for) }));
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
  if (skipped.length) ui.toast(t('dom.noshow', { names: skipped.join(', ') }));
  domResolveBlock();
}

// ---- Bots do dominó: o host joga a vez do bot pela mão que guarda (jogada pública, validada) ----
function botsDomAct() {
  if (!dom || dom.over || !dom.iHost || !dom.botHands) return;
  const turnId = dom.order[dom.turnIdx];
  if (!isBot(turnId)) return;
  botDelay(`${dom.gameId}:dom:${turnId}:${dom.chain.length}:${dom.passes}`, () => botDomPlay(turnId));
}
function botDomPlay(id) {
  if (!dom || dom.over || dom.order[dom.turnIdx] !== id) return; // a vez já andou
  const hand = dom.botHands[id] || [];
  const moves = legalMoves(hand, dom.ends);
  if (!moves.length) { // sem encaixe → passa
    gameFx({ kind: 'domino', ph: 'pass', gameId: dom.gameId, from: id });
    domApplyPass(id); renderDom(); domCelebrate();
    return;
  }
  const mv = botDominoMove({ moves, hand, rng: dom.botRng });
  const k = domKey(mv.tile); const i = hand.findIndex((tt) => domKey(tt) === k); if (i >= 0) hand.splice(i, 1); // tira da mão do bot
  gameFx({ kind: 'domino', ph: 'play', gameId: dom.gameId, from: id, tile: mv.tile, side: mv.side });
  domApplyPlay(id, mv.tile, mv.side); sound.pop(); renderDom(); domCelebrate();
}

// ---- Dominó: MESA VERIFICADA (commit-to-deck + corte coletivo + auditoria no fim) ----
// Handshake antes do jogo: todos lacram um seed (commit) → revelam → o corte coletivo σ sai dos
// seeds; o dono lacra o baralho antes de ver σ (não mira num baralho favorável) e entrega cada
// mão com um lacre que o dono confere na hora. No fim, o baralho é revelado e todos AUDITAM.
let dv = null;
async function startDominoVerified(botN = 0) {
  if (!room) { ui.toast(t('toast.needTable')); return; }
  let order = domEntrants();
  for (const id of pickBots(botN)) if (order.length < 4) order.push(id); // a turma virtual pega assento
  if (order.length < 2 || order.length > 4) { ui.toast(t('dom.players')); return; }
  const gameId = 'dv' + cryptoSeed();
  const deck = shuffle(FULL_SET, rngFrom(cryptoSeed())); // baralho do dono (secreto até o fim)
  const salt = randomNonce(); const mySeed = randomNonce();
  const dc = await deckCommit(deck, salt); const mySc = await sha256Hex(mySeed);
  dv = { gameId, order, host: true, deck, salt, mySeed, deckCommit: dc, seeds: { [self]: mySeed }, seedCommits: { [self]: mySc }, phase: 'commit', began: false, botSeeds: {} };
  clearGameMin('dom'); clearBotTimers(); // jogo novo abre na cara
  ui.openDomino(); renderVwait();
  gameFx({ kind: 'domino', ph: 'vsetup', gameId, order, deckCommit: dc });
  gameFx({ kind: 'domino', ph: 'vseed', gameId, from: self, sc: mySc });
  // o host lacra o seed de cada bot (fala por eles); solo → o handshake já pode fechar
  for (const id of order) if (isBot(id)) {
    const seed = randomNonce(); dv.botSeeds[id] = seed; dv.seeds[id] = seed; dv.seedCommits[id] = await sha256Hex(seed);
    gameFx({ kind: 'domino', ph: 'vseed', gameId, from: id, sc: dv.seedCommits[id] });
  }
  dvSeedGate();
  armDvWatch();
}
// Portão do handshake: quando todos lacraram o seed, o host revela (o seu + o dos bots) e apura o corte.
function dvSeedGate() {
  if (!dv || !dv.host || dv.phase !== 'commit' || !dv.order.every((id) => dv.seedCommits[id])) return;
  dv.phase = 'reveal';
  gameFx({ kind: 'domino', ph: 'vgo', gameId: dv.gameId });
  gameFx({ kind: 'domino', ph: 'vseedrev', gameId: dv.gameId, from: self, seed: dv.mySeed });
  for (const id of dv.order) if (isBot(id)) gameFx({ kind: 'domino', ph: 'vseedrev', gameId: dv.gameId, from: id, seed: dv.botSeeds[id] });
  dvDealGate();
}
function dvDealGate() {
  if (!dv || !dv.host || dv.phase !== 'reveal' || !dv.order.every((id) => dv.seeds[id])) return;
  dv.phase = 'dealt'; hostDealVerified();
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
      if (still.length >= 2) { ui.toast(t('dom.reshuffle')); startDominoVerified(); }
      else { clearGameMin('dom'); ui.closeOverlays(); ui.toast(t('dom.emptyTable')); }
    } else if (!on.has(dv.order[0])) { // order[0] = quem deu as cartas
      dv = null; clearGameMin('dom'); ui.closeOverlays(); ui.toast(t('dom.hostFell'));
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
  dvSeedGate();
}
function onVgo(fx) {
  if (!dv || dv.gameId !== fx.gameId || dv.host || dv.phase !== 'commit') return;
  dv.phase = 'reveal';
  gameFx({ kind: 'domino', ph: 'vseedrev', gameId: dv.gameId, from: self, seed: dv.mySeed });
}
function onVseedrev(fx) {
  if (!dv || dv.gameId !== fx.gameId) return;
  dv.seeds[fx.from] = fx.seed; renderVwait(); // guarda sempre (converge); valida vs commit na auditoria
  dvDealGate();
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
  const botHands = {}, botSalts = {};
  for (let k = 0; k < dv.order.length; k++) {
    const id = dv.order[k];
    if (id === self) beginDomino({ ...pub, hand: hands[k], verified: true, isHost: true, vinfo: { deckCommit: dv.deckCommit, handCommits, seeds: dv.seeds, seedCommits: dv.seedCommits, mySalt: salts[k], deck: dv.deck, salt: dv.salt } });
    else if (isBot(id)) { botHands[id] = hands[k].map((tt) => tt.slice()); botSalts[id] = salts[k]; } // bot: o host guarda a mão (nunca sai do fio)
    else if (mesh) mesh.sendTo(id, { k: 'fx', fx: { kind: 'domino', ph: 'vhand', gameId: dv.gameId, hand: hands[k], salt: salts[k] } });
  }
  if (dom) { // anexa as mãos dos bots ao jogo (o host as conduz)
    dom.botHands = botHands; dom.botSalts = botSalts;
    dom.botInitial = {}; for (const id in botHands) dom.botInitial[id] = botHands[id].map((tt) => tt.slice());
    dom.botRng = makeRng(hashSeed(dv.gameId)); dom.iHost = true;
    botsDomAct();
  }
}
function onVdeal(fx) { if (!dv || dv.gameId !== fx.gameId || dv.host) return; dv.deal = fx; tryBeginVerified(); }
function onVhand(fx) { if (!dv || dv.gameId !== fx.gameId) return; dv.hand = fx.hand; dv.mySalt = fx.salt; tryBeginVerified(); }
async function tryBeginVerified() {
  if (!dv || dv.began || !dv.deal || !dv.hand) return;
  dv.began = true;
  const d = dv.deal;
  if ((await handCommit(dv.hand, dv.mySalt)) !== d.handCommits[self]) ui.toast(t('dom.handMismatch'));
  beginDomino({ ...d, hand: dv.hand, verified: true, isHost: false, vinfo: { deckCommit: d.deckCommit, handCommits: d.handCommits, seeds: d.seeds, seedCommits: d.seedCommits, mySalt: dv.mySalt } });
}
// No fim: cada um revela a mão INICIAL que recebeu; o dono revela o baralho; todos auditam.
function domStartAudit() {
  if (!dom || !dom.over || !dom.verified || dom.auditStarted) return;
  dom.auditStarted = true;
  dom.opens[self] = { hand: dom.initialHand, salt: dom.vinfo.mySalt };
  gameFx({ kind: 'domino', ph: 'vopenhand', gameId: dom.gameId, from: self, hand: dom.initialHand, salt: dom.vinfo.mySalt });
  // auditoria: o host abre a mão INICIAL de cada bot (com o salt do deal) — todos conferem o lacre
  if (dom.iHost && dom.botInitial) for (const id of Object.keys(dom.botInitial)) if (!dom.opens[id]) {
    dom.opens[id] = { hand: dom.botInitial[id], salt: dom.botSalts[id] };
    gameFx({ kind: 'domino', ph: 'vopenhand', gameId: dom.gameId, from: id, hand: dom.botInitial[id], salt: dom.botSalts[id] });
  }
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
    const who = missOpen.length ? missOpen.map(domName).join(', ') : t('dom.dealer');
    dom.audit = { ok: null, reason: t('dom.vIncomplete', { who: who }) };
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
    if (dv.seedCommits && dv.seedCommits[id] && dv.seedCommits[id] !== seedCommits[id]) return fail(t('dom.vSeedCommitSwap', { name: domName(id) }));
    if (dv.seeds && dv.seeds[id] && dv.seeds[id] !== seeds[id]) return fail(t('dom.vSeedSwap', { name: domName(id) }));
  }
  for (const id of dom.order) { // cada um revelou a mesma mão que lacrou?
    if ((await handCommit(dom.opens[id].hand, dom.opens[id].salt)) !== dom.vinfo.handCommits[id]) return fail(t('dom.vHandDiff', { name: domName(id) }));
  }
  const initialHands = dom.order.map((id) => dom.opens[id].hand);
  dom.audit = await verifyDeal({ deck: dom.revealedDeck, salt: dom.revealedSalt, deckCommit: dom.vinfo.deckCommit, seeds, seedCommits, players: dom.order.length, initialHands });
  renderDom();
  ui.toast(dom.audit.ok ? t('dom.vClean') : `🚫 ${dom.audit.reason}`);
}
function renderVwait() {
  if (!dv || dv.began) return;
  const have = dv.phase === 'commit' ? Object.keys(dv.seedCommits).length : Object.keys(dv.seeds).length;
  ui.dominoSetup(t('dom.vHandshake', { phase: dv.phase === 'commit' ? t('dom.vPhaseCommit') : t('dom.vPhaseReveal'), have: have, total: dv.order.length }));
}


// ---- Truco (P2P; mãos privadas via sendTo, jogadas reveladas com lacre POR CARTA) ----
// Partida = placar corrido (12/24) de várias MÃOS; cada mão tem embaralho próprio do dealer
// da vez, com commit-reveal de seeds (corte coletivo) + lacres por carta do js/truco.js.
// Fases fx (kind:'truco', gossip com dedup): tsetup · thseal/thseed/thgo/thseedrev/tdeal/
// thand(privada) · tplay/traise/tresp/trespclose · tonze · topen(auditoria fim de partida) ·
// tcancel. Reducer determinístico (reduceT) — evento fora de hora morre igual em todo peer.
let truco = null;      // { gameId, variant, order, score, handIdx, st (reducer), deal {...}, ... }
let trucoPreFx = [];   // fx que chegou antes do tsetup (corrida do gossip)
let truRespTimer = null, truNextTimer = null, truCloseWatch = null;

function truName(id) { return id === self ? (getName() || t('common.you')) : (profOf(id).name || t('common.someoneLow')); }
function truTeamOfId(id) { return truco ? teamOf(truco.order.indexOf(id)) : null; }
function truMySeat() { return truco ? truco.order.indexOf(self) : -1; }

function startTruco() {
  if (!room) { ui.toast(t('toast.needTable')); return; }
  const n = domEntrants().length;
  // solo: a turma virtual completa (1 bot = 1v1). Com 4+ humanos, 2v2 sem bots.
  ui.trucoStartChoice({ mode: n >= 4 ? '2v2' : '1v1', botsDefault: n < 2 ? 1 : 0 });
}
function startTrucoVariant(variant, botN = 0) {
  if (!TRU_VARIANTS[variant]) return;
  let order = domEntrants();
  for (const id of pickBots(botN)) if (order.length < 4) order.push(id); // a turma virtual completa a dupla/mesa
  if (order.length >= 4) order = order.slice(0, 4); else order = order.slice(0, 2);
  if (order.length === 3) order = order.slice(0, 2); // 3 (humanos): 1v1 com os dois primeiros
  const gameId = 'tr' + cryptoSeed();
  gameFx({ kind: 'truco', ph: 'tsetup', gameId, variant, order, from: self });
  beginTruco({ gameId, variant, order, iHost: true });
  truHandStart(); // sou o dealer da mão 0 (ou o host que dá as cartas se o dealer for bot)
}
function beginTruco({ gameId, variant, order, iHost = false }) {
  clearGameMin('truco'); clearBotTimers();
  truco = {
    gameId, variant, order, n: order.length,
    score: [0, 0], handIdx: 0, st: null,
    deal: null,        // mão corrente: { dc, seedCommits, seeds, commits, vira, mine, counts, master?, deck?, salt? }
    reveals: {},       // seat -> [{i,card}] cartas já abertas (pra UI)
    opens: {},         // h -> {deck,salt,master} auditoria de fim de partida
    audits: null, over: false, winnerTeam: null,
    // bots: só quem INICIOU hospeda (dá as cartas quando o dealer é bot, joga a vez deles)
    iHost: !!iHost && order.some((id) => isBot(id)), botCards: {}, botRng: makeRng(hashSeed(gameId)),
  };
  renderTruco();
  const q = trucoPreFx.filter((f) => f.gameId === gameId);
  trucoPreFx = trucoPreFx.filter((f) => f.gameId !== gameId);
  for (const f of q) routeTrucoFx(f);
}
function truDealerIdx() { return truco ? truco.handIdx % truco.n : 0; }
function truDealerId() { return truco ? truco.order[truDealerIdx()] : null; }
// "eu dou as cartas desta mão?" — sou o dealer, OU sou o host e o dealer é um bot (falo por ele)
function truActDealer() { const d = truDealerId(); return !!(truco && (d === self || (truco.iHost && isBot(d)))); }
// seats cujo seed EU gero (o meu, se jogo; + os bots, se sou host) — real peer manda o dele
function truMySeats() { const s = new Set(); if (truco.order.includes(self)) s.add(self); if (truco.iHost) for (const id of truco.order) if (isBot(id)) s.add(id); return [...s]; }
async function truCommitMySeeds() {
  for (const id of truMySeats()) {
    if (truco.deal.seedCommits[id]) continue;
    const seed = randomNonce(); const sc = await sha256Hex(seed);
    truco.deal.seeds[id] = seed; truco.deal.seedCommits[id] = sc;
    if (id === self) truco.deal.mySeed = seed; else (truco.deal.botSeeds = truco.deal.botSeeds || {})[id] = seed;
    gameFx({ kind: 'truco', ph: 'thseed', gameId: truco.gameId, h: truco.handIdx, from: id, sc });
  }
}
function truRevealMySeeds() {
  truco.deal.revd = truco.deal.revd || {};
  for (const id of truMySeats()) {
    if (truco.deal.revd[id]) continue;
    const seed = id === self ? truco.deal.mySeed : (truco.deal.botSeeds || {})[id];
    if (seed == null) continue;
    truco.deal.revd[id] = 1;
    gameFx({ kind: 'truco', ph: 'thseedrev', gameId: truco.gameId, h: truco.handIdx, from: id, seed });
  }
}

// -- handshake do embaralho da mão (dealer lacra o baralho ANTES do corte coletivo) --
async function truHandStart() {
  if (!truco || truco.over || !truActDealer()) return;
  const deck = shuffle(truDeckFor(truco.variant), rngFrom(cryptoSeed()));
  const salt = randomNonce(); const master = randomNonce();
  const dc = await sha256Hex(JSON.stringify(deck.map(truStr)) + ':' + salt);
  truco.deal = { dc, deck, salt, master, seedCommits: {}, seeds: {}, phase: 'seed' };
  gameFx({ kind: 'truco', ph: 'thseal', gameId: truco.gameId, h: truco.handIdx, dc });
  await truCommitMySeeds(); // o meu seed + o dos bots (o real peer manda o dele por onThseal)
  truTrySeedReveal();
  renderTruco();
}
async function onThseal(fx) {
  if (!truco || fx.h !== truco.handIdx || truActDealer()) return; // se EU dou as cartas, já montei o deal
  truco.deal = { dc: fx.dc, seedCommits: {}, seeds: {}, phase: 'seed' };
  await truCommitMySeeds();
  renderTruco();
}
function onThseed(fx) {
  if (!truco || !truco.deal || fx.h !== truco.handIdx) return;
  truco.deal.seedCommits[fx.from] = fx.sc;
  truTrySeedReveal();
}
function truTrySeedReveal() {
  if (!truco || !truco.deal || truco.deal.phase !== 'seed' || !truActDealer()) return;
  if (!truco.order.every((id) => truco.deal.seedCommits[id])) return;
  truco.deal.phase = 'rev';
  gameFx({ kind: 'truco', ph: 'thgo', gameId: truco.gameId, h: truco.handIdx });
  truRevealMySeeds();
  truTryDeal();
}
function onThgo(fx) {
  if (!truco || !truco.deal || fx.h !== truco.handIdx || truActDealer() || truco.deal.phase !== 'seed') return;
  truco.deal.phase = 'rev';
  truRevealMySeeds(); // revelo o meu + o dos bots (se sou host); o real peer dealer apura
}
function onThseedrev(fx) {
  if (!truco || !truco.deal || fx.h !== truco.handIdx) return;
  truco.deal.seeds[fx.from] = fx.seed;
  truTryDeal();
}
async function truTryDeal() {
  if (!truco || !truco.deal || truco.deal.phase !== 'rev' || !truActDealer()) return;
  if (!truco.order.every((id) => truco.deal.seeds[id])) return;
  truco.deal.phase = 'dealt';
  const R = await combineSeeds(truco.deal.seeds);
  const cut = cutDeck(truco.deal.deck, R);
  const wantVira = !!TRU_VARIANTS[truco.variant].vira;
  const { commits, hands, vira } = await makeHandDeal(cut, truco.n, truco.deal.master, wantVira);
  truco.deal.cut = cut;
  truco.opens[truco.handIdx] = { deck: truco.deal.deck.map(truStr), salt: truco.deal.salt, master: truco.deal.master };
  const pub = {
    kind: 'truco', ph: 'tdeal', gameId: truco.gameId, h: truco.handIdx,
    commits, vira: vira ? truStr(vira) : null, dc: truco.deal.dc,
    seeds: truco.deal.seeds, seedCommits: truco.deal.seedCommits,
  };
  gameFx(pub);
  const seatCards = truco.order.map((id, k) => hands[k].map((x) => ({ i: x.i, card: truStr(x.card), salt: x.salt })));
  // guarda as mãos dos bots ANTES de aplicar a minha (applyTdeal dispara os bots — eles já
  // precisam ter as cartas na mão nesse instante, senão o primeiro a jogar sai de mãos vazias)
  for (let k = 0; k < truco.n; k++) if (isBot(truco.order[k])) truco.botCards[truco.order[k]] = seatCards[k].map((cc) => ({ ...cc }));
  for (let k = 0; k < truco.n; k++) {
    const id = truco.order[k];
    if (id === self) applyTdeal(pub, seatCards[k]);
    else if (!isBot(id) && mesh) mesh.sendTo(id, { k: 'fx', fx: { kind: 'truco', ph: 'thand', gameId: truco.gameId, h: truco.handIdx, cards: seatCards[k] } });
  }
  if (!truco.order.includes(self)) botsTrucoAct(); // mesa só de bots (raro): ninguém aplicou → toca aqui
}
function onTdeal(fx) {
  if (!truco || fx.h !== truco.handIdx || truActDealer()) return; // quem deu as cartas já aplicou
  applyTdeal(fx, truco.deal && truco.deal.mineRaw);
}
function onThand(fx) {
  if (!truco || fx.h !== truco.handIdx) return;
  if (truco.deal && truco.deal.pub) applyTdeal(truco.deal.pub, fx.cards);
  else { truco.deal = truco.deal || { seedCommits: {}, seeds: {} }; truco.deal.mineRaw = fx.cards; }
}
async function applyTdeal(pub, mineRaw) {
  if (!truco) return;
  truco.deal = { ...(truco.deal || {}), pub, dc: pub.dc, commits: pub.commits, seeds: pub.seeds, seedCommits: pub.seedCommits, phase: 'play' };
  truco.deal.vira = pub.vira || null;
  if (mineRaw) {
    const mine = mineRaw.map((c) => ({ i: c.i, card: typeof c.card === 'string' ? c.card : truStr(c.card), salt: c.salt }));
    truco.deal.mine = mine;
    const okHand = await verifyOwnHand(mine.map((m) => ({ i: m.i, card: truCardObj(m.card), salt: m.salt })), pub.commits);
    if (!okHand) ui.toast(t('tru.handMismatch'));
  } else if (truco.deal.mineRaw) {
    return applyTdeal(pub, truco.deal.mineRaw);
  } else return renderTruco(); // ainda sem a mão privada; thand chega já já
  const special = maoRule(truco.variant, truco.score);
  truco.st = newTrucoHand({
    variant: truco.variant, order: truco.order, dealerIdx: truDealerIdx(),
    vira: truco.deal.vira ? truCardObj(truco.deal.vira) : null, maoSpecial: special.type ? special : null,
  });
  truco.reveals = {};
  truco.maoSpecial = special;
  truco.onzeDecided = special.type !== 'maoDe';
  renderTruco();
  botsTrucoAct();
}
function truCardObj(s) { const [r, su] = String(s).split(':'); return { r, s: su }; }

// ---- Bots do truco: o host joga a vez do bot (carta lacrada), responde apostas e envido ----
function truVira() { return truco.deal && truco.deal.vira ? truCardObj(truco.deal.vira) : null; }
function botTruStrength(id) {
  const cards = (truco.botCards[id] || []).filter((c) => !c.played).map((c) => truCardObj(c.card));
  return botTrucoHandStrength(cards, truco.variant, truVira());
}
function botsTrucoAct() {
  if (!truco || truco.over || !truco.iHost || !truco.st || truco.st.over) return;
  const st = truco.st;
  // 1) mão de onze/dez: se o time da regra tem um bot decidindo, ele decide (joga se a mão presta)
  if (truco.maoSpecial && truco.maoSpecial.type === 'maoDe' && !truco.onzeDecided) {
    const decider = truco.order.find((id) => isBot(id) && truTeamOfId(id) === truco.maoSpecial.team);
    if (decider) botDelay(`${truco.gameId}:onze:${truco.handIdx}:${decider}`, () => botTruOnze(decider));
    return;
  }
  // 2) envido no ar (gaúcha): o time que precisa responder tem bot? ele responde
  //    (envido.resp também é chaveada por ID de jogador, não por time)
  if (st.envido && st.envido.pendBy != null) {
    const respTeam = 1 - st.envido.pendBy;
    // CADA bot do time que ainda não respondeu responde — no 2v2 o motor exige as DUAS respostas
    // (reduceT fecha o fold só com resp.length >= 2). Agendar só o 1º bot travava a mão pra sempre.
    truco.order.forEach((id, i) => {
      if (teamOf(i) === respTeam && isBot(id) && !(st.envido.resp && st.envido.resp[id] != null))
        botDelay(`${truco.gameId}:envr:${truco.handIdx}:${id}:${st.envido.value}`, () => botTruEnvResp(id));
    });
    return;
  }
  // 3) truco no ar: o time que responde tem bot? responde; senão, se o proponente é bot, o host fecha
  if (st.pend) {
    const respTeam = 1 - st.pend.byTeam;
    // pend.resp é chaveada por ID de jogador (não por time) — o time respondeu se ALGUM dos seus jogou
    const teamResponded = (team) => truco.order.some((id, i) => teamOf(i) === team && st.pend.resp && st.pend.resp[id] != null);
    if (!teamResponded(respTeam)) {
      const b = truco.order.find((id) => isBot(id) && truTeamOfId(id) === respTeam);
      if (b) botDelay(`${truco.gameId}:tresp:${truco.handIdx}:${b}:${st.stake}`, () => botTruRespond(b));
      return;
    }
    // resposta veio: se o "fechador" do time proponente é bot, o host fecha (o self-proponente já fecha sozinho)
    const closerSeat = Math.min(...truco.order.map((id, i) => teamOf(i) === st.pend.byTeam ? i : 99).filter((x) => x < 99));
    if (isBot(truco.order[closerSeat])) botDelay(`${truco.gameId}:tclose:${truco.handIdx}:${st.stake}`, () => {
      if (truco && truco.st && truco.st.pend) { gameFx({ kind: 'truco', ph: 'trespclose', gameId: truco.gameId, h: truco.handIdx }); if (feedT({ t: 'respClose' })) afterTrucoStep(); }
    });
    return;
  }
  // 4) vez normal de um bot: joga uma carta (às vezes pede truco antes)
  const turnId = st.order[st.turnIdx];
  if (isBot(turnId)) {
    const vz = st.vazas[st.vazas.length - 1] || [];
    botDelay(`${truco.gameId}:tplay:${truco.handIdx}:${turnId}:${st.vazas.length}:${vz.length}`, () => botTruPlay(turnId));
  }
}
function botTruPlay(id) {
  if (!truco || !truco.st || truco.st.over || truco.st.pend || truco.st.order[truco.st.turnIdx] !== id) return;
  if (truco.st.envido && truco.st.envido.pendBy != null) return; // envido no ar trava a jogada
  const cards = (truco.botCards[id] || []).filter((c) => !c.played);
  if (!cards.length) return;
  // pedir truco? só com mão boa, sem pendência, se a escada permite
  if (!truco.maoSpecial.type && truCanRaise(truco.variant, truco.st.stake, truco.st.lastRaiserTeam, truTeamOfId(id))
      && botTrucoWantRaise({ strength: botTruStrength(id), rng: truco.botRng })) {
    gameFx({ kind: 'truco', ph: 'traise', gameId: truco.gameId, h: truco.handIdx, from: id });
    if (feedT({ t: 'raise', p: id })) afterTrucoStep();
    return; // a resposta vem; o bot joga a carta depois
  }
  const vaza = truco.st.vazas[truco.st.vazas.length - 1] || []; // cru ({p,team,card}) — botTrucoPlay extrai .card
  const choice = botTrucoPlay({ myCards: cards.map((c) => truCardObj(c.card)), vaza, variant: truco.variant, vira: truVira(), rng: truco.botRng });
  const m = cards.find((c) => c.card === truStr(choice)) || cards[0];
  m.played = true;
  const reveal = { i: m.i, card: m.card, salt: m.salt };
  gameFx({ kind: 'truco', ph: 'tplay', gameId: truco.gameId, h: truco.handIdx, from: id, reveal });
  onTplay({ h: truco.handIdx, from: id, reveal });
}
function botTruRespond(id) {
  if (!truco || !truco.st || !truco.st.pend) return;
  let r = botTrucoRespondRaise({ strength: botTruStrength(id), rng: truco.botRng });
  if (r === 'raise' && !truCanRaise(truco.variant, truco.st.stake, truco.st.lastRaiserTeam, truTeamOfId(id))) r = 'accept'; // não dá pra subir → paga
  gameFx({ kind: 'truco', ph: 'tresp', gameId: truco.gameId, h: truco.handIdx, from: id, r });
  onTresp({ h: truco.handIdx, from: id, r });
}
function botTruOnze(id) {
  if (!truco || !truco.maoSpecial || truco.maoSpecial.type !== 'maoDe' || truco.onzeDecided) return;
  const play = botTrucoOnze({ strength: botTruStrength(id), rng: truco.botRng });
  gameFx({ kind: 'truco', ph: 'tonze', gameId: truco.gameId, h: truco.handIdx, from: id, play });
  onTonze({ h: truco.handIdx, from: id, play });
}
function botTruEnvResp(id) {
  if (!truco || !truco.st || !truco.st.envido || truco.st.envido.pendBy == null) return;
  const r = botTrucoRespondRaise({ strength: botTruStrength(id), rng: truco.botRng }) === 'fold' ? 'fold' : 'accept'; // envido: aceita ou corre (bot não re-envida — simples)
  gameFx({ kind: 'truco', ph: 'tenvresp', gameId: truco.gameId, h: truco.handIdx, from: id, r });
  onTenvresp({ h: truco.handIdx, from: id, r });
}

// -- jogo --
function feedT(ev) { if (truco && truco.st) { const nx = reduceT(truco.st, ev); const changed = nx !== truco.st; truco.st = nx; return changed; } return false; }
async function onTplay(fx) {
  if (!truco || !truco.st || fx.h !== truco.handIdx) return;
  const card = truCardObj(fx.reveal.card);
  const okSeal = await verifyPlayReveal({ i: fx.reveal.i, card, salt: fx.reveal.salt }, truco.deal.commits);
  if (!okSeal) { ui.toast(t('tru.badSeal', { name: truName(fx.from) })); return; }
  if (feedT({ t: 'play', p: fx.from, card })) {
    (truco.reveals[fx.from] = truco.reveals[fx.from] || []).push(fx.reveal);
    afterTrucoStep();
  }
}
function onTraise(fx) { if (truco && fx.h === truco.handIdx && feedT({ t: 'raise', p: fx.from })) afterTrucoStep(); }
function onTresp(fx) {
  if (!truco || fx.h !== truco.handIdx) return;
  if (!feedT({ t: 'resp', p: fx.from, r: fx.r })) return;
  // o PROPONENTE fecha a resposta: imediato no 1v1, graça de 1,2s no 2v2 (o parceiro pode gritar mais alto)
  const pend = truco.st.pend;
  if (pend && truTeamOfId(self) === pend.byTeam && truMySeat() === Math.min(...truco.order.map((id, i) => teamOf(i) === pend.byTeam ? i : 99).filter((x) => x < 99))) {
    clearTimeout(truRespTimer);
    const gid = truco.gameId, h = truco.handIdx;
    truRespTimer = setTimeout(() => {
      if (truco && truco.gameId === gid && truco.handIdx === h && truco.st && truco.st.pend) {
        gameFx({ kind: 'truco', ph: 'trespclose', gameId: gid, h });
        if (feedT({ t: 'respClose' })) afterTrucoStep();
      }
    }, truco.n === 2 ? 60 : 1200);
  }
  afterTrucoStep();
}
function onTrespclose(fx) { if (truco && fx.h === truco.handIdx && feedT({ t: 'respClose' })) afterTrucoStep(); }
function onTonze(fx) {
  if (!truco || fx.h !== truco.handIdx || !truco.maoSpecial || truco.maoSpecial.type !== 'maoDe') return;
  if (fx.from && truTeamOfId(fx.from) !== truco.maoSpecial.team) return; // só o time da mão de onze decide
  truco.onzeDecided = true;
  if (!fx.play) {
    const other = 1 - truco.maoSpecial.team;
    truco.st = { ...truco.st, over: true, winnerTeam: other, points: truco.maoSpecial.foldGives, reason: 'correu da mão' };
  }
  afterTrucoStep();
}
function myTruPlay(cardStrArg) {
  if (!truco || !truco.st || truco.st.over || !truco.onzeDecided) return;
  if (truco.st.order[truco.st.turnIdx] !== self || truco.st.pend) return;
  const m = (truco.deal.mine || []).find((x) => x.card === cardStrArg && !x.played);
  if (!m) return;
  m.played = true;
  gameFx({ kind: 'truco', ph: 'tplay', gameId: truco.gameId, h: truco.handIdx, from: self, reveal: { i: m.i, card: m.card, salt: m.salt } });
  onTplay({ h: truco.handIdx, from: self, reveal: { i: m.i, card: m.card, salt: m.salt } });
  sound.pop();
}
function myTruRaise() {
  if (!truco || !truco.st || truco.st.over || truco.st.pend || truco.maoSpecial.type) return;
  if (!truCanRaise(truco.variant, truco.st.stake, truco.st.lastRaiserTeam, truTeamOfId(self))) return;
  gameFx({ kind: 'truco', ph: 'traise', gameId: truco.gameId, h: truco.handIdx, from: self });
  if (feedT({ t: 'raise', p: self })) afterTrucoStep();
  sound.challenge();
}
function myTruResp(r) {
  if (!truco || !truco.st || !truco.st.pend) return;
  gameFx({ kind: 'truco', ph: 'tresp', gameId: truco.gameId, h: truco.handIdx, from: self, r });
  onTresp({ h: truco.handIdx, from: self, r });
}
function myTruOnze(play) {
  if (!truco || !truco.maoSpecial || truco.maoSpecial.type !== 'maoDe' || truco.onzeDecided) return;
  gameFx({ kind: 'truco', ph: 'tonze', gameId: truco.gameId, h: truco.handIdx, from: self, play });
  onTonze({ h: truco.handIdx, from: self, play });
}

// -- fim de mão / partida --
function afterTrucoStep() {
  if (!truco) return;
  if (truco.st && truco.st.flor) truScoreFlor();
  if (truco.st && truco.st.envido && truco.st.envido.winner != null) truScoreEnvido();
  if (truco.st && truco.st.over) {
    const stw = truco.st;
    if (stw.winnerTeam != null && !truco.scored) {
      truco.scored = true;
      const res = applyResult(truco.score, stw.winnerTeam, stw.points, truco.variant);
      truco.score = res.score;
      if (res.winner != null) { truco.over = true; truco.winnerTeam = res.winner; truFinishGame(); }
      else {
        clearTimeout(truNextTimer);
        const gid = truco.gameId, h = truco.handIdx;
        truNextTimer = setTimeout(() => {
          if (!truco || truco.gameId !== gid || truco.handIdx !== h) return;
          truco.handIdx += 1; truco.st = null; truco.deal = null; truco.scored = false; truco.reveals = {};
          renderTruco();
          truHandStart(); // só o novo dealer emite (os outros ficam no aguardo)
        }, 2600);
      }
    }
  }
  renderTruco();
  botsTrucoAct(); // toca os bots na fase corrente (jogar, responder, fechar)
}
async function truFinishGame() {
  if (!truco) return;
  if (gameMinned.has('truco')) reopenGame('truco');
  // auditoria: cada ex-dealer abre baralho+salt+master das mãos que deu
  for (const [h, open] of Object.entries(truco.opens)) {
    gameFx({ kind: 'truco', ph: 'topen', gameId: truco.gameId, h: Number(h), ...open });
  }
  truco.audits = truco.audits || {};
  tryTruAudit();
  if (truco.winnerTeam === truTeamOfId(self)) { sound.cheers(); ui.celebrate(['🃏', '🏆', '🍻']); }
  else { sound.alarm(); ui.vibrate([80, 40, 80]); offerLoserPay(); } // oferta em cada perdedor (1v1 e dupla)
  renderTruco();
}
async function onTopen(fx) {
  if (!truco || !truco.over) { trucoPreFx.push(fx); return; }
  truco.audits = truco.audits || {};
  truco.audits[fx.h] = { deck: fx.deck, salt: fx.salt, master: fx.master };
  tryTruAudit();
}
async function tryTruAudit() {
  if (!truco || !truco.over || truco.auditDone) return;
  // audita as mãos que temos material (a corrente sempre; anteriores conforme topen chega)
  const pend = truco.dealsSeen || {};
  let ok = true; let n = 0;
  for (const [h, mat] of Object.entries({ ...truco.audits, ...truco.opens })) {
    const pub = pend[h];
    if (!pub || !mat) continue;
    const res = await verifyHandAudit({ deckCut: cutDeck(mat.deck.map ? mat.deck.map(truCardObj) : mat.deck, await combineSeeds(pub.seeds)), master: mat.master, commits: pub.commits });
    n++;
    if (!res.ok) ok = false;
    const dcRe = await sha256Hex(JSON.stringify(mat.deck.map ? mat.deck.map((c) => (typeof c === 'string' ? c : truStr(c))) : mat.deck) + ':' + mat.salt);
    if (dcRe !== pub.dc) ok = false;
    // PROVA do envido: quem cantou pontos tem que ter a mão que sustenta o canto
    const decl = (truco.envLog || {})[h];
    if (decl && ok) {
      const cutH = cutDeck((mat.deck.map ? mat.deck : []).map((c) => (typeof c === 'string' ? truCardObj(c) : c)), await combineSeeds(pub.seeds));
      for (const [pid, said] of Object.entries(decl)) {
        const seat = truco.order.indexOf(pid);
        if (seat < 0) continue;
        const dealt = [cutH[seat * 3], cutH[seat * 3 + 1], cutH[seat * 3 + 2]];
        if (envidoPoints(dealt) !== said) { ok = false; ui.toast(t('tru.envLie', { name: truName(pid) })); }
      }
    }
  }
  if (n) { truco.auditDone = true; truco.auditOk = ok; ui.toast(ok ? t('tru.auditOk') : t('tru.auditBad')); renderTruco(); }
}
function cancelTruco(broadcast) {
  if (!truco) return;
  if (broadcast && !truco.over) gameFx({ kind: 'truco', ph: 'tcancel', gameId: truco.gameId, from: self });
  truco = null; clearTimeout(truRespTimer); clearTimeout(truNextTimer); clearTimeout(truCloseWatch); clearBotTimers();
}


// -- Envido / Flor (gaúcha): o reducer manda; aqui é rotear, auto-declarar e pontuar --
function onTenv(fx, kind) { if (truco && fx.h === truco.handIdx && feedT({ t: kind, p: fx.from })) afterTrucoStep(); }
function onTenvresp(fx) {
  if (!truco || fx.h !== truco.handIdx) return;
  if (!feedT({ t: 'envresp', p: fx.from, r: fx.r })) return;
  truAutoDeclare(); afterTrucoStep();
}
function onTenvpoints(fx) {
  if (!truco || fx.h !== truco.handIdx) return;
  if (!feedT({ t: 'envpoints', p: fx.from, points: fx.points })) return;
  (truco.envLog = truco.envLog || {})[fx.h] = { ...(truco.envLog[fx.h] || {}), [fx.from]: fx.points };
  truTrySettleEnvido(); afterTrucoStep();
}
function onTflor(fx) { if (truco && fx.h === truco.handIdx && feedT({ t: 'flor', p: fx.from, points: fx.points })) afterTrucoStep(); }
// aceitou o envido → CADA participante declara os próprios pontos sozinho (sem input humano;
// a auditoria do fim confere a declaração contra a mão real — mentir é pego)
function truAutoDeclare() {
  const st = truco && truco.st;
  if (!st || !st.envido || !st.envido.closed || !st.envido.value || st.envido.winner != null) return;
  if (!truco.deal) return;
  truco.envLog = truco.envLog || {}; truco.envLog[truco.handIdx] = truco.envLog[truco.handIdx] || {};
  const declare = (id, cards) => {
    if (truco.envLog[truco.handIdx][id] != null || !cards) return;
    const pts = envidoPoints(cards.map((m) => truCardObj(m.card)));
    truco.envLog[truco.handIdx][id] = pts;
    gameFx({ kind: 'truco', ph: 'tenvpoints', gameId: truco.gameId, h: truco.handIdx, from: id, points: pts });
    feedT({ t: 'envpoints', p: id, points: pts });
  };
  declare(self, truco.deal.mine); // eu declaro os meus pontos
  if (truco.iHost) for (const id of truco.order) if (isBot(id)) declare(id, truco.botCards[id]); // e os dos bots
  truTrySettleEnvido();
}
function truTrySettleEnvido() {
  const st = truco && truco.st;
  if (!st || !st.envido || st.envido.winner != null) return;
  const need = truco.order.filter((id) => truOnlineHas(id)).length;
  if (Object.keys(st.envido.points).length < Math.min(need, truco.n)) return;
  truco.st = settleEnvido(st);
  truScoreEnvido();
}
function truOnlineHas(id) { if (id === self || isBot(id)) return true; if (!mesh) return false; const p = mesh.peers().find((x) => x.user === id); return !!(p && p.online); }
// pontua envido/flor UMA vez (todo peer chega no mesmo resultado → converge)
function truScoreEnvido() {
  const st = truco && truco.st;
  if (!st || !st.envido || st.envido.winner == null || truco.envScored || !st.envido.value) return;
  truco.envScored = true;
  const res = applyResult(truco.score, st.envido.winner, st.envido.value, truco.variant);
  truco.score = res.score;
  ui.toast(t(st.envido.winner === truTeamOfId(self) ? 'tru.envWon' : 'tru.envLost', { n: st.envido.value }));
  if (res.winner != null) { truco.over = true; truco.winnerTeam = res.winner; truFinishGame(); }
  renderTruco();
}
function truScoreFlor() {
  const st = truco && truco.st;
  if (!st || !st.flor || truco.florScored) return;
  truco.florScored = true;
  const res = applyResult(truco.score, st.flor.team, st.flor.points, truco.variant);
  truco.score = res.score;
  ui.toast(t(st.flor.team === truTeamOfId(self) ? 'tru.florWon' : 'tru.florLost', { n: st.flor.points }));
  if (res.winner != null) { truco.over = true; truco.winnerTeam = res.winner; truFinishGame(); }
  renderTruco();
}
function myTruEnv(kind) {
  const st = truco && truco.st;
  if (!st || !st.envido) return;
  const ph = kind === 'realenvido' ? 'trealenvido' : 'tenvido';
  gameFx({ kind: 'truco', ph, gameId: truco.gameId, h: truco.handIdx, from: self });
  if (feedT({ t: kind, p: self })) afterTrucoStep();
  sound.challenge();
}
function myTruEnvResp(r) {
  const st = truco && truco.st;
  if (!st || !st.envido || st.envido.pendBy == null) return;
  gameFx({ kind: 'truco', ph: 'tenvresp', gameId: truco.gameId, h: truco.handIdx, from: self, r });
  if (feedT({ t: 'envresp', p: self, r })) { truAutoDeclare(); afterTrucoStep(); }
}
function myTruFlor() {
  const st = truco && truco.st;
  if (!st || !st.envido || !truco.deal || !truco.deal.mine) return;
  const cards = truco.deal.mine.map((m) => truCardObj(m.card));
  if (!hasFlor(cards)) return;
  const pts = florPoints(cards);
  gameFx({ kind: 'truco', ph: 'tflor', gameId: truco.gameId, h: truco.handIdx, from: self, points: pts });
  if (feedT({ t: 'flor', p: self, points: pts })) { truScoreFlor(); afterTrucoStep(); }
  sound.cheers();
}

function routeTrucoFx(fx) {
  if (fx.ph === 'tsetup') { if (!truco || truco.gameId !== fx.gameId) { beginTruco({ gameId: fx.gameId, variant: fx.variant, order: fx.order }); } return; }
  if (fx.ph === 'tcancel') {
    if (truco && truco.gameId === fx.gameId && !truco.over) {
      truco = null; clearGameMin('truco'); ui.closeOverlays();
      ui.toast(fx.from ? t('tru.endedBy', { name: truName(fx.from) }) : t('tru.cancelled'));
    }
    return;
  }
  if (!truco || truco.gameId !== fx.gameId) { trucoPreFx.push(fx); if (trucoPreFx.length > 80) trucoPreFx.shift(); return; }
  if (fx.ph === 'tdeal') truco.dealsSeen = { ...(truco.dealsSeen || {}), [fx.h]: fx };
  if (fx.ph === 'thseal') onThseal(fx);
  else if (fx.ph === 'thseed') onThseed(fx);
  else if (fx.ph === 'thgo') onThgo(fx);
  else if (fx.ph === 'thseedrev') onThseedrev(fx);
  else if (fx.ph === 'tdeal') onTdeal(fx);
  else if (fx.ph === 'thand') onThand(fx);
  else if (fx.ph === 'tplay') onTplay(fx);
  else if (fx.ph === 'traise') onTraise(fx);
  else if (fx.ph === 'tresp') onTresp(fx);
  else if (fx.ph === 'trespclose') onTrespclose(fx);
  else if (fx.ph === 'tonze') onTonze(fx);
  else if (fx.ph === 'tenvido') onTenv(fx, 'envido');
  else if (fx.ph === 'trealenvido') onTenv(fx, 'realenvido');
  else if (fx.ph === 'tenvresp') onTenvresp(fx);
  else if (fx.ph === 'tenvpoints') onTenvpoints(fx);
  else if (fx.ph === 'tflor') onTflor(fx);
  else if (fx.ph === 'topen') onTopen(fx);
}

// -- ponte pra UI --
function renderTruco() {
  if (!truco) return;
  const st = truco.st;
  const v = TRU_VARIANTS[truco.variant];
  const myTeam = truTeamOfId(self);
  const vm = {
    variant: truco.variant, score: truco.score, myTeam, target: v.target,
    handshake: !st ? t('tru.shuffling', { name: truName(truco.order[truDealerIdx()]) }) : null,
    stake: st ? st.stake : v.start, vira: truco.deal && truco.deal.vira,
    over: truco.over, gameOver: truco.over,
    audit: truco.auditDone ? (truco.auditOk ? 'ok' : 'bad') : null,
  };
  if (st) {
    const seatTurn = st.order[st.turnIdx];
    vm.handOver = st.over;
    vm.turnName = st.over ? '' : (seatTurn === self ? t('tru.yourTurn') : t('tru.turnOf', { name: truName(seatTurn) }));
    vm.myTurn = !st.over && seatTurn === self && !st.pend && truco.onzeDecided;
    vm.table = st.vazas.flatMap((vz, vi) => vz.map((pl) => ({ card: pl.card, name: truName(pl.p), avatar: profOf(pl.p).emoji, photo: profOf(pl.p).photo, vaza: vi, self: pl.p === self })));
    vm.results = st.results;
    vm.mine = (truco.deal.mine || []).filter((m) => !m.played).map((m) => ({ card: m.card }));
    vm.pend = st.pend ? {
      label: raiseLabel(truco.variant, st.pend.value), value: st.pend.value,
      mine: st.pend.byTeam === myTeam,
      canRaiseBack: truNext(truco.variant, st.pend.value) != null,
    } : null;
    vm.canRaise = !st.over && !st.pend && !truco.maoSpecial.type && truCanRaise(truco.variant, st.stake, st.lastRaiserTeam, myTeam) && truco.onzeDecided;
    vm.raiseLabel = raiseLabel(truco.variant, truNext(truco.variant, st.stake) || st.stake);
    if (st.envido && truco.variant === 'gaucha') {
      const env = st.envido;
      const full = (truco.deal && truco.deal.mine) ? truco.deal.mine.map((m) => truCardObj(m.card)) : [];
      vm.envido = {
        canCall: env.open && !env.closed && env.pendBy == null && !st.pend && !st.flor,
        canReal: env.pendBy != null && truTeamOfId(self) !== env.pendBy && env.chain.join('+') === 'E',
        pend: env.pendBy != null ? { mine: truTeamOfId(self) === env.pendBy, chain: env.chain.join(' + ') } : null,
        value: env.value, winner: env.winner,
        myPts: full.length === 3 ? envidoPoints(full) : null,
        canFlor: env.open && !st.flor && full.length === 3 && hasFlor(full),
        closed: env.closed,
      };
    }
    vm.onze = truco.maoSpecial.type === 'maoDe' && !truco.onzeDecided
      ? { mine: truco.maoSpecial.team === myTeam, value: truco.maoSpecial.value } : null;
    if (st.over) {
      vm.handResult = st.winnerTeam == null ? t('tru.handDraw')
        : t(st.winnerTeam === myTeam ? 'tru.handWon' : 'tru.handLost', { n: st.points });
    }
  }
  if (truco.over) vm.gameResult = t(truco.winnerTeam === myTeam ? 'tru.gameWon' : 'tru.gameLost');
  ui.renderTruco(vm);
  updateGamePill();
}

// ---- Cutucar / desafiar ----
function openPokeFor(user) {
  const items = ['dose', 'chopp', 'drink'].map((id) => { const d = resolveItem(id); return { id, emoji: d.emoji, name: itemLabel(d) }; });
  ui.openPoke({ user, name: profOf(user).name || t('common.someoneLow'), items });
}
function sendPoke(user, kind, item) {
  if (!mesh) { ui.toast(t('toast.aloneTable')); return; }
  const fromName = getName() || t('common.someoneLow');
  if (kind === 'challenge') { mesh.sendFx({ kind: 'challenge', to: user, from: self, fromName, item: item || 'dose' }); sound.challenge(); ui.toast(t('toast.challengeSent')); }
  else { mesh.sendFx({ kind: 'poke', to: user, from: self, fromName }); sound.poke(); ui.toast(t('toast.pokeSent')); }
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
  for (const it of allItems()) { const n = getCount(state, user, it.id); if (n > 0) rows.push({ emoji: it.emoji, name: it.name, n, money: (it.price || 0) * n, note: it.note || '' }); }
  // unidades que a pessoa PAGOU (perdeu o jogo / bancou): a garrafa "dela" aparece na comanda
  for (const it of allItems()) { const n = paidCount(state, user, it.id); if (n > 0) rows.push({ emoji: '💸', name: t('comanda.paid', { item: itemLabel(it) }), n, money: (it.price || 0) * n, note: '' }); }
  ui.openComanda({ user, name: p.name, emoji: p.emoji, rows, total: userTotal(state, user), money: userMoney(state, user, resolveItem) });
}

function myLevel() { return levelFor(lifeStats(store.getHistory(), { now: Date.now() })).level; }

// ---- Retrospectiva "Seu rolê" ----
function openRetro() {
  const r = retro(store.getHistory(), { now: Date.now() });
  const favDef = r.favDrink ? resolveItem(r.favDrink) : null;
  lastRetro = { ...r, favEmoji: favDef ? favDef.emoji : '', favName: favDef ? favDef.name : '' };
  const slides = [
    { emoji: '🍺', big: r.totalDrinks, sub: t('retro.drinks') },
    { emoji: '📅', big: r.nights, sub: t('retro.nights') },
    { emoji: '🔥', big: r.streakWeeks, sub: t('retro.weeks') },
  ];
  if (r.record) slides.push({ emoji: '👑', big: r.record.total, sub: t('retro.record') });
  if (favDef) slides.push({ emoji: favDef.emoji, big: favDef.name, sub: t('retro.fav') });
  if (r.topMate) slides.push({ emoji: '🤝', big: r.topMate.name, sub: t('retro.mate') });
  if (r.totalSpent > 0) slides.push({ emoji: '💸', big: 'R$ ' + r.totalSpent.toFixed(2), sub: t('retro.spent') });
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
  if (n) { render(); ui.toast(t('bar.menuLoaded', { n: n })); }
}

// ---- Handlers ----
const handlers = {
  onName: (v) => setName(v),
  onCreate: () => { if (!getName()) { ui.toast(t('toast.needName')); return; } enterTable(newRoomCode(), { create: true }); },
  onJoinCode: (code) => {
    code = (code || '').trim().toUpperCase();
    if (!code) { ui.toast(t('toast.needCode')); return; }
    pendingJoin = code; pendingPin = false;
    if (getName()) enterTable(code); else ui.openJoin(code, false);
  },
  onJoinConfirm: (name, pin) => {
    const n = setName(name);
    if (!n) { ui.toast(t('toast.needNick')); return; }
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
  onRodada: () => {
    const choices = roundChoices();
    if (!choices.length) { ui.toast(t('round.empty')); return; } // mesa sem bebida individual ainda
    ui.openRound(choices, settings.roundItem || 'chopp');
  },
  onRoundPick: (id) => rodada(id),
  onPayRound: () => openPayRound(),
  onPayPick: (id) => payRoundGo(id),
  onBrindeGo: () => sound.cheers(),
  onProfile: () => { const p = profOf(self); ui.openProfile({ name: getName(), color: p.color, emoji: p.emoji, driver: myDriver, photo: settings.profPhoto || p.photo || '' }); },
  onProfileSave: ({ name, color, emoji, driver, photo }) => {
    if (name) { setName(name); ui.setNameInput(getName()); }
    settings = setSettings({ profColor: color, profEmoji: emoji, profPhoto: photo || '' });
    myDriver = !!driver;
    emitLocal(makeProfile({ color, emoji, driver, photo, level: myLevel() })); render(); ui.toast(t('toast.profileSaved'));
  },
  onTableName: (name) => setTable({ title: name }),
  onTableEmoji: (emoji) => setTable({ emoji }),
  onInvitePin: (pin) => {
    pin = (pin || '').trim();
    if (mesh && mesh.connectedCount() > 0) { ui.toast(t('toast.pinBefore')); return; }
    roomPin = pin; restartMesh(); openInvite();
    ui.toast(pin ? t('toast.pinOn') : t('toast.pinOff'));
  },
  onBill: () => { ui.openBill({ tipPct: settings.tipPct }); renderBill(); },
  onBillChange: renderBill,
  onBillShare: async () => {
    if (!lastBill) renderBill();
    const info = tableInfo(state);
    const res = await shareBill(lastBill, (info.emoji ? info.emoji + ' ' : '') + (info.title || 'A conta')).catch(() => 'error');
    if (res === 'download') ui.toast(t('toast.imgSaved')); else if (res === 'error') ui.toast(t('toast.imgError'));
  },
  onPayFor: (user, on) => { emitLocal(makePayFor({ to: user, on })); renderBill(); },
  onPrices: () => ui.openPrices(menuEditorItems()),
  onItemToggle: (id) => {
    const it = resolveItem(id);
    // esconder = override do def (LWW, mesa toda); contagens/conta/histórico não mudam
    emitLocal(makeItem({ ...it, off: it.off ? 0 : 1 }));
    render();
    ui.openPrices(menuEditorItems()); // re-desenha a lista com o olho/esmaecido atualizados
  },
  onPriceChange: (id, price) => {
    const it = resolveItem(id);
    // preserva emoji/nome/g/cat/note/share/brand; só troca o preço (senão perde as gramas de álcool!)
    emitLocal(makeItem({ ...it, price: Math.max(0, parseFloat(String(price).replace(',', '.')) || 0) }));
    render();
  },
  onBrandChange: (id, brand) => {
    const it = resolveItem(id);
    // marca/apelido é DADO da mesa (LWW): "Original", "Coca 2L"… vazio = volta pro rótulo padrão
    emitLocal(makeItem({ ...it, brand: String(brand || '').trim().slice(0, 28) }));
    render();
  },
  onPix: (user) => {
    if (!settings.pixKey) { ui.toast(t('toast.pixConfig')); return; }
    const r = (lastBill && lastBill.rows || []).find((x) => x.user === user);
    if (!r) return;
    const payload = pixPayload({ key: settings.pixKey, name: getName() || 'Recebedor', city: settings.pixCity || 'BRASIL', amount: r.amount, txid: 'BOTEQUEI' });
    let qrNode; try { qrNode = makeQR(payload); } catch { qrNode = null; }
    ui.openPix({ title: t('bill.chargeTitle', { name: r.name || '' }), code: payload, qrNode });
  },
  onPixCopy: async () => { try { await navigator.clipboard.writeText(ui.pixCode()); ui.toast(t('toast.pixCopied')); } catch { ui.toast(t('toast.selectCopy')); } },
  onShareNight: async () => {
    const res = await shareRecap(state, resolveItem).catch(() => 'error');
    if (res === 'download') ui.toast(t('toast.imgSaved')); else if (res === 'error') ui.toast(t('toast.imgError'));
  },
  onPurrinha: startPurrinha,
  onPurrStart: (mode, botN) => startPurrinhaMode(mode, botN),
  onPurrSeal: (hand, guess) => (purr && purr.mode !== 'fast' ? purrSealHand(hand) : purrSeal(hand, guess)),
  onPurrGuess: (n) => myPurrGuess(n),
  // ✕ = minimizar (a partida segue; pill traz de volta). Encerrar pra mesa toda = confirmação.
  onPurrClose: () => {
    if (purrActive()) { minimizeGame('purr'); return; }
    purr = null; clearGameMin('purr'); ui.closeOverlays();
  },
  onDomino: () => ui.dominoStartChoice({ botsDefault: domEntrants().length < 2 ? 1 : 0 }),
  onDomStart: (botN) => startDominoVerified(botN), // sempre mesa verificada (regras iguais; só o embaralho é auditável)
  onTruco: startTruco,
  onTrucoStart: (variant, botN) => startTrucoVariant(variant, botN),
  onTrucoPlay: (card) => myTruPlay(card),
  onTrucoRaise: myTruRaise,
  onTrucoResp: (r) => myTruResp(r),
  onTrucoOnze: (play) => myTruOnze(play),
  onTrucoEnv: (k) => myTruEnv(k),
  onTrucoEnvResp: (r) => myTruEnvResp(r),
  onTrucoFlor: () => myTruFlor(),
  onTrucoClose: () => {
    if (truco && !truco.over) { minimizeGame('truco'); return; }
    cancelTruco(false); clearGameMin('truco'); ui.closeOverlays();
  },
  onDomPlay: (key, side) => myDomPlay(key, side),
  onDomPass: myDomPass,
  onDomClose: () => {
    if ((dom && !dom.over) || (dv && !dv.began && !dom)) { minimizeGame('dom'); return; }
    dom = null; domClearTimers(); clearGameMin('dom'); ui.closeOverlays();
  },
  // pill de "jogo rolando": tocar no rótulo VOLTA pro jogo; o ✕ vermelho ENCERRA pra mesa toda (com confirmação)
  onGamePillOpen: (kind) => { if (kind && gameMinned.has(kind)) reopenGame(kind); },
  onGamePillEnd: (kind) => {
    if (kind === 'purr') ui.actionToast(t('purr.endConfirm'), t('game.end'), () => { cancelPurrinha(true); clearGameMin('purr'); ui.closeOverlays(); ui.toast(t('purr.ended')); });
    else if (kind === 'truco') ui.actionToast(t('tru.endConfirm'), t('game.end'), () => { cancelTruco(true); clearGameMin('truco'); ui.closeOverlays(); ui.toast(t('tru.ended')); });
    else if (kind === 'dom') ui.actionToast(t('dom.endConfirm'), t('game.end'), () => {
      const gid = dom && !dom.over ? dom.gameId : (dv && !dv.began ? dv.gameId : null);
      if (gid) gameFx({ kind: 'domino', ph: 'cancel', gameId: gid, from: self });
      dom = null; dv = null; domClearTimers(); clearGameMin('dom'); ui.closeOverlays(); ui.toast(t('dom.ended'));
    });
  },
  onPoke: openPokeFor,
  onPokeSend: sendPoke,
  onCeremony: openCeremony,
  onCeremonyShare: async () => {
    const info = tableInfo(state);
    const res = await shareCeremony(lastAwards, (info.emoji ? info.emoji + ' ' : '') + (info.title || 'Cerimônia')).catch(() => 'error');
    if (res === 'download') ui.toast(t('toast.imgSaved')); else if (res === 'error') ui.toast(t('toast.imgError'));
  },
  onCeremonyBroadcast: () => { if (mesh) mesh.sendFx({ kind: 'ceremony', awards: lastAwards }); ui.toast(t('toast.sentToTable')); },
  onStats: openStats,
  onComanda: openComanda,
  onRetro: openRetro,
  onBarMode: () => ui.openBar({ menuCount: store.getBarMenu().length }),
  onBarOpenTable: (code, useMenu) => {
    if (!getName()) { ui.toast(t('toast.needName')); return; }
    const c = (code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || newRoomCode();
    pendingBarMenu = !!useMenu && store.hasBarMenu();
    ui.closeOverlays();
    enterTable(c, { create: true });
  },
  onSaveMenu: () => {
    const defs = [];
    for (const rec of state.items.values()) defs.push(rec.def);
    store.saveBarMenu(defs);
    ui.toast(defs.length ? t('bar.menuSaved', { n: defs.length }) : t('bar.menuEmpty'));
  },
  onJukebox: () => { if (!room) { ui.toast(t('toast.needTable')); return; } ui.openJukebox({ songs: songs(state) }); },
  onSongAdd: (title) => {
    if (!room) return;
    if (emitLocal(makeSong({ title }))) { ui.renderJukebox(songs(state)); ui.toast(t('jbx.queued')); }
  },
  onSongPlay: (song) => {
    if (!song) return;
    const url = song.url && /^https?:\/\//.test(song.url) ? song.url : 'https://music.youtube.com/search?q=' + encodeURIComponent(song.title);
    try { window.open(url, '_blank', 'noopener'); } catch { /* ignore */ }
  },
  // Passaporte de botecos (check-ins locais, opcionalmente com GPS)
  onPassport: () => ui.openPassport({ checkins: store.getCheckins(), suggestName: room ? tableInfo(state).title : '' }),
  onCheckin: (name) => {
    const nm = ((name || '').trim() || (room ? tableInfo(state).title : '') || t('pass.fallback')).slice(0, 40);
    const save = (lat, lng) => {
      store.addCheckin({ name: nm, at: Date.now(), lat, lng });
      ui.openPassport({ checkins: store.getCheckins() });
      ui.toast(t('toast.checkin')); sound.pop();
    };
    if (navigator.geolocation) {
      ui.toast(t('toast.gettingPlace'));
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
        await navigator.share({ files: [file], title: 'Botequei', text: t('photo.shareText') });
      } else {
        const a = document.createElement('a');
        a.href = ph.url; a.download = ph.name || 'botequei.jpg';
        document.body.appendChild(a); a.click(); a.remove();
        ui.toast(t('toast.photoSaved'));
      }
    } catch { ui.toast(t('toast.shareError')); }
  },
  onShakeToggle: (on) => { settings = setSettings({ shake: !!on }); if (on) enableShake(); else disableShake(); ui.toast(on ? t('toast.shakeOn') : t('toast.shakeOff')); },
  onRetroShare: async () => {
    if (!lastRetro) return;
    const res = await shareRetro(lastRetro).catch(() => 'error');
    if (res === 'download') ui.toast(t('toast.imgSaved')); else if (res === 'error') ui.toast(t('toast.imgError'));
  },
  onWaiter: () => {
    sound.alarm(); ui.floatReaction('🔔');
    if (mesh && mesh.connectedCount() > 0) { mesh.sendFx({ kind: 'waiter', from: self, fromName: getName() || t('common.someoneLow') }); ui.toast(t('toast.waiterCalled')); }
    else ui.toast(t('toast.waiterAlone'));
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
      ui.toast(t('toast.backupOk'));
    } catch { ui.toast(t('toast.backupError')); }
  },
  onImportData: (text) => {
    let obj; try { obj = JSON.parse(text); } catch { ui.toast(t('toast.badFile')); return; }
    let n; try { n = store.importAll(obj); } catch { ui.toast(t('toast.badBackup')); return; }
    ui.toast(t('toast.imported', { n: n }));
    setTimeout(() => location.reload(), 900);
  },
  onSfx: (kind) => { if (typeof sound[kind] === 'function') sound[kind](); },
  onBebedeira: () => { const id = bebedeiraItem(); ui.openBebedeira({ item: id, emoji: resolveItem(id).emoji, count: getCount(state, self, id) }); },
  onBebedeiraClose: () => render(),
  onHappyHour: (minutes) => {
    if (!room) { ui.toast(t('toast.needTableFirst')); return; }
    hhEndedFor = 0;
    emitLocal(makeHappyHour({ minutes, startTotal: tableTotal(state, resolveItem) }));
    tickHappyHour();
    ui.toast(t('hh.on', { n: minutes }));
  },
  onCopyLink: async () => { try { await navigator.clipboard.writeText(inviteUrl()); ui.toast(t('toast.linkCopied')); } catch { ui.toast(inviteUrl()); } },
  onShareInvite: async () => { try { await navigator.share({ title: 'Botequei', text: t('inv.shareText'), url: inviteUrl() }); } catch { /* cancelado */ } },
  onNfc: async () => {
    if (!('NDEFReader' in window)) { ui.toast(t('toast.nfcNo')); return; }
    try { await new window.NDEFReader().write({ records: [{ recordType: 'url', data: inviteUrl() }] }); ui.toast(t('toast.nfcTap')); }
    catch { ui.toast(t('toast.nfcError')); }
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
  onThemePick: (theme) => {
    settings = setSettings({ theme });
    ui.applyTheme(settings);
    ui.toast(t('themePick.applied'));
  },
  onClearData: () => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('botequei.')) localStorage.removeItem(k);
    location.reload();
  },
  onInstall: async () => {
    if (!deferredPrompt) { ui.toast(t('toast.installHint')); return; }
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
