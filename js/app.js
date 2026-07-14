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
//   Handlers (objeto H — a API que a ui.js chama) · Boot
// ============================================================================

import { clientId, getName, setName, newRoomCode } from './identity.js';
import { t } from './i18n.js';
import { VERSION, verLabel } from './version.js';
import { DEFAULT_ITEMS, itemIdFromName, autoColor, autoAvatar, catOf, isShare, isDefault } from './catalog.js';
import {
  emptyState, applyEvent, makeAdd, makeRemove, makeItem, makeProfile, makeTable, makePayFor,
  makePledge, makePledgeOff, settle,
  getCount, itemTotal, userTotal, tableTotal, userMoney, summary, getProfile, tableInfo, isDriver,
  paysFor, payerOf, sharePool, shareSplit, roundTargetIds, roundToCents,
} from './events.js';
import { badgesFor, milestoneLine, ceremonyAwards } from './achievements.js';
import { lifeStats, lifeBadges, monthlyTrend, weekdayInsight, retro, botecoProfiles, nearestBoteco } from './lifestats.js';
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

// ---- 🐛 Diário técnico (modo desenvolvedor) ----
// dlog é NO-OP com o switch desligado (custo zero no dia a dia). Ligado, enxerga o APP INTEIRO
// pelos FUNIS (não por remendo em 200 lugares): toda AÇÃO sua (handlers embrulhados no boot),
// todo EVENTO da mesa (emitLocal + chegada agregada), todo FX de jogo (sendFx/sendTo/onFx —
// só kind/fase, NUNCA mão/carta), presença, toasts, jornada de telas/overlays e erros — num
// anel local (store.addDevLog, teto 1500). O app é P2P/sem servidor: TODO log que existe mora
// no aparelho, e nada sai daqui sozinho — só no 📤 do relatório.
function dlog(k, data) {
  if (!settings.dev) return;
  try { store.addDevLog({ t: Date.now(), k, ...(data || {}) }); } catch { /* quota: ignora */ }
}
// contexto visual (o "print" que interessa pra depurar: ONDE a pessoa estava) — vai junto de erro/📸
function telaCtx() {
  try {
    return {
      tela: (document.querySelector('.screen.is-active') || {}).id || '',
      abertos: [...document.querySelectorAll('.overlay:not([hidden])')].map((o) => o.id).join(','),
    };
  } catch { return {}; }
}
// eventos CHEGANDO agregados por rajada: o anti-entropy manda o log em lotes — 300 eventos de
// um join viram UMA linha com contagem por tipo (senão o sync afogaria o anel do diário)
let rxAgg = null;
function dlogRx(tipo) {
  if (!settings.dev) return;
  if (!rxAgg) { rxAgg = {}; setTimeout(() => { const a = rxAgg; rxAgg = null; dlog('ev.rx', a); }, 400); }
  rxAgg[tipo || '?'] = (rxAgg[tipo || '?'] || 0) + 1;
}
// estado PÚBLICO do jogo em curso (fase/rodada) — mão/carta privada NUNCA entra em log/relatório
function gameSnapshot() {
  const pick = (o, ks, r) => {
    for (const k of ks) if (o && o[k] !== undefined && o[k] !== null && typeof o[k] !== 'object') r[k] = String(o[k]).slice(0, 12);
    return r;
  };
  if (purr) return pick(purr, ['phase', 'rd', 'mode'], { j: 'purrinha' });
  if (dom) return pick(dom, ['phase', 'over'], { j: 'domino' });
  if (truco) return pick(truco, ['phase', 'over'], { j: 'truco' });
  return null;
}
// Erros globais entram no diário COM o contexto de tela (snapshot automático do crash)
window.addEventListener('error', (e) => dlog('erro', { m: String((e && e.message) || '').slice(0, 200), ...telaCtx() }));
window.addEventListener('unhandledrejection', (e) => {
  const r = e && e.reason;
  dlog('erro', { m: String((r && r.message) || r || '').slice(0, 200), ...telaCtx() });
});
let verTaps = 0, verTapAt = 0; // 7 toques na versão (à la Android) destravam a seção 🐛
let lastMalha = null;          // assinatura da última presença logada (loga só MUDANÇA)
let lastHidden = null;         // última visibilidade logada (escondeu/voltou o app)
let maxSkew = 0;               // maior desvio visto entre o ts de um evento AO VIVO e o relógio local
let meshStartAt = 0, meshConnLogged = false; // t.conexao: início da malha e se já logou a 1ª formação
let lastTransp = null;         // último transporte da sinalização logado (ws/poll — loga a virada)
let lastLongAt = 0;            // throttle das long tasks (não afogar o diário numa rajada de travadas)
let gameStallTimer = null;     // detector de jogo PARADO (30s sem progresso → snapshot público)
const peerVersSeen = new Set();// versões de peer já logadas (uma linha por versão nova vista)
const stuckLogged = new Set(); // peers já logados como P2P travado (uma linha por peer — id é per-sessão)
// Watchdog de async: arma um alarme; se o `disarm()` não vier no prazo, a operação PENDUROU
// (o clássico: prompt de permissão sem resposta não dispara callback NEM timeout). Vira `pendurada`.
function armWatchdog(kind, ms) {
  if (!settings.dev) return () => {};
  let live = true;
  const tm = setTimeout(() => { if (live) { live = false; dlog('pendurada', { o: kind }); } }, ms);
  return () => { if (live) { live = false; clearTimeout(tm); } };
}
// Porta ÚNICA da geolocalização: centraliza os 4 pontos que pediam GPS + arma o watchdog (o
// `getCurrentPosition` que pendura no prompt vira `pendurada {o:'geo:...'}` no diário).
function geoGet(kind, ok, err, opts) {
  if (!navigator.geolocation) { if (err) err({ code: 2 }); return; }
  const dis = armWatchdog('geo:' + kind, ((opts && opts.timeout) || 8000) + 3000);
  navigator.geolocation.getCurrentPosition((p) => { dis(); ok(p); }, (e) => { dis(); if (err) err(e); }, opts);
}
// console.error/warn no diário: o navegador cospe aviso de WebRTC/storage/SW aí e some — é onde
// mora a pista de bug de conexão. dlog é no-op desligado, então o custo real é zero fora do modo dev.
for (const lvl of ['error', 'warn']) {
  const orig = console[lvl] ? console[lvl].bind(console) : () => {};
  console[lvl] = (...a) => { try { dlog('console', { n: lvl, m: a.map((x) => (x && x.message) || String(x)).join(' ').slice(0, 200) }); } catch { /* ignore */ } orig(...a); };
}
// Travadinha do nada: long task (>200ms na main thread) com contexto de tela, com throttle de 800ms.
try {
  if (window.PerformanceObserver) {
    new window.PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration <= 200) continue;
        const now = Date.now(); if (now - lastLongAt < 800) continue; lastLongAt = now;
        dlog('lenta', { ms: Math.round(e.duration), ...telaCtx() });
      }
    }).observe({ entryTypes: ['longtask'] });
  }
} catch { /* longtask não suportado: sem drama */ }
// 📸 automática num momento ANORMAL (fim de jogo cancelado/noshow/trapaça pega): fotografa o
// estado na hora, sem depender do André lembrar de apertar. Reusa o mesmo snapshot público.
function devShotAuto(motivo) {
  if (!settings.dev) return;
  dlog('foto.auto', { motivo, ...telaCtx(), ...(gameSnapshot() ? { jogo: JSON.stringify(gameSnapshot()) } : {}) });
}
// Jogo PARADO: rearma um relógio de 30s a cada mexida na partida (jogada minha/dos outros,
// mudança de presença); se estourar, o jogo congelou → snapshot público (fase/vez/online).
function armGameStall() {
  if (gameStallTimer) { clearTimeout(gameStallTimer); gameStallTimer = null; }
  if (!settings.dev) return;
  if (!(purr || dom || truco)) return; // sem jogo aberto: nada a vigiar
  gameStallTimer = setTimeout(() => {
    const on = mesh ? mesh.peers().filter((p) => p.online).length + 1 : 1;
    dlog('jogo.parado', { ...(gameSnapshot() || {}), online: on });
  }, 30000);
}
let offlineWaiting = false;   // convidado esperando o anfitrião ler a resposta (fecha sozinho ao conectar)
let lastTableMilestone = 0;   // comemora a cada 10 rodadas da mesa (marco); sincronizado no sync
let renderScheduled = false;
let sessionStart = 0;        // quando entrei nesta mesa (p/ duração no histórico)
let sessionJoined = false;   // entrei na mesa de OUTRO (join/convite)? → "aprendi" o cardápio de alguém
let prevOnline = new Set();  // presença: quem estava online na última passada
let presenceSeeded = false;  // 1ª passada de presença só semeia (sem toast)
let everSeen = new Set();    // quem já apareceu online na sessão ("entrou!" só na 1ª vez)
let saidBye = new Set();     // quem deu tchau EXPLÍCITO (fx 'bye' do leaveTable) — sai da barra
let leftQuiet = new Set();   // fechou o app (fx 'gone' confirmado pela graça) — sai da barra SEM toast
let goneAt = new Map();      // user -> { tm, wentOff }: timer da graça do 'gone' — só cancela quem VOLTOU
                             // (off→on DEPOIS do gone; o fx chega com a página ainda viva um instante)
let awaySince = new Map();   // user -> desde quando está 💤 (relógio na barra/placar/comanda + arrumação)
let presTick = null;         // re-render periódico com a mesa aberta (o relógio do 💤 anda sozinho)
const GONE_GRACE_MS = 45000;  // fechou o app: só sai da barra se não voltar nisso
const AWAY_HIDE_MS = 3600000; // 💤 por 1h+: a barra se arruma sozinha (quem morreu sem tchau — bateria)
// Catch-up na volta: esconder o app / bloquear a tela CONGELA o WebRTC (regra do SO — não dá pra
// receber em tempo real). Na volta o wake() reconecta e o anti-entropy re-sincroniza TUDO (CRDT,
// nada se perde); aí um resumo curto conta o que rolou na mesa enquanto você esteve fora. 100%
// local (lê o próprio estado, sem servidor) e só aparece se houve novidade (delta > 0).
let awaySnap = null;             // { at, total } no instante que escondeu
let catchupPending = null;       // { total, deadline } aguardando a re-sync assentar na volta
let catchupTimer = null;         // debounce do "assentou" (re-arma a cada evento sincronizado)
const CATCHUP_SETTLE_MS = 1800;  // 1,8s sem evento novo → a re-sync assentou, pode resumir
const CATCHUP_MAX_MS = 15000;    // teto: não espera mais que isso pela re-sync (mesa movimentada)
let sessionMates = new Set(); // nomes que apareceram na mesa (p/ "com quem você mais bebeu")
let lastRetro = null;        // dados da última retrospectiva (p/ compartilhar)
let shakeHandler = null, shakeLast = 0, shakePending = false; // mãos livres (chacoalhar pra +1)

// Álcool INDIVIDUAL (trava do motorista + rodada). Recipientes da mesa (share) ficam de fora
// de propósito: motorista PODE marcar "chegou mais uma garrafa" — ele não bebe.
const ALCOHOL = new Set(['chopp', 'lata', 'longneck', 'dose', 'drink']);
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
// Identidade do "eu" pro avatar do canto da home / hub — a foto LOCAL (settings) tem prioridade
// sobre a do fio (é a fonte da verdade do próprio usuário antes de o PROFILE propagar).
function meAvatar() { const p = profOf(self); return { color: p.color, emoji: p.emoji, photo: settings.profPhoto || p.photo || '', level: p.level }; }

// ---- Log / dedup ----
function ingest(ev) {
  if (!ev || !ev.eventId || seen.has(ev.eventId)) return false;
  seen.add(ev.eventId); log.push(ev); applyEvent(state, ev); scheduleSave();
  return true;
}
function rebuildFrom(events) { log = []; seen = new Set(); state = emptyState(); for (const ev of events) ingest(ev); lastTableMilestone = Math.floor(tableTotal(state) / 10); }
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (room) store.saveEvents(room, log); }, 400); }

// evento local: registra + propaga
function emitLocal(ev) {
  if (!ingest(ev)) return false;
  dlog('ev', { tipo: ev.type, item: ev.item || (ev.def && ev.def.id) || '' }); // só tipo+id — payload (foto/def) NÃO entra
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
  const total = tableTotal(state);
  const m = Math.floor(total / 10);
  if (total > 0 && m > lastTableMilestone) {
    lastTableMilestone = m;
    ui.celebrate();
    ui.toast(t('toast.milestone', { n: total }));
  } else if (m < lastTableMilestone) {
    lastTableMilestone = m;
  }
}
function addCustomItem({ emoji, name, price, cat, note, share }) {
  const id = itemIdFromName(name);
  const def = { id, emoji, name, price: price || 0, cat: cat || 'outros', note: (note || '').slice(0, 40) };
  if (share) def.share = 1; // "da mesa": dinheiro rateado, não entra no corpo de ninguém
  if (emitLocal(makeItem(def))) {
    render();
    // clareана #3: fechar o loop na cara. Se o cardápio VAI ser lembrado (a mesa tem nome OU há
    // check-in fresco = sessionBoteco), avisa no 1º item — a corrente check-in→montar→sair→salvar
    // deixa de ser invisível. 1× por sessão; senão, o toast normal de "item na mesa".
    const bar = room ? sessionBoteco() : '';
    if (bar && !menuRememberHinted) { menuRememberHinted = true; ui.toast(t('toast.menuRemember', { name: bar })); }
    else ui.toast(t('toast.itemAdded', { emoji, name }));
  }
}

// ---- Rodada (do item que você escolher). MESMA regra nos dois botões — muda só o dono:
//   • item PESSOAL (chopp/dose/refri) → UM pra cada pessoa online (motorista fora se alcoólico);
//   • item DA MESA (share: garrafa/litrão/torre) → UMA unidade só (o card dela já é coletivo).
// "🍻 Rodada" não tem dono (cada um paga o seu); "💸 Pagar" carimba você como pagador. ----
function drinkItems() {
  return allItems().filter((it) => !it.off && (isShare(it) || ['cerveja', 'destilado', 'sem-alcool'].includes(catOf(it))));
}
// Alvos da rodada. Item da mesa (share) = UMA unidade (só eu marco). Item pessoal: um pra cada —
// SEM `scope` = a mesa online; COM `scope` (jogadores de um jogo) = só quem jogou (bot fora,
// que não bebe; motorista fora se alcoólico). `roundTargetIds` é puro (events.js), testável.
function roundTargets(def, scope) {
  if (isShare(def)) return [{ user: self, name: getName() }];
  const alcoholic = ALCOHOL.has(def.id) || (def.g || 0) > 0;
  const online = [self, ...(mesh ? mesh.peers().filter((p) => p.online).map((p) => p.user) : [])];
  const ids = roundTargetIds(scope, online, { alcoholic, isBot, isDriver: (id) => isDriver(state, id) });
  return ids.map((id) => ({ user: id, name: id === self ? getName() : profOf(id).name }));
}
// ---- 💸 Pagar uma rodada (perdeu o jogo ou resolveu bancar): você BANCA (crédito pra mesa). ----
// Item pessoal → um pra cada online: cada um BEBE (conta no consumo dele) e uma PROMESSA cobre 1
// de cada. Item da mesa → +1 no bolo e a promessa banca N garrafas. O DINHEIRO é acertado no fim
// (settle): cobre `min(1, consumido)` → o −1 do toque longo não deixa fantasma. Ver events.js.
let lastPaid = null; // últimos ADDs do pagamento (p/ desfazer — pode ser vários numa rodada)
let lastPledge = null; // id da PROMESSA (crédito) criada na rodada — p/ desfazer junto dos ADDs
let payScope = null; // escopo do pagamento corrente: jogadores do jogo (do menu = null = mesa toda)
function payChoices() {
  return drinkItems().map((it) => ({ id: it.id, emoji: it.emoji, name: itemLabel(it), price: it.price || 0, share: isShare(it) ? 1 : 0 }));
}
function openPayRound(scope) {
  payScope = Array.isArray(scope) && scope.length ? scope : null; // do jogo: só os jogadores; do menu: mesa
  // enriquece cada item com quantos vão RECEBER (n): item pessoal = um pra cada online no escopo;
  // item da mesa (share) = 1 unidade coletiva. O botão antecipa o ×N e o total (ver ui.openPayRound).
  const items = payChoices().map((it) => ({ ...it, n: roundTargets(resolveItem(it.id), payScope).length }));
  if (!items.length) { ui.toast(t('pay.noItem')); return; }
  ui.openPayRound({ items });
}
function payRoundGo(itemId) {
  const def = resolveItem(itemId);
  if (!def) return;
  const scope = payScope; payScope = null; // consome o escopo (jogo) uma vez
  const tgts = roundTargets(def, scope);
  const evs = [];
  // +1 pra cada (SEM `payer`: o consumo é da pessoa). O DINHEIRO vem da PROMESSA abaixo, acertada
  // no fim (settle) — nunca pré-marca unidade, então o −1 do toque longo não deixa fantasma.
  for (const tg of tgts) { const ev = makeAdd(itemId, tg.user, tg.name); if (emitLocal(ev)) evs.push(ev); }
  if (!evs.length) return;
  // a PROMESSA (crédito pra mesa): item pessoal → cobre 1 de cada no escopo; item da mesa → banco N unidades.
  const pledge = isShare(def) ? makePledge(itemId, { units: evs.length }) : makePledge(itemId, { scope: tgts.map((tg) => tg.user) });
  emitLocal(pledge);
  lastPaid = evs; lastPledge = pledge.id;
  // 🔔 pagou a rodada = chama o garçom pra mesa, dizendo o item e QUANTOS são (efêmero, não persiste).
  if (mesh && mesh.connectedCount() > 0) mesh.sendFx({ kind: 'waiter', from: self, fromName: getName() || t('common.someoneLow'), item: itemLabel(def), n: evs.length });
  ui.floatReaction('💸'); ui.floatReaction('🔔'); sound.cheers(); ui.celebrate([def.emoji || '🍻', '💸', '🎉']);
  afterChange(itemId, 'add');
  const label = evs.length > 1 ? `${evs.length}× ${itemLabel(def)}` : itemLabel(def);
  ui.actionToast(t('pay.done', { item: label }), t('common.undo'), () => {
    if (!lastPaid) return;
    let undone = false;
    if (lastPledge) { if (emitLocal(makePledgeOff(lastPledge))) undone = true; lastPledge = null; } // desfaz o crédito
    for (const e of lastPaid) if (emitLocal(makeRemove(e.item, e.user, e.name))) undone = true;      // −1 (SEM payer)
    if (undone) { lastPaid = null; scheduleRender(); }
  }, 7000);
}
// Perdeu o jogo NO MEU aparelho: oferece pagar a rodada SÓ pros jogadores (`scope`) — não a mesa
// toda. É OFERTA, não automação — quem perdeu decide; sem NENHUM item no cardápio, a zoeira basta.
function offerLoserPay(scope) {
  if (!payChoices().length) return;
  ui.actionToast(t('pay.lostQ'), t('pay.lostGo'), () => openPayRound(scope), 12000);
}

// ---- Efeitos sociais ----
function onBrinde() { ui.brinde(); if (mesh) mesh.sendFx({ kind: 'brinde' }); }
function onReact(emoji) { ui.floatReaction(emoji); if (mesh) mesh.sendFx({ kind: 'react', emoji }); }

// Jogos (dominó/purrinha) precisam que TODA jogada chegue em todo mundo, mesmo se a malha não
// estiver 100% completa (4 pessoas = 6 links; algum par pode faltar/precisar de TURN). Diferente
// das reações, essas fx levam um `mid` e são repassadas (gossip) com dedup — igual aos eventos.
let fxSeq = 0;
const seenFx = new Set();
// Dedup dos fx de jogo com TETO: sem isto o Set crescia pra sempre e um peer floodando fx com
// mid únicos inchava a memória. FIFO (Set guarda ordem de inserção): passou do teto, larga o
// mais antigo — uma noite de jogo não chega perto de 4000 jogadas, então nada legítimo é re-visto.
function markSeenFx(mid) {
  seenFx.add(mid);
  if (seenFx.size > 4000) seenFx.delete(seenFx.values().next().value);
}
function gameFx(fx) {
  if (!mesh) return;
  fx.mid = self + ':' + (fxSeq++);
  markSeenFx(fx.mid);
  armGameStall(); // eu joguei → a partida progrediu, re-arma o vigia de "jogo parado"
  mesh.sendFx(fx);
}
function onFx(fx, fromId) {
  if (!fx) return;
  // gossip com dedup só pras fx de jogo (têm mid): ignora repetida, repassa a nova pros outros
  if (fx.mid && (fx.kind === 'domino' || fx.kind === 'purrinha' || fx.kind === 'truco')) {
    if (seenFx.has(fx.mid)) return;
    markSeenFx(fx.mid);
    if (mesh) mesh.broadcast({ k: 'fx', fx }, fromId);
  }
  dlog('fx.rx', { k: fx.kind || '?', ph: fx.ph || '', de: String(fromId || '').slice(0, 6) }); // pós-dedup: só o que APLICOU
  if (fx.kind === 'domino' || fx.kind === 'purrinha' || fx.kind === 'truco') {
    armGameStall(); // chegou jogada → a partida progrediu, re-arma o vigia de "jogo parado"
    if (fx.ph === 'cancel' || fx.ph === 'noshow') devShotAuto('jogo:' + fx.ph); // fim anormal → 📸 automática
  }
  if (fx.kind === 'brinde') ui.brinde();
  else if (fx.kind === 'react') ui.floatReaction(fx.emoji || '🍻');
  else if (fx.kind === 'challenge') { if (fx.to === self) receiveChallenge(fx); }
  else if (fx.kind === 'ceremony') receiveCeremony(fx);
  else if (fx.kind === 'waiter') receiveWaiter(fx);
  else if (fx.kind === 'bye') receiveBye(fx, fromId);
  else if (fx.kind === 'gone') receiveGone(fx, fromId);
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
  if (shakeHandler || shakePending) return; // no iOS o handler só nasce após a permissão async —
  const attach = () => {                      // `shakePending` impede um 2º listener nessa janela
    shakePending = false;
    if (shakeHandler) return;
    shakeHandler = (e) => {
      const a = e.accelerationIncludingGravity || e.acceleration;
      if (!a) return;
      const mag = Math.abs(a.x || 0) + Math.abs(a.y || 0) + Math.abs(a.z || 0);
      if (mag > 34 && Date.now() - shakeLast > 1200) {
        shakeLast = Date.now();
        if (room && !document.querySelector('.overlay:not([hidden])')) act('ADD', topItem());
      }
    };
    window.addEventListener('devicemotion', shakeHandler);
  };
  if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
    shakePending = true;
    DeviceMotionEvent.requestPermission().then((r) => { if (r === 'granted') attach(); else { shakePending = false; ui.toast(t('toast.motion')); } }).catch(() => { shakePending = false; });
  } else attach();
}
function disableShake() { shakePending = false; if (shakeHandler) { window.removeEventListener('devicemotion', shakeHandler); shakeHandler = null; } }
// Throttle de fx SOCIAIS do fio (cerimônia/garçom/cutucada/desafio): um peer floodando não vira
// alarme+confete+vibração em rajada. Guarda o último disparo por tipo; nome sempre com teto.
const fxAt = new Map();
function fxAllowed(kind, ms) { const now = Date.now(), last = fxAt.get(kind) || 0; if (now - last < ms) return false; fxAt.set(kind, now); return true; }
const fromNameOf = (fx) => (typeof fx.fromName === 'string' && fx.fromName.slice(0, 24)) || t('common.someone');
function receiveCeremony(fx) {
  if (!Array.isArray(fx.awards) || !fxAllowed('ceremony', 3000)) return; // 1 a cada 3s + teto do
  ui.openCeremony({ awards: fx.awards.slice(0, 20) }); // array (innerHTML gigante travaria a mesa)
}
function receiveWaiter(fx) {
  if (!fxAllowed('waiter', 900)) return;
  const name = fromNameOf(fx);
  const item = typeof fx.item === 'string' ? fx.item.slice(0, 40) : ''; // higiene P2P
  const n = Math.max(1, Math.min(99, Number(fx.n) || 1));
  ui.toast(item ? t('toast.waiterOrderFrom', { name, n, item }) : t('toast.waiterFrom', { name }));
  sound.alarm(); ui.vibrate([80, 40, 80]); ui.floatReaction('🔔');
}
function receiveChallenge(fx) {
  if (!fxAllowed('challenge', 900)) return;
  const it = resolveItem(fx.item || 'dose');
  sound.challenge(); ui.vibrate([60, 40, 60, 40, 60]);
  ui.actionToast(t('toast.challenged', { name: fromNameOf(fx), emoji: it.emoji, item: it.name }), t('toast.challengeAccept'), () => act('ADD', fx.item || 'dose'), 7000);
}

// ---- Eventos remotos ----
function onRemoteEvent(ev, fromPeer, isSync) {
  if (!ingest(ev)) return;
  dlogRx(ev.type); // agregado por rajada (sync em lote vira UMA linha com contagens)
  // Desvio de relógio: o LWW decide por ts — relógio adiantado de alguém faz nome/preço "voltar
  // sozinho". Mede só evento AO VIVO (o do sync é histórico, ts velho de propósito).
  if (settings.dev && !isSync && ev.ts) {
    const sk = Date.now() - Number(ev.ts);
    if (Math.abs(sk) > Math.abs(maxSkew)) maxSkew = sk;
    if (Math.abs(sk) > 5000) dlog('relogio', { desvioMs: sk, de: String(fromPeer || '').slice(0, 6) });
  }
  if (mesh) mesh.broadcast({ k: 'ev', ev }, fromPeer); // gossip
  if (isSync) { if (ev.type === 'ADD') lastTableMilestone = Math.floor(tableTotal(state) / 10); if (catchupPending) scheduleCatchup(); scheduleRender(); return; }
  if (ev.type === 'ADD') checkTableMilestone();
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
}

// ---- Render ----
// "Boteco da sessão": onde você está agora, pro cardápio salvo. O NOME da mesa manda; mesa
// sem nome usa o último check-in AINDA FRESCO (você acabou de chegar no bar) — assim o
// check-in do passaporte (que é da home) puxa o cardápio na mesa que você abrir em seguida.
// Sem check-in fresco, o GPS entra: se você está PERTO de um boteco onde já fez check-in.
const CHECKIN_FRESH_MS = 6 * 3600e3; // ~6h: um rolê. Check-in velho não cola numa mesa nova.
const GPS_RADIUS_M = 250;            // "estou nesse boteco" — folga pra imprecisão do GPS.
let gpsBoteco = '';                  // boteco detectado por perto nesta sessão (some ao sair)
let autoCheckedIn = false;           // já registrei o check-in automático desta sessão de join?
let menuRememberHinted = false;      // já avisei "vou lembrar o cardápio" nesta sessão (clareана #3)
function freshCheckin() {
  const c = store.getCheckins()[0];
  return (c && c.name && (Date.now() - (c.at || 0)) < CHECKIN_FRESH_MS) ? c.name : '';
}
function sessionBoteco() { return tableInfo(state).title || freshCheckin() || gpsBoteco; }

const GEO_OPTS = { timeout: 8000, maximumAge: 300000 };
// Recusou o NOSSO pedido de localização → desliga o switch (não insiste) e avisa. Só o "negou de
// verdade" (code 1 = PERMISSION_DENIED); timeout/indisponível são passageiros e mantêm o switch on.
function geoDeny(err) {
  dlog('geo.erro', { code: (err && err.code) || 0 }); // 1=negou, 2=indisponível, 3=timeout
  if (!err || err.code !== 1) return;
  settings = setSettings({ geo: false });
  ui.fillSettings(settings);
  ui.toast(t('toast.geoDenied'));
}
// Sugere o boteco POR GPS: com o switch LIGADO (default), ao criar a mesa perto de um lugar onde
// você já fez check-in COM cardápio salvo, PERGUNTA se quer carregar ("você está no {nome}?"). O
// 'prompt' pede a permissão AGORA (o toque de criar a mesa é o gesto); 'denied' reflete no switch.
// Tudo local; nada sai do aparelho.
function maybeSuggestByGps() {
  if (!settings.geo || !navigator.geolocation) return;
  dlog('gps.olhando', {});
  const go = () => geoGet('sugestao', (pos) => {
    if (!room || state.items.size || tableInfo(state).title) return; // já tem nome/itens → não atrapalha
    const name = nearestBoteco(store.getCheckins(), pos.coords.latitude, pos.coords.longitude, GPS_RADIUS_M);
    dlog('gps.resultado', { perto: name || '', cardapio: !!(name && store.hasBotecoMenu(name)) });
    if (!name) return;
    gpsBoteco = name; render();
    // Perto de um bar conhecido → oferece dar o NOME dele à mesa (o boteco = o nome da mesa). Com
    // cardápio salvo, a ação já carrega junto ("carregar" também nomeia); sem cardápio, só nomeia.
    if (store.hasBotecoMenu(name)) askLoadBoteco(name); else askHereName(name);
  }, geoDeny, GEO_OPTS);
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then((st) => {
      if (st && st.state === 'denied') { settings = setSettings({ geo: false }); ui.fillSettings(settings); return; }
      go(); // 'granted' usa; 'prompt' pede (o switch está ON = você topou)
    }).catch(go);
  } else go();
}
// A pergunta de verdade (não só o CTA mudo do empty-state): "Você está no {nome}? Carregar?"
function askLoadBoteco(name) {
  ui.actionToast(t('geo.hereQ', { name }), t('geo.hereGo'), () => handlers.onLoadBoteco(), 9000);
}
// Bar conhecido SEM cardápio salvo: oferece só dar o NOME dele à mesa (= registrar o boteco).
// Nomear dispara o check-in (render → maybeAutoCheckin) e "cola" o boteco na sessão pro cardápio
// de amanhã — o boteco vem do nome da mesa, sem check-in à mão.
function askHereName(name) {
  ui.actionToast(t('geo.hereQ', { name }), t('geo.hereName'), () => { if (room && !tableInfo(state).title) setTable({ title: name }); }, 9000);
}
// Toda mesa com NOME de bar registra a visita no passaporte — o boteco = o NOME da mesa (fonte
// única). Vale pra quem CRIA e pra quem ENTRA: o passaporte se enche sozinho, sem check-in à mão.
// Sem GPS obrigatório; deduplica por check-in fresco do MESMO lugar; o GPS só enriquece depois.
function freshCheckinFor(name) {
  const key = store.botecoKey(name);
  return store.getCheckins().some((c) => c.name && store.botecoKey(c.name) === key && (Date.now() - (c.at || 0)) < CHECKIN_FRESH_MS);
}
function maybeAutoCheckin() {
  if (autoCheckedIn || !room) return; // criei OU entrei: se a mesa tem nome, a visita entra
  const title = tableInfo(state).title;
  if (!title) return;          // mesa sem nome → sem check-in fantasma (nome é o gatilho)
  autoCheckedIn = true;        // marca ANTES do async (o render pode re-chamar antes de resolver)
  if (freshCheckinFor(title)) return; // já tem check-in fresco desse bar → não duplica
  dlog('checkin.auto', { nome: title });
  // GRAVA NA HORA (o GPS pendurado não pode comer o check-in) e o GPS só enriquece depois, se vier.
  const at = Date.now();
  store.addCheckin({ name: title, at, lat: null, lng: null });
  dlog('checkin.salvo', { nome: title, auto: 1 }); // grava JÁ; o checkin.gps marca o enriquecimento
  ui.toast(t('toast.autoCheckin', { name: title })); sound.pop();
  if (settings.geo && navigator.geolocation) geoGet('autocheckin', (p) => { store.enrichCheckin(at, p.coords.latitude, p.coords.longitude); dlog('checkin.gps', { nome: title, auto: 1 }); }, () => {}, GEO_OPTS);
}

// Toast pós-carregar o cardápio: se tem preço, vira ação "revisar preços" (podem ter mudado
// desde a última vez) que abre o Cardápio da mesa; sem preço, é só o aviso de carregado.
function botecoLoadedToast(defs, n) {
  sound.pop();
  if ((defs || []).some((d) => (d.price || 0) > 0)) {
    ui.actionToast(t('toast.botecoLoaded', { n }), t('toast.reviewPrices'), () => ui.openPrices(menuEditorItems()), 6000);
  } else ui.toast(t('toast.botecoLoaded', { n }));
}

function render() {
  if (!room) return;
  maybeAutoCheckin(); // mesa com nome (criei ou entrei) → registra a visita no passaporte (1×)
  const list = allItems();
  // share mostra o contador DA MESA no número grande (sem contagem pessoal por copo)
  const items = list.filter((it) => !it.off).map((it) => ({
    id: it.id, emoji: it.emoji, name: itemLabel(it), cat: catOf(it), note: it.note || '',
    share: isShare(it),
    qty: itemTotal(state, it.id),
    sub: isShare(it) ? '' : t('item.sub', { n: getCount(state, self, it.id) }),
  }));
  const info = tableInfo(state);
  const tt = tableTotal(state);
  // Mesa VAZIA cujo boteco (nome da mesa OU check-in fresco) tem cardápio salvo → oferece
  // recarregar (1 toque). A mesa segue nascendo limpa; carregar é sempre explícito.
  const bname = items.length === 0 ? sessionBoteco() : '';
  const savedDefs = bname ? store.getBotecoMenu(bname) : [];
  ui.renderTable({
    code: room,
    title: info.title || '',
    myTotal: userTotal(state, self, resolveItem),
    tableTotal: tt,
    peerCount: (mesh ? mesh.connectedCount() : 0) + 1,
    showMoney: list.some((i) => i.price > 0),
    myMoney: userMoney(state, self, resolveItem),
    heroFill: tt === 0 ? 0 : ((tt - 1) % 10 + 1) / 10 * 100, // nível de chopp: enche a cada 10
    boteco: savedDefs.length ? { name: bname, count: savedDefs.length } : null,
    items,
  });
  renderPeers();
  renderPresence();
  const mp = mesh ? mesh.peers() : [];
  const online = mp.filter((p) => p.online).length;
  const stuck = mp.filter((p) => p.stuck); // presente no signaling mas o P2P nunca fechou (NAT/4G)
  if (mp.length === 0) ui.setConn(t('conn.alone'));
  else if (stuck.length && tt > 0) {
    // só INCOMODA com a mesa ativa (tt>0): sem consumo, nada pra dessincronizar → fica quieto.
    // banner vira AÇÃO: tocar → conectar por QR (host candidate na mesma Wi-Fi/hotspot, zero servidor)
    const nm = profOf(stuck[0].user).name || t('common.someoneLow');
    ui.setConn(stuck.length > 1 ? t('conn.stuckN', { name: nm, n: stuck.length - 1 }) : t('conn.stuck', { name: nm }), nudgePair);
  }
  else if (online < mp.length) ui.setConn(t('conn.reconnecting', { on: online, total: mp.length }));
  else ui.setConn(null);
}

// P2P travado (presente no signaling, canal nunca fechou): oferece o pareamento por QR — a saída
// ZERO servidor (host candidate na mesma Wi-Fi/hotspot). Papel DETERMINÍSTICO (mesma anti-glare da
// malha: id menor dirige): menor que TODOS os travados → eu MOSTRO o convite (host); senão ESCANEIO.
// Os dois lados escolhem papéis complementares sem combinar nada. Os dois estão na mesma mesa física.
function nudgePair() {
  if (!mesh) return;
  const stuck = mesh.peers().filter((p) => p.stuck);
  if (stuck.length && stuck.every((p) => self < p.user)) offlineHost();
  else offlineJoin();
}

function renderPresence() {
  const me = profOf(self);
  const list = [{ user: self, emoji: me.emoji, photo: me.photo, color: me.color, name: getName() || t('common.you'), level: me.level, online: true, self: true }];
  const listed = new Set([self]);
  // quem caiu segue na barra como 💤 (presença serena) com o RELÓGIO de há quanto tempo; sai da
  // barra quem deu tchau explícito (bye), quem fechou o app (gone + graça vencida) ou quem passou
  // de 1h de 💤 (arrumação) — sempre SEM toast, e todos voltam na hora se reconectarem.
  if (mesh) for (const p of mesh.peers()) {
    if (saidBye.has(p.user) || leftQuiet.has(p.user)) continue;
    const awayMs = p.online ? 0 : Date.now() - (awaySince.get(p.user) || Date.now());
    if (awayMs > AWAY_HIDE_MS) continue;
    listed.add(p.user); const pr = profOf(p.user);
    list.push({ user: p.user, emoji: pr.emoji, photo: pr.photo, color: pr.color, name: pr.name || t('common.someoneLow'), level: pr.level, online: p.online, awayLabel: awayLabel(awayMs) });
  }
  // A BARRA é do APP, não do transporte: a malha DELETA o registro de quem sumiu do signaling
  // com conexão ruim (GC, mesh.js) — sem isto o 💤 evaporava da barra minutos depois da queda,
  // sem tchau nenhum. Quem está no awaySince segue 💤 (com relógio) até bye/gone/arrumação de 1h.
  for (const [u, since] of awaySince) {
    if (listed.has(u) || saidBye.has(u) || leftQuiet.has(u)) continue;
    const awayMs = Date.now() - since;
    if (awayMs > AWAY_HIDE_MS) continue;
    const pr = profOf(u);
    list.push({ user: u, emoji: pr.emoji, photo: pr.photo, color: pr.color, name: pr.name || t('common.someoneLow'), level: pr.level, online: false, awayLabel: awayLabel(awayMs) });
  }
  ui.renderPresence(list);
}

function renderPeers() {
  const base = summary(state, resolveItem); // uma passada só
  const nets = new Map();
  if (mesh) for (const p of mesh.peers()) nets.set(p.user, { online: p.online, conn: p.conn, stuck: p.stuck });
  const rows = base.map((r) => {
    const p = profOf(r.user);
    const net = nets.get(r.user);
    return { ...r, name: p.name, color: p.color, emoji: p.emoji, photo: p.photo, level: p.level, badges: badgesFor(state, r.user), online: net ? net.online : undefined, conn: net ? net.conn : null,
      stuck: net ? !!net.stuck : false, // P2P travado: o placar mostra 🔌 (não é 💤 "saiu", é "não fechou")
      away: net && net.online === false ? awayLabel(Date.now() - (awaySince.get(r.user) || Date.now())) : '' };
  });
  // garante que eu apareço mesmo sem ter consumido
  if (!rows.some((r) => r.user === self)) {
    const p = profOf(self);
    rows.push({ user: self, name: p.name, color: p.color, emoji: p.emoji, photo: p.photo, driver: p.driver, total: 0, money: 0, badges: badgesFor(state, self) });
  }
  // peer TRAVADO aparece no placar (mesmo sem consumo — o log dele nem chegou): a "saúde por
  // link". Só com a mesa ATIVA (tableTotal>0): mesa vazia não tem o que dessincronizar → sem ruído.
  if (tableTotal(state) > 0) for (const [u, net] of nets) {
    if (net.stuck && !rows.some((r) => r.user === u)) {
      const p = profOf(u);
      rows.push({ user: u, name: p.name, color: p.color, emoji: p.emoji, photo: p.photo, level: p.level, total: 0, money: 0, badges: [], online: false, stuck: true });
    }
  }
  const top = base.find((r) => !r.driver && r.total > 0); // MVP derivado (base já vem ordenado)
  ui.renderPeers({ rows, selfId: self, mvp: top ? { name: profOf(top.user).name, total: top.total } : null, myBadges: badgesFor(state, self) });
}

// Item mais consumido por mim (fallback 'chopp') — usado pelo "mãos livres" (chacoalhar = +1).
function topItem() {
  let best = 'chopp', bestN = -1;
  for (const it of allItems()) { if (isShare(it) || it.off) continue; const n = getCount(state, self, it.id); if (n > bestN) { bestN = n; best = it.id; } }
  return best;
}

// Linhas da tela "Cardápio da mesa" (marca + preço + esconder). Itens OCULTOS aparecem
// aqui (esmaecidos, pra poder voltar) — é só dos CARDS da mesa que eles somem.
function menuEditorItems() {
  return allItems().map((it) => ({
    ...it,
    brand: it.brand || '',
    off: !!it.off,
    // placeholder do campo de marca = o que o item É sem marca (rótulo localizado)
    name: isDefault(it.id) ? t('item.' + it.id) : (it.name || ''),
  }));
}

// ---- Mesa ----
// ---- Tela acesa na mesa (Screen Wake Lock) ----
// Tela apagada = o navegador CONGELA o JS e derruba o WebRTC (regra de plataforma, Android e
// iOS) — era a "presença piscando". Enquanto você está NA MESA (e quer — settings.keepAwake,
// ligado de fábrica), seguramos a tela acesa: padrão dos apps de usar-na-mesa (mapas
// navegando, receitas, placar). Sem suporte (Safari <16.4) → falha em silêncio, fica como era.
// O sistema SOLTA o lock quando o app sai da frente — o visibilitychange re-adquire na volta.
let wakeLock = null, wakeReq = false;
async function acquireWakeLock() {
  // `wakeReq` fecha a corrida: voltar do background dispara visibilitychange E focus no mesmo
  // tick — sem o flag, as duas chamadas passavam o guard (wakeLock null) e pediam 2 locks (o 1º
  // vaza; o release dele depois zera o ref do 2º). Pós-await re-checa: saiu/escondeu na janela → solta.
  if (!room || !settings.keepAwake || document.hidden || wakeLock || wakeReq) return;
  wakeReq = true;
  try {
    const wl = await navigator.wakeLock.request('screen');
    if (!room || document.hidden) { try { wl.release(); } catch { /* ignore */ } return; }
    wakeLock = wl;
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch { /* sem suporte / economia de energia do sistema: segue a vida */ } finally { wakeReq = false; }
}
function releaseWakeLock() {
  try { if (wakeLock) wakeLock.release(); } catch { /* ignore */ }
  wakeLock = null;
}

// ---- Catch-up na volta (ver comentário no topo, perto de AWAY_HIDE_MS) ----
// Tira a foto do total da mesa quando o app some (esconder/bloquear a tela) — base do resumo.
function snapshotAway() {
  if (!room || awaySnap) return; // guarda a 1ª foto (esconder 2× sem voltar não sobrescreve)
  awaySnap = { at: Date.now(), total: tableTotal(state) };
}
// Voltou: a re-sync chega ASSÍNCRONA (reconexão + anti-entropy), então debounça — dispara ~1,8s
// depois do último evento sincronizado, com teto de 15s (mesa movimentada não segura o resumo).
function returnFromAway() {
  if (!room || !awaySnap) return;
  catchupPending = { total: awaySnap.total, deadline: Date.now() + CATCHUP_MAX_MS, startedAt: Date.now() };
  awaySnap = null;
  scheduleCatchup();
}
function scheduleCatchup() {
  if (!catchupPending) return;
  if (catchupTimer) clearTimeout(catchupTimer);
  const wait = Math.max(0, Math.min(CATCHUP_SETTLE_MS, catchupPending.deadline - Date.now()));
  catchupTimer = setTimeout(runCatchup, wait);
}
function runCatchup() {
  catchupTimer = null;
  const snap = catchupPending; catchupPending = null;
  if (!snap || !room) return;
  const d = tableTotal(state) - snap.total; // quanto a mesa andou enquanto você esteve fora
  dlog('sync', { ms: Date.now() - (snap.startedAt || Date.now()), delta: d }); // t.sync: quanto a re-sync demorou pra assentar
  if (d > 0) ui.toast(t('catchup.back', { n: d })); // silêncio se nada mudou (não cutuca à toa)
}
function clearCatchup() { // ao sair da mesa: zera tudo (não vaza o resumo pra próxima mesa)
  awaySnap = null; catchupPending = null;
  if (catchupTimer) { clearTimeout(catchupTimer); catchupTimer = null; }
}

async function enterTable(code, { create = false, pin = '', joined = false } = {}) {
  dlog('mesa.entrar', { sala: String(code || '').slice(0, 8), criei: !!create, entrei: !!joined });
  room = code; roomPin = pin; sessionStart = Date.now(); sessionMates = new Set();
  sessionJoined = joined; // entrei na mesa de alguém → o cardápio que sincronizar é "aprendido"
  autoCheckedIn = false; gpsBoteco = ''; menuRememberHinted = false; // sessão nova: zera flags de check-in/cardápio
  store.setCurrent(room);
  // A URL reflete a mesa JÁ AQUI, antes de abrir qualquer overlay: atribuir location.hash é
  // NAVEGAÇÃO (dispara popstate), e o "voltar fecha o overlay" (ui.js) entendia esse popstate
  // como VOLTAR do usuário — o convite recém-aberto era engolido no ato (piscava e fechava
  // sozinho ao criar a mesa). Com o hash primeiro, o popstate acha zero overlays (no-op) e o
  // marker do convite fica ACIMA da entrada #/mesa: fechar no ✕/voltar preserva a URL.
  location.hash = '#/mesa?room=' + room;
  rebuildFrom(store.getEvents(room));
  ui.showScreen('table');
  render();
  acquireWakeLock(); // tela acesa na mesa (se o usuário quer)
  if (!presTick) presTick = setInterval(scheduleRender, 30000); // relógio do 💤 anda mesmo com a mesa parada
  // estreante (1ª mesa da vida, ainda sem `tourSeen`) POUSA na mesa: o empty-state já guia e o tour
  // "O básico" roda sozinho — o convite fica a 1 toque no #btn-invite. Recorrente vê o convite na hora.
  if (create) { if (store.getFlag('tourSeen')) openInvite(); maybeSuggestByGps(); } // GPS: perto de um boteco conhecido? oferece o NOME dele
  maybeStartTour(); // 1ª mesa da vida: mostra o caminho das pedras (espera fechar o convite)

  const iceServers = await loadIce();
  if (room !== code) return;

  startMesh(iceServers);
}

// Entra numa mesa SEM depender de internet/signaling (fluxo do convite offline).
// ICE vazio => host candidates (mesma Wi-Fi/hotspot). O signaling ainda tenta em 2º
// plano (falha de boa) — se a internet voltar, a malha se completa sozinha.
function enterTableOffline(code) {
  room = code; roomPin = ''; sessionStart = Date.now(); sessionMates = new Set();
  sessionJoined = true; // pareamento offline = você entrou na mesa de alguém (scaneou o QR)
  store.setCurrent(room);
  location.hash = '#/mesa?room=' + room; // ANTES dos overlays — mesmo motivo do enterTable
  rebuildFrom(store.getEvents(room));
  ui.showScreen('table');
  render();
  acquireWakeLock();
  if (!presTick) presTick = setInterval(scheduleRender, 30000);
  maybeStartTour();
  startMesh([]);
}

function onMeshChange() {
  if (settings.dev && mesh) {
    const ps = mesh.peers();
    const sig = ps.filter((p) => p.online).map((p) => String(p.user).slice(0, 6)).sort().join(','); // presença: só a mudança
    if (sig !== lastMalha) { lastMalha = sig; dlog('malha', { on: sig || '(só eu)' }); }
    const tp = window.__sigTransport; // transporte da sinalização (ws↔poll): loga a virada
    if (tp && tp !== lastTransp) { lastTransp = tp; dlog('transporte', { t: tp }); }
    if (!meshConnLogged && mesh.connectedCount() > 0) { meshConnLogged = true; dlog('conexao', { ms: Date.now() - meshStartAt }); } // t.conexao
    for (const p of ps) { // versão de cada peer (mesa com versões diferentes = fonte real de bug)
      const key = p.user + '@' + p.ver;
      if (p.ver && !peerVersSeen.has(key)) { peerVersSeen.add(key); dlog('versao.peer', { de: String(p.user).slice(0, 6), v: p.ver, igual: p.ver === VERSION }); }
    }
    // P2P travado (NAT/firewall não deixa fechar o canal) — bug de campo clássico que só mora aqui
    for (const p of ps) if (p.stuck && !stuckLogged.has(p.user)) { stuckLogged.add(p.user); dlog('malha.travada', { de: String(p.user).slice(0, 6) }); }
  }
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
// Presença SERENA: queda de conexão NUNCA vira toast — tela apagada/elevador/bolso só
// esmaece o avatar (💤) na barra, pelo tempo que for; a volta reacende em silêncio.
// "👋 saiu" existe SÓ quando a pessoa sai DE VERDADE (fx 'bye' explícito do leaveTable).
// Padrão de mercado (Docs/Figma/WhatsApp): presença se MOSTRA na barra, não se anuncia.
// "entrou!" segue só na primeira vez da sessão.
function diffPresence() {
  if (!mesh) return;
  const cur = new Set(mesh.peers().filter((p) => p.online).map((p) => p.user));
  for (const u of cur) {
    const n = profOf(u).name; if (n) sessionMates.add(n);
    // voltou (do tchau, do fechar-o-app ou de um 💤 longo)? reentra na barra em silêncio
    saidBye.delete(u); leftQuiet.delete(u); awaySince.delete(u);
    // o gone só é cancelado por VOLTA de verdade (caiu e reapareceu) — no instante do fx a
    // página ainda está viva, e cancelar aí deixava o fechou-o-app pendurado 💤 pra sempre
    const g = goneAt.get(u); if (g && g.wentOff) { clearTimeout(g.tm); goneAt.delete(u); }
  }
  // relógio do 💤: anota QUANDO cada um caiu (alimenta o "12min" da barra e a arrumação de 1h)
  for (const p of mesh.peers()) if (!p.online) {
    if (!awaySince.has(p.user)) awaySince.set(p.user, Date.now());
    const g = goneAt.get(p.user); if (g) g.wentOff = true; // o gone viu a queda: volta agora = volta real
  }
  if (!presenceSeeded) { prevOnline = cur; presenceSeeded = true; for (const u of cur) everSeen.add(u); return; }
  for (const u of cur) {
    if (!prevOnline.has(u) && !everSeen.has(u)) { ui.toast(t('pres.joined', { name: profOf(u).name || t('common.someone') })); sound.pop(); }
    everSeen.add(u);
  }
  prevOnline = cur;
}

// Tchau explícito (quem toca "sair da mesa" avisa a mesa): o ÚNICO "saiu" que toasta.
// A pessoa sai da barra na hora; se voltar, ganha o "entrou!" de novo (everSeen zera).
// O bye é AUTORITATIVO: a conexão de quem saiu cai NA HORA (mesh.dropUser). Sem isso, o pc
// dele ficava meio-aberto parecendo "online" por até 12s (o close() remoto nem sempre chega) e
// qualquer mudança na malha nessa janela — alguém entrando, GC — rodava o diffPresence, que
// via o zumbi em `cur` e APAGAVA o saidBye ("voltou!") → quem saiu ressuscitava na barra como
// 💤 fantasma. Higiene P2P: só derruba se o bye veio pelo canal do PRÓPRIO dono (fromId) —
// bye forjado não desconecta os outros.
function receiveBye(fx, fromId) {
  // gate de identidade COMPLETO (o `bye` é direto do dono, nunca via gossip): sem ele, um bye
  // forjado (`from` = outra pessoa) já toastava "👋 fulano saiu" (falso) e sumia a vítima da
  // barra até o próximo diffPresence — o gate cobre TODO o efeito, não só o mesh.dropUser.
  if (!fx.from || fx.from !== fromId || fx.from === self) return;
  saidBye.add(fx.from); everSeen.delete(fx.from); prevOnline.delete(fx.from); awaySince.delete(fx.from);
  if (mesh) mesh.dropUser(fx.from);
  const name = (typeof fx.fromName === 'string' && fx.fromName.slice(0, 24)) || profOf(fx.from).name || t('common.someone');
  ui.toast(t('pres.bye', { name }));
  scheduleRender();
}

// Tchau EDUCADO (fechou o app/aba — pagehide manda 'gone' best-effort): NÃO toasta nada.
// Se a pessoa não voltar na graça (reload/atualização de SW voltam em segundos), sai da barra
// EM SILÊNCIO — e volta a valer o "entrou!" quando reaparecer. Quem morre SEM avisar
// (bateria, app morto à força) não manda gone: a arrumação de 1h (AWAY_HIDE_MS) cobre.
// Higiene P2P (mesmo gate do bye): só vale se veio pelo canal do PRÓPRIO dono — um gone
// forjado removeria da barra, em 45s e em silêncio, qualquer um que estivesse de tela apagada.
function receiveGone(fx, fromId) {
  if (!fx.from || fx.from !== fromId || fx.from === self || goneAt.has(fx.from)) return;
  const u = fx.from;
  goneAt.set(u, { wentOff: false, tm: setTimeout(() => {
    goneAt.delete(u);
    const on = mesh && mesh.peers().some((p) => p.user === u && p.online);
    if (!on) { leftQuiet.add(u); everSeen.delete(u); scheduleRender(); }
  }, GONE_GRACE_MS) });
}

// "há quanto tempo" curtinho pro 💤 (vazio nos primeiros 60s: piscada não ganha relógio)
function awayLabel(ms) {
  if (!ms || ms < 60000) return '';
  const min = Math.floor(ms / 60000);
  return min < 60 ? t('pres.agoMin', { n: min }) : t('pres.agoH', { n: Math.floor(min / 60) });
}

// Sonda SÓ-LEITURA do estado de presença (irmã do __sigTransport): os e2e despejam isto no
// diagnóstico quando uma espera de barra estoura — flake de CI vira dado, não mistério.
window.__presDbg = () => ({
  saidBye: [...saidBye], leftQuiet: [...leftQuiet],
  away: [...awaySince.entries()].map(([u, ts]) => ({ u, s: Math.round((Date.now() - ts) / 1000) })),
  gone: [...goneAt.keys()],
  peers: mesh ? mesh.peers().map((p) => ({ u: p.user, on: p.online, st: p.state, stuck: !!p.stuck })) : null,
});

function startMesh(iceServers) {
  if (mesh) { try { mesh.close(); } catch { /* ignore */ } mesh = null; } // nunca deixa malha órfã viva
  presenceSeeded = false; prevOnline = new Set();
  everSeen = new Set(); saidBye = new Set(); leftQuiet = new Set(); awaySince = new Map();
  for (const g of goneAt.values()) clearTimeout(g.tm); goneAt = new Map();
  meshStartAt = Date.now(); meshConnLogged = false; // 🐛 t.conexao: quanto a malha demora pra formar
  mesh = new Mesh({
    room: sigRoom(room, roomPin), code: room, selfId: self, name: getName(), ver: VERSION, iceServers,
    onEvent: onRemoteEvent, onFx, onPeersChange: onMeshChange, onStatus: onMeshChange,
    getSyncPayload: () => log,
  });
  // 🐛 espião do diário nos DOIS canos de fx (broadcast e canal direto): loga só kind/fase —
  // NUNCA o payload (a mão privada do dominó/truco viaja pelo sendTo; carta não entra em log)
  const rawSendFx = mesh.sendFx.bind(mesh);
  mesh.sendFx = (fx) => { dlog('fx.tx', { k: (fx && fx.kind) || '?', ph: (fx && fx.ph) || '' }); return rawSendFx(fx); };
  const rawSendTo = mesh.sendTo.bind(mesh);
  mesh.sendTo = (id, obj) => { if (obj && obj.k === 'fx' && obj.fx) dlog('fx.tx1', { k: obj.fx.kind || '?', ph: obj.fx.ph || '', p: String(id).slice(0, 6) }); return rawSendTo(id, obj); };
  mesh.start();
  // publica meu perfil (cor/avatar/foto) pra galera
  emitLocal(makeProfile({ color: settings.profColor || autoColor(self), emoji: settings.profEmoji || autoAvatar(self), driver: myDriver, level: myLevel(), photo: settings.profPhoto || '' }));
}

let meshGen = 0; // sobe a cada (re)start — a ICE que resolver TARDE de uma sessão antiga é descartada
function restartMesh() {
  if (mesh) { mesh.close(); mesh = null; }
  const myGen = ++meshGen, myRoom = room;
  // sem o gate: editar o PIN 2× rápido disparava 2 restart; a 1ª tinha mesh=null quando a 2ª
  // rodava (não fechava nada), e as DUAS resoluções de loadIce chamavam startMesh → 2 malhas
  // vivas com o mesmo selfId na mesma sala (presença duplicada + socket vazado). Só a última vale.
  loadIce().then((ice) => { if (room && room === myRoom && myGen === meshGen) startMesh(ice); });
}

async function loadIce() {
  const fallback = [{ urls: 'stun:stun.l.google.com:19302' }];
  const dis = armWatchdog('turn', 9000); // /turn pendurado (proxy lento) vira `pendurada {o:'turn'}`
  try {
    const r = await fetch('turn', { cache: 'no-store' });
    dis();
    if (r.status !== 200) return fallback;
    const d = await r.json();
    return Array.isArray(d.iceServers) && d.iceServers.length ? d.iceServers : fallback;
  } catch { dis(); return fallback; }
}

function myItems() {
  const m = {};
  for (const it of allItems()) { if (isShare(it)) continue; const n = getCount(state, self, it.id); if (n > 0) m[it.id] = n; }
  return m;
}
function leaveTable() {
  if (room) {
    dlog('mesa.sair', { titulo: tableInfo(state).title || '' });
    store.saveEvents(room, log);
    const info = tableInfo(state);
    const tt = tableTotal(state);
    // Só LEMBRA a mesa nas "recentes" se rolou consumo de verdade (alguém bebeu, tableTotal > 0).
    // Mesa aberta e fechada SEM nada é ruído: enchia as recentes com "0 · mesa 0" e virava "noite"
    // fantasma nos Meus Números/liga. A visita ao lugar NOMEADO já está no passaporte (check-in) e
    // o cardápio salva sozinho (bloco abaixo, fora deste if) — nada se perde ao não guardar a vazia.
    if (tt > 0) {
      store.pushHistory({
        room, at: Date.now(),
        myTotal: userTotal(state, self, resolveItem), tableTotal: tt,
        myMoney: userMoney(state, self, resolveItem),
        title: info.title || '',
        items: myItems(),
        mates: [...sessionMates],
        durationMs: sessionStart ? Date.now() - sessionStart : 0,
      });
    }
    // Lembra o cardápio DESTE boteco (pra recarregar quando você voltar). Mesa NOMEADA guarda
    // sob o nome (captura o cardápio mais completo). Mesa SEM nome semeia sob o check-in fresco
    // só se ainda NÃO tem cardápio lá — nunca sobrescreve um boteco conhecido a partir de uma
    // mesa anônima. Tudo local.
    if (state.items.size) {
      const defs = [...state.items.values()].map((r) => r.def).filter((d) => d && d.id);
      const fresh = freshCheckin();
      const seed = info.title || (fresh && !store.hasBotecoMenu(fresh) ? fresh : '');
      if (defs.length && seed) {
        const knew = store.hasBotecoMenu(seed); // já conhecia esse cardápio antes de salvar agora?
        dlog('boteco.salvo', { nome: seed, itens: defs.length });
        store.saveBotecoMenu(seed, defs);
        // Efeito de rede: entrei na mesa de ALGUÉM e aprendi um cardápio novo pela sincronização.
        ui.toast(sessionJoined && !knew ? t('toast.botecoLearned', { name: seed }) : t('toast.botecoSaved', { name: seed }));
      }
    }
  }
  // tchau EXPLÍCITO: avisa a mesa que eu SAÍ de verdade (o único "saiu" que vira toast lá)
  if (mesh) { try { mesh.sendFx({ kind: 'bye', from: self, fromName: getName() }); } catch { /* ignore */ } }
  releaseWakeLock();
  if (mesh) { mesh.close(); mesh = null; }
  store.clearCurrent();
  room = null; roomPin = ''; myDriver = false; offlineWaiting = false; gpsBoteco = '';
  lastTableMilestone = 0; sessionStart = 0; sessionJoined = false; lastAwards = [];
  prevOnline = new Set(); presenceSeeded = false; sessionMates = new Set();
  everSeen = new Set(); saidBye = new Set(); leftQuiet = new Set(); awaySince = new Map();
  for (const g of goneAt.values()) clearTimeout(g.tm); goneAt = new Map();
  tourArmed = false; // re-arma o tour se voltar pra uma mesa (o flag tourSeen ainda barra o 2º)
  if (presTick) { clearInterval(presTick); presTick = null; }
  clearCatchup(); // zera o resumo-da-volta (não vaza pra próxima mesa)
  purr = null; dom = null; dv = null; seenFx.clear(); purrPreFx = [];
  cancelTruco(false); trucoPreFx = [];
  domClearTimers(); gameMinned.clear(); ui.setGameMin('dom', false); ui.setGameMin('purr', false); ui.setGamePill(null);
  location.hash = '';
  ui.closeOverlays(); ui.showScreen('home'); ui.renderHome(store.getHistory(), meAvatar(), !!store.getFlag('tourSeen') || store.getHistory().length > 0);
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
  const bn = sessionBoteco(); if (bn) store.saveBotecoCouvert(bn, o.couvert); // couvert varia por bar → lembra por boteco (mesa anônima não salva)

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

  // arredonda as partes pra centavos SEM perder centavo: a soma das partes fecha o total exato
  // (antes R$10÷3 exibia 3,33×3 = 9,99 e o bar levava 1 centavo a menos)
  const cents = roundToCents(rows.map((r) => Math.max(0, final.get(r.user) || 0)));
  const out = rows.map((r, i) => {
    const p = profOf(r.user);
    const from = covers.get(r.user);
    return {
      user: r.user, name: p.name, color: p.color, emoji: p.emoji, photo: p.photo,
      amount: cents[i],
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
  // quem BANCOU o quê (rodadas/garrafas) — o quadro "🎁" do fechar a conta ("cada um nas suas costas")
  const byFrom = new Map();
  for (const l of settle(state, resolveItem).pledgeLines) {
    if (!byFrom.has(l.from)) byFrom.set(l.from, []);
    byFrom.get(l.from).push({ name: itemLabel(resolveItem(l.item)), units: l.units, amount: l.amount });
  }
  const bankrolls = [...byFrom].map(([from, items]) => ({ from, name: profOf(from).name || t('common.someoneLow'), items, total: items.reduce((a, x) => a + x.amount, 0) }));
  return { rows: out, total: out.reduce((a, r) => a + r.amount, 0), equal: o.equal, hasPrices: allItems().some((i) => i.price > 0), pool: poolVm, bankrolls };
}
function renderBill() {
  const b = computeBill(); lastBill = b;
  const note = b.hasPrices ? t('bill.noteCons') : t('bill.notePriceless');
  ui.renderBill({ rows: b.rows, total: b.total, equal: b.equal, note, canPix: !!settings.pixKey, selfId: self, pool: b.pool, bankrolls: b.bankrolls, hasNight: tableTotal(state) > 0 });
}

// ---- Jogo minimizado (✕ = minimizar; encerrar pra mesa toda é ação explícita) ----
// Fechar o overlay NÃO cancela mais a partida de ninguém: o jogo segue rolando por baixo
// (fx continuam aplicando/renderizando) e o pill na mesa traz de volta num toque. "Encerrar"
// pede confirmação e avisa a mesa com o nome de quem encerrou.
const gameMinned = new Set(); // 'dom' | 'purr'
// última config de cada jogo, pro "🫲 Jogar de novo" REPETIR na hora (mesmo modo/mesmos bots) sem
// re-abrir o setup — a tela de escolha fica SÓ pro caminho do grid "🎮 Jogos". Os HUMANOS são
// re-lidos frescos (quem está online AGORA); só o número de bots (botN) é preservado.
let lastPurr = null;  // { mode, botN }
let lastDom = null;   // { botN }
let lastTruco = null; // { variant, botN }
function purrActive() { return !!purr && purr.phase !== 'revealed' && purr.phase !== 'done'; }
// "jogo SOLO" = não há outro HUMANO no jogo além de mim (só eu + bots). Solo fecha no ✕ SEM
// cerimônia: nada de minimizar/pill/confirmação "pra mesa toda" (não há mesa pra avisar).
function soloGame(kind) {
  let ids = [];
  if (kind === 'purr') ids = purr ? purr.entrants.map((e) => e.id) : [];
  else if (kind === 'dom') ids = (dom && dom.order) || (dv && dv.order) || [];
  else if (kind === 'truco') ids = truco ? truco.order : [];
  return ids.filter((id) => !isBot(id)).length <= 1;
}
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
  armGameStall(); // 🐛 estado de jogo mudou (jogada/presença) → re-arma o vigia de "jogo parado"
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
  dlog('sw.update', { v: VERSION }); // versão nova aplicando (o "meu app tá velho" vira diagnóstico)
  ui.toast(t('sw.updating'));
  setTimeout(() => { try { w.postMessage('SKIP_WAITING'); } catch { /* já ativou */ } }, 1200);
}

// ---- Tour do Botequei (trilhas curtas; a 1ª mesa roda "O básico" sozinha) ----
// Paradas com `pre` ABREM a tela de verdade (clique real — menu, jogos); o motor do tour
// (ui.js) parte da mesa limpa a cada parada e fecha tudo no fim. Trilha concluída ganha ✓
// no índice (flag local `tourDone_*`) — dá pra rever quantas vezes quiser.
const openMenuPre = () => document.getElementById('btn-menu').click();
const openInvitePre = () => document.getElementById('btn-invite').click();      // → convite (nome da mesa)
const openMePre = () => { const m = document.querySelector('.pres-me'); if (m) m.click(); }; // seu rosto na barra → hub
const openSetPre = () => { openMePre(); const s = document.getElementById('me-settings'); if (s) s.click(); }; // hub → configs
function tourTrails() {
  // mesa nova nasce LIMPA → a 1ª parada do básico aponta o botão que abre o catálogo; se já
  // tem cards (entrou numa mesa rodando), ensina o toque no card
  const hasCards = !!document.querySelector('.item-card');
  return [
    { id: 'basico', emoji: '🍺', label: t('tour.trail.basico'), steps: [
      hasCards
        ? { sel: '.item-card', title: t('tour.t1'), text: t('tour.x1') }
        : { sel: '#btn-empty-custom', title: t('tour.t0'), text: t('tour.x0') },
      { sel: '.total-hero', title: t('tour.t2'), text: t('tour.x2') },
      { sel: '#btn-games', title: t('tour.t3'), text: t('tour.x3') },
      { sel: '#btn-menu', title: t('tour.t4'), text: t('tour.x4') },
    ] },
    { id: 'conta', emoji: '💸', label: t('tour.trail.conta'), steps: [
      { sel: '#btn-rodada', title: t('tour.tc1'), text: t('tour.xc1') },
      { sel: '#menu-bill', pre: openMenuPre, title: t('tour.tc3'), text: t('tour.xc3') },
      { sel: '#menu-prices', pre: openMenuPre, title: t('tour.tc4'), text: t('tour.xc4') },
    ] },
    { id: 'diversao', emoji: '🎮', label: t('tour.trail.diversao'), steps: [
      { sel: '#games-grid', pre: () => document.getElementById('btn-games').click(), title: t('tour.td1'), text: t('tour.xd1') },
      { sel: '#btn-react', title: t('tour.td2'), text: t('tour.xd2') },
      { sel: '#menu-waiter', pre: openMenuPre, title: t('tour.td4'), text: t('tour.xd4') },
    ] },
    { id: 'mesaviva', emoji: '📊', label: t('tour.trail.mesaviva'), steps: [
      { sel: '#presence-bar', title: t('tour.tv1'), text: t('tour.xv1') }, // só com gente na mesa (sozinho, pula)
      { sel: '#btn-peers', title: t('tour.tv2'), text: t('tour.xv2') },
      { sel: '.pres-me', title: t('tour.tv3'), text: t('tour.xv3') }, // seu rosto na barra abre o hub (perfil/números/config)
    ] },
    { id: 'botecos', emoji: '🗺️', label: t('tour.trail.botecos'), steps: [
      { sel: '#table-name-input', pre: openInvitePre, title: t('tour.tb1'), text: t('tour.xb1') }, // nomear a mesa = o bar
      { sel: '#me-passport', pre: openMePre, title: t('tour.tb2'), text: t('tour.xb2') },
      { sel: '#menu-prices', pre: openMenuPre, title: t('tour.tb3'), text: t('tour.xb3') },
      { sel: '#set-geo', pre: openSetPre, title: t('tour.tb4'), text: t('tour.xb4') },
    ] },
    { id: 'canto', emoji: '👤', label: t('tour.trail.canto'), steps: [
      { sel: '#me-profile', pre: openMePre, title: t('tour.tk1'), text: t('tour.xk1') },
      { sel: '#me-stats', pre: openMePre, title: t('tour.tk2'), text: t('tour.xk2') }, // Números (rolê/liga dentro); só com histórico
      { sel: '#me-settings', pre: openMePre, title: t('tour.tk4'), text: t('tour.xk4') },
    ] },
  ];
}
function startTrail(id) {
  const tr = tourTrails().find((x) => x.id === id);
  if (!tr) return;
  ui.startTour(tr.steps, (completed) => {
    if (!completed) return; // pulou: sem ✓
    store.setFlag('tourDone_' + id);
  });
}
let tourArmed = false;
function maybeStartTour() {
  if (store.getFlag('tourSeen') || tourArmed) return; // sem `tourArmed`, criar a mesa 2× rápido
  tourArmed = true;                                    // armava 2 intervalos → tour/tema em dobro
  const tick = setInterval(() => {
    if (!room) { clearInterval(tick); tourArmed = false; return; } // saiu antes do tour começar
    if (document.querySelector('.overlay:not([hidden])')) return; // convite/QR ainda aberto
    // VALOR ANTES DE GUIA: espera o 1º +1 (a mesa "andou"). O empty-state + o hint "👆 toque = +1"
    // ensinam o primeiro toque sozinhos; aí o tour entra pra mostrar o RESTO (a trilha já troca o
    // passo 1 pro card real quando há card). Sem +1, sem tour automático (dá pra abrir no "🎓" à mão).
    if (tableTotal(state) <= 0) return;
    clearInterval(tick); tourArmed = false;
    if (store.getFlag('tourSeen')) return; // outra chamada já mostrou nesse meio-tempo
    store.setFlag('tourSeen'); // marca ao MOSTRAR (pular também conta como visto)
    // 1ª mesa da vida = só a trilha básica (curta); o resto mora no "🎓 Tour do Botequei".
    // (o tema segue o sistema por padrão — 'auto', igual ao idioma — então o fim do tour NÃO pergunta mais nada)
    startTrail('basico');
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
  lastPurr = { mode, botN }; // guarda a config pro "jogar de novo" repetir sem re-perguntar
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
  if (r.loserId === self) offerLoserPay(purr ? purr.entrants.map((e) => e.id) : null);
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
    if (loser === self) { sound.alarm(); ui.vibrate([80, 40, 80]); offerLoserPay(purr ? purr.entrants.map((e) => e.id) : null); } else { sound.cheers(); ui.celebrate(['🫲', '🍀', '🍻']); }
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
    if (loser === self) { sound.alarm(); ui.vibrate([80, 40, 80]); offerLoserPay(purr ? purr.entrants.map((e) => e.id) : null); } else { sound.cheers(); ui.celebrate(['🥢', '🍀', '🍻']); }
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
    openTile: d.firstTile.slice(), // a ABERTURA (maior carroça) — âncora do tabuleiro (fica no meio)
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
  else { sound.alarm(); ui.vibrate([80, 40, 80]); if (dom.winner && dom.order.length === 2) offerLoserPay(dom.order); } // 2p: perdedor único
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
    anchor: dom.openTile ? dom.chain.findIndex((t) => domKey(t) === domKey(dom.openTile)) : -1, // âncora = abertura

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
  lastDom = { botN }; // guarda a config pro "jogar de novo" repetir sem re-perguntar
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
  const fail = (reason) => { dom.audit = { ok: false, reason }; devShotAuto('trapaca:domino'); renderDom(); ui.toast('🚫 ' + reason); };
  const seeds = dom.vinfo.seeds || {}, seedCommits = dom.vinfo.seedCommits || {};
  // cross-check (best-effort): os seeds/lacres do vdeal batem com os que EU coletei direto no handshake?
  if (dv) for (const id of dom.order) {
    if (dv.seedCommits && dv.seedCommits[id] && dv.seedCommits[id] !== seedCommits[id]) return fail(t('dom.vSeedCommitSwap', { name: domName(id) }));
    if (dv.seeds && dv.seeds[id] && dv.seeds[id] !== seeds[id]) return fail(t('dom.vSeedSwap', { name: domName(id) }));
  }
  for (const id of dom.order) { // cada um revelou a mesma mão que lacrou?
    const c = await handCommit(dom.opens[id].hand, dom.opens[id].salt);
    if (!dom || !dom.opens[id]) return; // fechou o ✕ no meio da cripto (~ms): não estoura
    if (c !== dom.vinfo.handCommits[id]) return fail(t('dom.vHandDiff', { name: domName(id) }));
  }
  const initialHands = dom.order.map((id) => dom.opens[id].hand);
  const audit = await verifyDeal({ deck: dom.revealedDeck, salt: dom.revealedSalt, deckCommit: dom.vinfo.deckCommit, seeds, seedCommits, players: dom.order.length, initialHands });
  if (!dom) return; // idem: jogo encerrado durante o await do verifyDeal
  dom.audit = audit;
  if (!audit.ok) devShotAuto('trapaca:domino'); // embaralho adulterado pego → 📸 automática
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
  // 3 HUMANOS → 2v2 + 1 bot (todos jogam; antes o 3º era fatiado fora, calado). 4+ → 2v2 sem bot.
  // 2 → 1v1. Sozinho → 1 bot pra ter com quem jogar. (Só o DEFAULT sugerido; o picker ainda ajusta.)
  ui.trucoStartChoice({ mode: n >= 3 ? '2v2' : '1v1', botsDefault: n < 2 ? 1 : (n === 3 ? 1 : 0) });
}
function startTrucoVariant(variant, botN = 0) {
  if (!TRU_VARIANTS[variant]) return;
  lastTruco = { variant, botN }; // guarda a config pro "jogar de novo" repetir sem re-perguntar
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
  else { sound.alarm(); ui.vibrate([80, 40, 80]); offerLoserPay(truco ? truco.order : null); } // oferta em cada perdedor (1v1 e dupla)
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
}

// ---- Cerimônia de fim de noite ----
function openCeremony() {
  lastAwards = ceremonyAwards(state, resolveItem, { log, now: Date.now() });
  ui.openCeremony({ awards: lastAwards });
}

// ---- Meus números (o Retrô/rolê e a Liga fundiram AQUI: célula 🤝 + "compartilhar meu rolê" + liga) ----
function openStats() {
  const hist = store.getHistory();
  const now = Date.now();
  const s = lifeStats(hist, { now });
  // favorita: o histórico guarda só o ID; item CUSTOM vive nos cardápios salvos — resolve por lá
  // ANTES do catálogo (espelha o openBotecoFicha), pra não sair como id cru/genérico.
  const savedFav = (id) => { for (const m of store.listBotecoMenus()) { const d = (m.defs || []).find((x) => x.id === id); if (d) return d; } return null; };
  const favDef = s.favDrink ? (savedFav(s.favDrink) || resolveItem(s.favDrink)) : null;
  const favName = favDef ? itemLabel(favDef) : '';
  // retro() dá o topMate (célula 🤝) E o objeto do card "meu rolê" (o botão de compartilhar reusa este)
  const r = retro(hist, { now });
  lastRetro = { ...r, favEmoji: favDef ? favDef.emoji : '', favName };
  renderLeagueInfo(); // liga/desafios/temporada moraram do Placar pra cá — pinta antes de mostrar
  ui.openStats({
    stats: s, badges: lifeBadges(s), history: hist,
    favEmoji: favDef ? favDef.emoji : '', favName,
    trend: monthlyTrend(hist, { now, months: 6 }),
    insight: weekdayInsight(hist),
    topMate: r.topMate,
  });
}

// Comanda de uma pessoa (o que ela pediu).
function openComanda(user) {
  const p = profOf(user);
  const s = settle(state, resolveItem); // uma passada só: cobertura, pago e dinheiro saem daqui
  const K = (i) => user + '\x00' + i;
  const rows = [];
  for (const it of allItems()) {
    if (isShare(it)) continue; // item DA MESA não é consumo PESSOAL: o dinheiro vive no bolo/rateio,
    const n = getCount(state, user, it.id); // não na comanda de quem tocou (senão superconta e joga
    if (n <= 0) continue;                   // a garrafa inteira no bolso dele — contradiz placar/conta)
    // unidades que OUTRO bancou (rodada/crédito): conta no ×N, mas o dinheiro é de quem pagou.
    const cov = s.covered.get(K(it.id)) || 0;
    const charged = Math.max(0, n - cov);
    rows.push({ emoji: it.emoji, name: it.name, n, money: (it.price || 0) * charged, note: cov > 0 ? t('comanda.covered', { n: cov }) : (it.note || '') });
  }
  // unidades que a pessoa BANCOU (perdeu o jogo / rodada / garrafa): aparecem na comanda dela
  for (const it of allItems()) { const n = s.paidUnits.get(K(it.id)) || 0; if (n > 0) rows.push({ emoji: '💸', name: t('comanda.paid', { item: itemLabel(it) }), n, money: (it.price || 0) * n, note: '' }); }
  // se a pessoa está 💤, a comanda diz DESDE QUANDO (ajuda a decidir se "foi embora de vez")
  const net = mesh ? mesh.peers().find((x) => x.user === user) : null;
  const since = net && !net.online ? awaySince.get(user) : 0;
  ui.openComanda({ user, name: p.name, emoji: p.emoji, rows, total: userTotal(state, user, resolveItem), money: s.money.get(user) || 0,
    away: since ? t('comanda.away', { time: new Date(since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }) : '',
    // AÇÕES da comanda (cobrar dali): quem sou eu, se já banco essa pessoa (PAYFOR) e se tenho chave PIX
    isSelf: user === self, iPayThem: paysFor(state, self, user), canPix: !!settings.pixKey });
}

function myLevel() { return levelFor(lifeStats(store.getHistory(), { now: Date.now() })).level; }

// ---- Liga & desafios (renderizada DENTRO de Meus Números — o Placar ficou 100% mesa) ----
function renderLeagueInfo() {
  const now = Date.now();
  const hist = store.getHistory();
  const current = room ? { at: now, items: myItems() } : null;
  ui.renderLeague({ level: levelFor(lifeStats(hist, { now })), challenges: weeklyChallenges(hist, current, { now }), season: seasonAward(hist, { now }) });
}

// ---- Passaporte + ficha do boteco (reusados pelos handlers e pelo refresh pós renomear/apagar) ----
function openPassportView() {
  ui.openPassport({
    checkins: store.getCheckins(),
    keyOf: store.botecoKey,
    menuKeys: store.listBotecoMenus().map((m) => store.botecoKey(m.name)), // lugares com cardápio salvo
  });
}
// Ficha do boteco (toca num lugar no passaporte): cruza check-in + histórico + cardápio salvo
// (agregação pura no lifestats). Tudo local.
function openBotecoFicha(name) {
  const profs = botecoProfiles(store.getHistory(), store.getCheckins(), store.listBotecoMenus(), store.botecoKey);
  const p = profs.find((x) => x.key === store.botecoKey(name)) || { name, visits: 0, spent: 0, favDrink: '', favN: 0, lastAt: 0 };
  const menu = store.getBotecoMenu(name);
  // nome da favorita: o histórico só guarda o ID; o cardápio salvo do boteco tem o nome do
  // item custom — resolve por ele primeiro, senão cai no catálogo (item padrão).
  const favDef = p.favDrink ? (menu.find((d) => d.id === p.favDrink) || resolveItem(p.favDrink)) : null;
  ui.openBoteco({
    name: p.name || name,
    visits: p.visits, spent: p.spent, lastAt: p.lastAt,
    fav: favDef ? { emoji: favDef.emoji, name: itemLabel(favDef), n: p.favN } : null,
    menu: menu.map((d) => ({ emoji: d.emoji, name: itemLabel(d), price: d.price || 0 })),
  });
}

// ---- Handlers ----
// ---- 🐛 Relatório do modo dev: fotografia COMPLETA e local do app pra caçar bug em campo ----
// O que entra: versão, aparelho, PERMISSÕES (localização/câmera — o estado 'prompt' pendurado é
// exatamente o que come check-in), storage, settings, flags, check-ins, cardápios salvos, resumo
// do histórico, mesa aberta e o diário. Redação: a foto de perfil NUNCA vai (só o tamanho).
// Compartilhar é gesto SEU: Web Share (mesmo motor da foto da noite); sem suporte → baixa o .json.
async function permState(name) {
  try { const s = await navigator.permissions.query({ name }); return s.state; } catch { return 'n/d'; }
}
const REPORT_LOG_CAP = 5000; // teto de segurança do log completo no relatório (uma noite cabe folgado)
// Evento redigido: a única coisa pesada/privada num evento é a FOTO do PROFILE — sai; o resto
// (tipo/user/ts/eventId/def de preço) fica pra eu REPLAYAR o reducer aqui e reproduzir o bug.
function redactEv(ev) { const o = { ...ev }; delete o.photo; if (o.def && o.def.photo) o.def = { ...o.def, photo: `(${String(o.def.photo).length})` }; return o; }
// Impressão digital do estado: quando DOIS celulares divergem ("meu diz 12, o dela 10"), cada um
// manda isto e eu acho o ponto exato da divergência (total + contagem por tipo + último eventId).
function stateFingerprint() {
  const porTipo = {};
  for (const e of log) porTipo[e.type] = (porTipo[e.type] || 0) + 1;
  const last = log[log.length - 1];
  return { meuId: self.slice(0, 6), totalMesa: room ? tableTotal(state) : 0, eventos: log.length, porTipo,
    ultimoEventId: last && last.eventId ? String(last.eventId).slice(-10) : '', desvioRelogioMs: maxSkew };
}
// Resumo pra triagem num olhar (contado do próprio diário): erros/penduradas/console/jogo parado…
function diarySummary(d) {
  const c = (k) => d.reduce((n, e) => n + (e.k === k ? 1 : 0), 0);
  return { linhas: d.length, erros: c('erro'), penduradas: c('pendurada'),
    consoleErros: d.reduce((n, e) => n + (e.k === 'console' && e.n === 'error' ? 1 : 0), 0),
    jogoParado: c('jogo.parado'), lentas: c('lenta'), relogioSuspeito: c('relogio') > 0 };
}
async function buildDevReport() {
  const s = { ...settings };
  if (s.profPhoto) s.profPhoto = `(foto: ${s.profPhoto.length} chars)`; // nunca a imagem em si
  if (s.pixKey) s.pixKey = s.pixKey.slice(0, 3) + `…(${s.pixKey.length})`; // PII: mascarada
  let est = null;
  try { est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch { /* n/d */ }
  const [geo, cam] = await Promise.all([permState('geolocation'), permState('camera')]);
  let reg = null;
  try { reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null; } catch { /* n/d */ }
  const diario = store.getDevLog();
  const scan = store.storageScan();
  const evLog = log.slice(-REPORT_LOG_CAP).map(redactEv); // log da mesa REDIGIDO — dá pra replayar aqui
  return {
    tipo: 'botequei-relatorio', formatoV: 3, versao: verLabel(VERSION), serial: VERSION, gerado: new Date().toISOString(),
    resumo: diarySummary(diario), // ← triagem no topo
    navegador: navigator.userAgent, idioma: navigator.language, online: navigator.onLine,
    instalado: window.matchMedia('(display-mode: standalone)').matches, toques: navigator.maxTouchPoints || 0,
    permissoes: { localizacao: geo, camera: cam },
    storage: est ? { usadoKB: Math.round((est.usage || 0) / 1024), tetoKB: Math.round((est.quota || 0) / 1024) } : null,
    storageChaves: scan.sizes, storageCorrompido: scan.corrompidos, // tamanho por chave + JSON podre
    sw: reg ? { controlando: !!navigator.serviceWorker.controller, esperando: !!reg.waiting, instalando: !!reg.installing } : { controlando: !!(navigator.serviceWorker && navigator.serviceWorker.controller) },
    settings: s, flags: store.getFlags(),
    checkins: store.getCheckins(),
    cardapios: store.listBotecoMenus().map((m) => ({ nome: m.name, itens: (m.defs || []).length, em: m.at })),
    historicoTotal: store.getHistory().length,
    historico: store.getHistory().slice(0, 10).map((h) => ({ titulo: h.title || '', em: h.at, gasto: h.myMoney || 0 })),
    mesa: room ? { sala: room, titulo: tableInfo(state).title || '', eventos: log.length, itens: state.items.size } : null,
    impressaoDigital: stateFingerprint(), // total + porTipo + últimoEventId → casa divergência entre 2 aparelhos
    // raio-x ao vivo: transporte, peers (com VERSÃO e tipo de conexão), presença (sonda __presDbg do CI),
    // onde a pessoa está na UI e o jogo em curso (público)
    transporte: typeof window.__sigTransport === 'string' ? window.__sigTransport : 'n/d',
    peers: mesh ? mesh.peers().map((p) => ({ de: String(p.user).slice(0, 6), online: p.online, conn: p.conn || '', v: p.ver || '' })) : [],
    presenca: (() => { try { return window.__presDbg ? window.__presDbg() : null; } catch { return null; } })(),
    tela: telaCtx(),
    jogo: gameSnapshot(),
    logMesa: evLog, // log COMPLETO (redigido) — replay do reducer reproduz bug de conta/consumo
    logTruncado: log.length > REPORT_LOG_CAP,
    diario,
  };
}
async function shareDevReport() {
  const rep = await buildDevReport();
  window.__devReport = rep; // raio-x p/ e2e (padrão __presDbg)
  const txt = JSON.stringify(rep, null, 2);
  const d = new Date(); const p2 = (n) => String(n).padStart(2, '0');
  const fname = `botequei-relatorio-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}.json`;
  try {
    const file = new File([txt], fname, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Botequei — relatório' });
      return; // o sheet do sistema já é o feedback
    }
  } catch (e) { if (e && e.name === 'AbortError') return; /* desistiu do share: não força o download */ }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'application/json' }));
  a.download = fname; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  ui.toast(t('toast.reportSaved'));
}

// ---- "Meus dados": raio-x (contagem+tamanho por categoria) + refresh da home sob o painel ----
// Tudo LOCAL. O painel LÊ os tamanhos do mesmo storageScan() do relatório do modo dev e conta
// dos getters — nenhuma fonte de verdade nova (regra da casa: uma fonte só).
function dataVM() {
  const { sizes } = store.storageScan();
  const bytesOf = (pred) => Object.keys(sizes).reduce((a, k) => a + (pred(k) ? sizes[k] : 0), 0);
  const hist = store.getHistory(), checks = store.getCheckins(), menus = store.listBotecoMenus(), dev = store.getDevLog();
  return {
    perfil: { name: getName(), set: !!(getName() || settings.profPhoto || settings.profColor || settings.profEmoji), bytes: (getName() || '').length + (settings.profPhoto || '').length },
    mesas: { count: hist.length, bytes: bytesOf((k) => k === 'botequei.history' || k === 'botequei.current' || k.startsWith('botequei.log.')) },
    passaporte: { count: checks.length, bytes: sizes['botequei.passport'] || 0 },
    cardapios: { count: menus.length, bytes: (sizes['botequei.botecomenu'] || 0) + (sizes['botequei.botecocouvert'] || 0) },
    dev: { count: dev.length, bytes: sizes['botequei.devlog'] || 0, show: !!store.getFlag('devUnlocked') || dev.length > 0 },
    totalBytes: bytesOf((k) => k.startsWith('botequei.')),
  };
}
// repinta a home (contadores/atalhos/avatar) por baixo do painel aberto — os deletes granulares
// mexem no histórico/perfil que a home mostra; sem reload (só a bomba atômica recarrega).
function refreshHome() { ui.renderHome(store.getHistory(), meAvatar(), !!store.getFlag('tourSeen') || store.getHistory().length > 0); }

const handlers = {
  onName: (v) => setName(v),
  onCreate: () => { if (!getName()) { ui.toast(t('toast.needName')); return; } enterTable(newRoomCode(), { create: true }); },
  onJoinCode: (code) => {
    code = (code || '').trim().toUpperCase();
    if (!code) { ui.toast(t('toast.needCode')); return; }
    pendingJoin = code; pendingPin = false;
    if (getName()) enterTable(code, { joined: true }); else ui.openJoin(code, false);
  },
  onJoinConfirm: (name, pin) => {
    const n = setName(name);
    if (!n) { ui.toast(t('toast.needNick')); return; }
    ui.closeOverlays();
    if (pendingJoin) enterTable(pendingJoin, { pin: pendingPin ? (pin || '').trim() : '', joined: true });
  },
  onLeave: leaveTable,
  onAdd: (item) => act('ADD', item),
  onRemove: (item) => act('REMOVE', item),
  onAddItemConfirm: addCustomItem,
  onInvite: openInvite,
  onPeers: () => { renderPeers(); ui.openPeers(); }, // placar = 100% A MESA (a liga mora nos Meus Números)
  onBrinde, onReact,
  onPayRound: () => openPayRound(), // 💸 Rodada do dock: você paga uma rodada pra mesa (picker → paga → chama o garçom)
  onPayPick: (id) => payRoundGo(id),
  onBrindeGo: () => sound.cheers(),
  // hub do "Você": avatar no canto da home / seu rosto na barra da mesa → tudo que é pessoal num lugar só
  onMe: () => ui.openMe({ ...meAvatar(), name: getName(), hasHistory: store.getHistory().length > 0 }),
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
  onBill: () => {
    // sem NENHUM preço no cardápio, por-consumo dá tudo R$0 → abre JÁ no "rachar igual" (default útil).
    const noPrices = !allItems().some((i) => i.price > 0);
    const bn = sessionBoteco();
    ui.openBill({ tipPct: settings.tipPct, equalDefault: noPrices, couvert: bn ? store.getBotecoCouvert(bn) : 0 });
    renderBill();
  },
  onBillChange: renderBill,
  onBillShare: async () => {
    if (!lastBill) renderBill();
    const info = tableInfo(state);
    const res = await shareBill(lastBill, (info.emoji ? info.emoji + ' ' : '') + (info.title || 'A conta')).catch(() => 'error');
    if (res === 'download') ui.toast(t('toast.imgSaved')); else if (res === 'error') ui.toast(t('toast.imgError'));
  },
  onPayFor: (user, on) => { emitLocal(makePayFor({ to: user, on })); renderBill(); },
  // captura a chave PIX no fechar a conta (quando não estava configurada): grava e re-renderiza →
  // agora canPix é true → os botões PIX por linha aparecem e o bloco de captura some.
  onBillSetPix: (key) => { if (!key) return; settings = setSettings({ pixKey: key }); renderBill(); ui.toast(t('bill.pixSaved')); },
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
  onNoteChange: (id, note) => {
    const it = resolveItem(id);
    // descrição é DADO da mesa (LWW): "Garrafa 600ml"… vazio = sem descrição no card
    emitLocal(makeItem({ ...it, note: String(note || '').trim().slice(0, 40) }));
    render();
  },
  onPix: (user) => {
    if (!settings.pixKey) { ui.toast(t('toast.pixConfig')); return; }
    if (!lastBill) renderBill(); // cobrar direto da COMANDA: garante o cálculo mesmo sem abrir a conta (espelha onBillShare)
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
  // tocar no jogo no grid: JÁ rolando → VOLTA pra ele (não destrói a partida); senão abre a escolha de modo
  onPurrinha: () => { if (purrActive()) { reopenGame('purr'); return; } startPurrinha(); },
  onPurrStart: (mode, botN) => startPurrinhaMode(mode, botN),
  onPurrAgain: () => { if (lastPurr) startPurrinhaMode(lastPurr.mode, lastPurr.botN); else startPurrinha(); }, // "de novo" REPETE a última config
  onPurrSeal: (hand, guess) => (purr && purr.mode !== 'fast' ? purrSealHand(hand) : purrSeal(hand, guess)),
  onPurrGuess: (n) => myPurrGuess(n),
  // ✕: SOLO (só eu + bots) encerra direto (sem cerimônia — não há mesa pra avisar); com mesa, minimiza (a partida segue; pill traz de volta).
  onPurrClose: () => {
    if (purrActive()) {
      if (soloGame('purr')) { cancelPurrinha(false); clearGameMin('purr'); ui.closeOverlays(); return; }
      minimizeGame('purr'); return;
    }
    purr = null; clearGameMin('purr'); ui.closeOverlays();
  },
  // dominó: JÁ rolando → VOLTA; ≥2 humanos → começa DIRETO (a "tela de espera" É o handshake); solo → picker (precisa de bot)
  onDomino: () => {
    if ((dom && !dom.over) || (dv && !dv.began && !dom)) { reopenGame('dom'); return; }
    if (domEntrants().length >= 2) { startDominoVerified(0); return; }
    ui.dominoStartChoice({ botsDefault: 1 });
  },
  onDomStart: (botN) => startDominoVerified(botN), // sempre mesa verificada (regras iguais; só o embaralho é auditável)
  onDomAgain: () => startDominoVerified(lastDom ? lastDom.botN : (domEntrants().length < 2 ? 1 : 0)), // "de novo" REPETE a última config
  onTruco: () => { if (truco && !truco.over) { reopenGame('truco'); return; } startTruco(); }, // JÁ rolando → VOLTA; senão abre a escolha
  onTrucoStart: (variant, botN) => startTrucoVariant(variant, botN),
  // "de novo" REPETE a última config. (O truco não tem botão "de novo" na tela hoje — ✕/grid re-entram; o handler existe pra paridade com purr/dom.)
  onTruAgain: () => { if (lastTruco) startTrucoVariant(lastTruco.variant, lastTruco.botN); else startTruco(); },
  onTrucoPlay: (card) => myTruPlay(card),
  onTrucoRaise: myTruRaise,
  onTrucoResp: (r) => myTruResp(r),
  onTrucoOnze: (play) => myTruOnze(play),
  onTrucoEnv: (k) => myTruEnv(k),
  onTrucoEnvResp: (r) => myTruEnvResp(r),
  onTrucoFlor: () => myTruFlor(),
  // ✕: SOLO encerra direto (sem cerimônia); com mesa, minimiza (a partida segue; pill traz de volta).
  onTrucoClose: () => {
    if (truco && !truco.over) {
      if (soloGame('truco')) { cancelTruco(false); clearGameMin('truco'); ui.closeOverlays(); return; }
      minimizeGame('truco'); return;
    }
    cancelTruco(false); clearGameMin('truco'); ui.closeOverlays();
  },
  onDomPlay: (key, side) => myDomPlay(key, side),
  onDomPass: myDomPass,
  // ✕: SOLO encerra direto (sem cerimônia); com mesa, minimiza (a partida segue no outro; pill traz de volta).
  onDomClose: () => {
    const active = (dom && !dom.over) || (dv && !dv.began && !dom);
    if (active && soloGame('dom')) { dom = null; dv = null; domClearTimers(); clearGameMin('dom'); ui.closeOverlays(); return; }
    if (active) { minimizeGame('dom'); return; }
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
  // "🎓 Tour do Botequei" (menu "…"): índice de trilhas com ✓ nas concluídas
  onTourMenu: () => { if (room) ui.openTour({ trails: tourTrails().map((tr) => ({ id: tr.id, emoji: tr.emoji, label: tr.label, done: !!store.getFlag('tourDone_' + tr.id) })) }); },
  onTourTrail: (id) => { ui.closeOverlays(); startTrail(id); },
  // Passaporte de botecos (check-ins locais, opcionalmente com GPS)
  onPassport: () => openPassportView(),
  onBoteco: (name) => openBotecoFicha(name),
  // Renomeia o LUGAR INTEIRO (cardápio salvo + check-ins + histórico) e re-renderiza a ficha + o
  // passaporte por baixo, pra o novo nome aparecer nos dois sem reabrir nada.
  onBotecoRename: (oldName, newName) => {
    const nn = (newName || '').trim();
    if (!nn) { ui.toast(t('boteco.renameEmpty')); return; }
    if (nn !== oldName) { store.renameBoteco(oldName, nn); ui.toast(t('boteco.renameDone', { name: nn })); }
    openPassportView(); openBotecoFicha(nn);
  },
  // Apaga só o CARDÁPIO salvo do lugar (check-ins/histórico continuam). Confirma antes (destrutivo).
  onBotecoDelMenu: (name) => {
    if (!store.hasBotecoMenu(name)) return;
    ui.actionToast(t('boteco.delConfirm', { name }), t('boteco.delGo'), () => {
      store.deleteBotecoMenu(name);
      ui.toast(t('boteco.delDone'));
      openPassportView(); openBotecoFicha(name); // ficha sem cardápio + passaporte sem o selo 📓
    }, 8000);
  },
  // "Carregar numa mesa nova": abre uma mesa, nomeia com o boteco e re-emite o cardápio salvo
  // (mesmo caminho do onLoadBoteco). A ficha abre da HOME, então criar a mesa aqui é o fluxo.
  onBotecoLoadNew: async (name) => {
    if (!getName()) { ui.toast(t('toast.needName')); return; }
    const defs = store.getBotecoMenu(name);
    if (!defs.length) return;
    ui.closeOverlays();
    await enterTable(newRoomCode(), { create: true });
    setTable({ title: name });
    dlog('boteco.carregado', { nome: name, itens: defs.length, de: 'ficha' });
    let n = 0;
    for (const d of defs) if (d && d.id && emitLocal(makeItem(d))) n++;
    if (n) { render(); botecoLoadedToast(defs, n); }
  },
  // Carrega o cardápio salvo do boteco (nome da mesa OU último check-in fresco): re-emite cada
  // item como evento ITEM — aparece na mesa E espalha pra turma pela malha (CRDT). Dá nome à
  // mesa sem título ("cola" o boteco na sessão) pra o de-sair guardar as adições certas.
  onLoadBoteco: () => {
    if (!room) return;
    const bn = sessionBoteco();
    const defs = store.getBotecoMenu(bn);
    if (!defs.length) return;
    if (!tableInfo(state).title && bn) setTable({ title: bn });
    dlog('boteco.carregado', { nome: bn, itens: defs.length, de: 'mesa' });
    let n = 0;
    for (const d of defs) if (d && d.id && emitLocal(makeItem(d))) n++;
    if (n) { render(); botecoLoadedToast(defs, n); }
  },
  onShakeToggle: (on) => { settings = setSettings({ shake: !!on }); if (on) enableShake(); else disableShake(); ui.toast(on ? t('toast.shakeOn') : t('toast.shakeOff')); },
  // Switch da localização: desligar = o app para de usar (limpa o boteco por GPS). Ligar = pede a
  // permissão AGORA (o clique é o gesto); recusar cai no geoDeny (volta o switch pra off + aviso).
  onGeoToggle: (on) => {
    settings = setSettings({ geo: !!on });
    if (!on) { gpsBoteco = ''; ui.toast(t('toast.geoOff')); return; }
    if (!navigator.geolocation) { settings = setSettings({ geo: false }); ui.fillSettings(settings); ui.toast(t('toast.geoDenied')); return; }
    ui.toast(t('toast.gettingPlace'));
    geoGet('toggle',
      () => { ui.toast(t('toast.geoOn')); if (room && !state.items.size) maybeSuggestByGps(); },
      geoDeny, GEO_OPTS);
  },
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
  // 🐛 Modo dev: liga/desliga o diário técnico (o marco de ligar já entra no diário)
  onDevToggle: (on) => {
    settings = setSettings({ dev: !!on });
    ui.setDevHook(on ? (k, d) => dlog(k, d) : null); // liga/desliga o espião da ui junto
    ui.setDevFab(!!on); // e o 📸 flutuante aparece/some junto
    dlog('dev', { on: on ? 1 : 0 });
    ui.toast(t(on ? 'toast.devOn' : 'toast.devOff'));
  },
  onDevReport: () => shareDevReport(),
  // 3º caminho além de share/baixar: copia o relatório pra área de transferência (colar direto na conversa)
  onDevCopy: async () => {
    const rep = await buildDevReport(); window.__devReport = rep;
    try { await navigator.clipboard.writeText(JSON.stringify(rep, null, 2)); ui.toast(t('toast.devCopied')); }
    catch { ui.toast(t('toast.devCopyFail')); }
  },
  // Visor do diário DENTRO do app (últimas 50 linhas): espia na hora, sem exportar nada
  onDevView: () => ui.renderDevLog(store.getDevLog().slice(-50)),
  // 📸 "print" TEXTUAL da tela agora: onde estou + o que o sheet mostra + fase do jogo.
  // (Página web não tira screenshot de pixels de si mesma no Android — a API de captura não
  // existe no Chrome mobile; pro depurar, o ESTADO vale mais que o pixel.)
  onDevShot: () => {
    const alvo = document.querySelector('.overlay:not([hidden]) .sheet') || document.querySelector('.screen.is-active');
    const jogo = gameSnapshot();
    dlog('foto.tela', { ...telaCtx(), ...(jogo ? { jogo: JSON.stringify(jogo) } : {}), texto: alvo ? alvo.innerText.replace(/\s+/g, ' ').slice(0, 400) : '' });
    ui.toast(t('toast.devShot'));
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
  onCopyLink: async () => { try { await navigator.clipboard.writeText(inviteUrl()); ui.toast(t('toast.linkCopied')); } catch { ui.toast(inviteUrl()); } },
  onShareInvite: async () => { try { await navigator.share({ title: 'Botequei', text: t('inv.shareText'), url: inviteUrl() }); } catch { /* cancelado */ } },
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
    if ('keepAwake' in patch) { if (settings.keepAwake) acquireWakeLock(); else releaseWakeLock(); }
    if (room) render();
  },
  // rodapé das configs: confere AGORA se há versão nova (reg.update() re-baixa o sw.js do
  // servidor — a mesma pergunta que o secundário faz ao primário no DNS). Achou → o fluxo de
  // auto-update assume (toast "atualizando…" e aplica); não achou → "está na última";
  // sem rede → diz a versão sem prometer nada.
  onCheckUpdate: async () => {
    // 🐛 Destravar o modo dev à la Android: 7 toques SEGUIDOS na versão (<1,6s entre eles).
    // Rajada não re-confere atualização — só o 1º toque pergunta ao servidor; do 4º ao 6º um
    // toast conta quantos faltam; no 7º a seção 🐛 aparece nas configs (e a flag fica pra sempre).
    const now = Date.now();
    verTaps = now - verTapAt < 1600 ? verTaps + 1 : 1; verTapAt = now;
    if (verTaps >= 2) {
      if (store.getFlag('devUnlocked')) return; // já destravado: rajada não faz nada
      if (verTaps >= 7) { store.setFlag('devUnlocked'); ui.showDev(true); ui.toast(t('dev.unlocked')); sound.pop(); return; }
      if (verTaps >= 4) ui.toast(t('dev.count', { n: 7 - verTaps }));
      return;
    }
    ui.toast(t('ver.checking'));
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
      if (reg) {
        await reg.update();
        if (reg.waiting || reg.installing) return; // versão nova baixando: o auto-update toasta e aplica
      }
      ui.toast(t('ver.latest', { v: verLabel(VERSION) }));
    } catch {
      ui.toast(t('ver.offline', { v: verLabel(VERSION) }));
    }
  },
  // ---- 🗄️ Meus dados: painel de transparência + deleção GRANULAR (por categoria/item/lugar) ----
  // Tudo é LOCAL: apagar aqui NÃO mexe na cópia dos outros aparelhos (a mesa vive em CRDT em cada
  // um) — o painel diz isso na cara. Todo delete confirma (actionToast) e repinta painel+home.
  onOpenData: () => ui.openData(dataVM()),
  // Sobre o Botequei: monta o "me paga um chopp" (PIX do dev — chave fixa, doação sem valor) e abre.
  onOpenSobre: () => {
    const pixKey = 'andre@felicio.com.br';
    const pixCode = pixPayload({ key: pixKey, name: 'Botequei', city: 'BRASIL', description: 'Chopp pro dev' });
    let qrNode; try { qrNode = makeQR(pixCode); } catch { qrNode = null; }
    ui.openSobre({ qrNode, pixCode, pixKey });
  },
  onDataClear: (cat) => {
    const done = () => { ui.toast(t('data.cleared')); ui.openData(dataVM()); refreshHome(); };
    const ask = (msgKey, doIt) => ui.actionToast(t(msgKey), t('data.confirmDo'), doIt);
    if (cat === 'perfil') return ask('data.confPerfil', () => {
      setName(''); ui.setNameInput('');
      settings = setSettings({ profColor: '', profEmoji: '', profPhoto: '' });
      // na mesa, re-emite um PROFILE anônimo (cor/emoji automáticos) pra a turma ver a mudança na hora
      if (room) { emitLocal(makeProfile({ color: autoColor(self), emoji: autoAvatar(self), driver: myDriver, level: myLevel(), photo: '' })); render(); }
      done();
    });
    if (cat === 'mesas') return ask('data.confMesas', () => { store.clearHistory(); done(); });
    if (cat === 'passaporte') return ask('data.confPass', () => { store.clearCheckins(); done(); });
    if (cat === 'cardapios') return ask('data.confMenus', () => { store.clearBotecoMenus(); done(); });
    if (cat === 'dev') return ask('data.confDev', () => { store.clearDevLog(); done(); });
    if (cat === 'tour') return ask('data.confTour', () => { store.resetOnboarding(); done(); });
  },
  // in-context: apagar UMA mesa (na home) / UM check-in (no passaporte) / um LUGAR inteiro (na ficha)
  onDeleteMesa: (r) => ui.actionToast(t('data.confDelMesa'), t('data.confirmDo'), () => { store.removeHistory(r); refreshHome(); ui.toast(t('data.deleted')); }),
  onDeleteCheckin: (at) => ui.actionToast(t('data.confDelCheckin'), t('data.confirmDo'), () => { store.removeCheckin(Number(at)); openPassportView(); ui.toast(t('data.deleted')); }),
  onDeletePlaceAll: (name) => ui.actionToast(t('data.confDelPlace', { name: name }), t('data.confirmDo'), () => { store.deletePlace(name); ui.closeOverlays(); ui.toast(t('data.placeGone')); openPassportView(); }),
  // 🧨 a bomba atômica (agora COM confirmação — antes apagava direto): tudo deste aparelho, reload.
  onClearData: () => ui.actionToast(t('data.confAll'), t('data.confAllDo'), () => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('botequei.')) localStorage.removeItem(k);
    location.reload();
  }),
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
  // 🐛 migalhas de AÇÃO: embrulha todo handler UMA vez — cada toque seu vira linha no diário
  // (no-op com o modo dev desligado). O argumento entra truncado, MENOS onde é pessoal
  // (PIN, importação de backup); digitação de nome nem entra (uma linha por tecla é ruído).
  const SEM_ARG = /^on(ImportData|\w*Pin\w*)$/;
  const SEM_LOG = new Set(['onName']);
  for (const k of Object.keys(handlers)) {
    const f = handlers[k];
    if (typeof f !== 'function' || SEM_LOG.has(k)) continue;
    handlers[k] = (...a) => {
      const v = a[0];
      dlog('acao', !SEM_ARG.test(k) && (typeof v === 'string' || typeof v === 'number') ? { h: k, a: String(v).slice(0, 24) } : { h: k });
      return f(...a);
    };
  }
  // toasts + jornada de telas/overlays (o "print" textual) — hook instalado SÓ com o modo dev
  // ligado (custo zero desligado; o onDevToggle liga/desliga junto do switch)
  ui.setDevHook(settings.dev ? (k, d) => dlog(k, d) : null);
  ui.init(handlers);
  ui.applyTheme(settings);
  ui.applyLang(settings.lang);
  sound.setEnabled(settings.sound);
  if (settings.shake) enableShake();
  ui.setNameInput(getName());
  ui.renderHome(store.getHistory(), meAvatar(), !!store.getFlag('tourSeen') || store.getHistory().length > 0);
  ui.showDev(store.getFlag('devUnlocked')); // seção 🐛 já destravada uma vez? aparece desde o boot
  ui.setDevFab(settings.dev); // 📸 flutuante já no boot se o modo dev estiver ligado
  dlog('boot', { v: VERSION, pwa: window.matchMedia('(display-mode: standalone)').matches });

  const inv = parseInvite();
  const q = new URLSearchParams(location.search); // atalhos do PWA (long-press no ícone do app)
  if (inv) {
    pendingJoin = inv.room; pendingPin = inv.needPin;
    if (getName() && !inv.needPin) enterTable(inv.room, { joined: true });
    else ui.openJoin(inv.room, inv.needPin);
  } else if (q.has('nova') || q.has('entrar')) {
    // shortcuts do manifest: "Criar mesa" (?nova=1) abre criar; "Entrar por código" (?entrar=1)
    // foca o campo de código. Limpa o param na hora pra um reload não re-disparar.
    const nova = q.has('nova');
    history.replaceState(null, '', location.pathname);
    if (nova) handlers.onCreate(); else ui.focusCode();
  } else if (!getName() && !store.getHistory().length && !store.getFlag('welcomeSeen')) {
    store.setFlag('welcomeSeen'); // marca AO MOSTRAR: reload (ex.: troca de SW) não repete o guia
    ui.openWelcome(); // primeiro uso: guia rápido (sem convite pendente)
  }
  ui.focusNameSoft(); // foco suave no apelido: só se a home está ativa, SEM overlay e o campo vazio (self-guarded)

  // fechar o app/aba manda o tchau EDUCADO ('gone', best-effort): a mesa NÃO toasta, só tira
  // da barra se a pessoa não voltar na graça (reload/atualização de SW voltam em segundos)
  window.addEventListener('pagehide', () => {
    if (!room) return;
    store.saveEvents(room, log);
    if (mesh) { try { mesh.sendFx({ kind: 'gone', from: self }); } catch { /* ignore */ } mesh.sig.leave(); }
  });
  const wake = () => {
    if (document.hidden !== lastHidden) { lastHidden = document.hidden; dlog('tela', { oculta: document.hidden }); }
    if (document.hidden) { snapshotAway(); return; } // sumiu (bloqueou a tela / trocou de app): fotografa a mesa
    if (mesh) mesh.wake();
    acquireWakeLock();
    returnFromAway(); // voltou: monta o resumo do que rolou enquanto esteve fora (após a re-sync assentar)
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
  // enquanto o usuário não escolher manualmente, segue o tema claro/escuro do sistema
  try { window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (settings.theme !== 'light' && settings.theme !== 'dark') ui.applyTheme(settings); }); } catch { /* ignore */ }

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; ui.showInstall(true); });
  // instalou (pelo nosso botão OU pelo menu do navegador) → some com o "📲 Instalar", larga o
  // prompt guardado e dá o empurrãozinho: abrir pela tela inicial roda em tela cheia (standalone)
  window.addEventListener('appinstalled', () => { deferredPrompt = null; ui.showInstall(false); ui.toast(t('toast.installed')); });
  // iOS não dispara beforeinstallprompt — se ainda não está instalado (standalone), mostra o
  // "📲 Instalar" mesmo assim; tocar explica "Compartilhar → Adicionar à Tela" (sem deferredPrompt
  // cai no toast.installHint). Uma vez instalado, o app roda standalone e o botão some sozinho.
  try {
    const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent || '');
    const standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    if (iOS && !standalone) ui.showInstall(true);
  } catch { /* ignore */ }

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
