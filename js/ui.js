// Camada de apresentacao: telas, cards, gestos, efeitos sociais, placar, conta, configs.
// Nao guarda estado do dominio — renderiza o "view model" do app.js e dispara handlers.

import { EMOJIS, COLORS, AVATARS, CATEGORIES } from './catalog.js';
import { scanQR, scanSupported } from './scan.js';
import * as music from './music.js';
import { applyI18n, setLang, t } from './i18n.js';

const $ = (id) => document.getElementById(id);
let H = {};
const el = {};

const IDS = [
  'screen-home', 'screen-table', 'input-name', 'input-code', 'btn-create', 'btn-join-code',
  'home-history', 'history-list', 'home-hint', 'home-extras', 'btn-install', 'btn-settings', 'btn-stats', 'btn-retro', 'btn-bar', 'btn-passport',
  'table-title', 'mesa-code', 'my-total', 'table-total', 'money-block', 'my-money', 'peer-count', 'table-hint', 'hero-fill',
  'conn-banner', 'hh-banner', 'presence-bar', 'items-grid', 'btn-additem', 'btn-invite', 'btn-leave', 'btn-peers', 'btn-menu',
  'btn-brinde', 'btn-react', 'btn-rodada', 'btn-games', 'overlay-games', 'games-grid',
  'overlay-invite', 'qr-wrap', 'big-code', 'table-name-input', 'table-emoji-btn', 'table-emoji-row', 'invite-pin',
  'btn-copy-link', 'btn-share-invite', 'btn-nfc',
  'overlay-join', 'join-code-label', 'join-name', 'join-pin-field', 'join-pin', 'btn-join-confirm',
  'overlay-peers', 'mvp-banner', 'peers-list', 'my-badges',
  'overlay-menu', 'menu-profile', 'menu-board', 'menu-pace', 'menu-safe', 'menu-roulette',
  'menu-water', 'menu-jukebox', 'menu-festa', 'menu-card', 'menu-tournament', 'menu-bill', 'menu-prices',
  'menu-hh', 'menu-waiter', 'menu-bebedeira', 'menu-ceremony', 'menu-photo', 'menu-share', 'menu-stats', 'menu-settings',
  'overlay-prices', 'price-list', 'btn-save-menu',
  'overlay-profile', 'profile-name', 'profile-colors', 'profile-avatars', 'profile-driver', 'btn-profile-save',
  'profile-preview', 'profile-preview-emoji', 'profile-photo-img', 'btn-avatar-selfie', 'btn-avatar-upload', 'avatar-file',
  'overlay-crop', 'crop-canvas', 'crop-zoom', 'btn-crop-use',
  'overlay-additem', 'emoji-row', 'add-name', 'add-cat', 'add-price', 'add-note', 'btn-additem-confirm',
  'overlay-bill', 'bill-note', 'bill-tips', 'bill-couvert', 'bill-equal', 'bill-list', 'bill-total', 'btn-bill-share',
  'overlay-pix', 'pix-title', 'pix-qr', 'pix-code', 'btn-pix-copy',
  'overlay-settings', 'set-theme', 'set-bigfont', 'set-sound', 'set-limit', 'set-water', 'set-nudges',
  'set-lang', 'set-weight', 'set-sex', 'set-responsa', 'set-carapp', 'set-trustname', 'set-trustphone',
  'set-pixkey', 'set-pixcity', 'btn-export-data', 'btn-import-data', 'import-file', 'btn-clear-data',
  'overlay-react', 'react-row', 'overlay-hh',
  'overlay-pace', 'pace-summary', 'pace-bar', 'pace-label', 'pace-chart', 'pace-bac', 'pace-coach',
  'overlay-roulette', 'roulette-list', 'roulette-result', 'btn-roulette-spin',
  'overlay-poke', 'poke-title', 'poke-actions',
  'overlay-ceremony', 'ceremony-list', 'btn-ceremony-share', 'btn-ceremony-broadcast',
  'overlay-stats', 'stats-grid', 'stats-badges', 'stats-chart', 'stats-chart-h', 'stats-insight', 'stats-history',
  'overlay-comanda', 'comanda-title', 'comanda-list', 'comanda-total',
  'overlay-safe', 'safe-verdict', 'safe-rows', 'btn-safe-car', 'btn-safe-trust', 'btn-safe-home',
  'overlay-jukebox', 'jukebox-input', 'btn-jukebox-add', 'jukebox-list',
  'overlay-festa', 'festa-canvas', 'btn-festa-close',
  'set-shake',
  'overlay-tournament', 'tourn-list', 'btn-tourn-add', 'btn-tourn-reset',
  'overlay-card', 'card-draw', 'btn-card-again', 'btn-card-show',
  'menu-purrinha', 'overlay-purrinha', 'purr-sub', 'purr-setup', 'purr-pick', 'purr-pstatus', 'purr-hands', 'purr-guess-wrap', 'purr-guesses', 'btn-purr-seal',
  'purr-wait', 'purr-waitcount', 'purr-waitsub', 'purr-seals',
  'purr-guessing', 'purr-status', 'purr-said', 'purr-turnrow', 'purr-gpick', 'btn-purr-say',
  'purr-result', 'purr-rstatus', 'purr-total', 'purr-reveals', 'purr-verdict',
  'btn-purr-again', 'btn-purr-close', 'btn-purr-end',
  'menu-domino', 'menu-truco', 'overlay-domino', 'btn-dom-close', 'dom-setup', 'dom-game', 'dom-verified',
  'dom-opps', 'dom-turn', 'dom-board', 'dom-result',
  'dom-hand-wrap', 'dom-hand', 'dom-side-pick', 'btn-dom-L', 'btn-dom-R', 'dom-endL', 'dom-endR',
  'btn-dom-pass', 'btn-dom-again', 'btn-dom-end', 'game-pill',
  'tour', 'tour-spot', 'tour-balloon', 'tour-count', 'tour-title', 'tour-text', 'btn-tour-skip', 'btn-tour-next',
  'overlay-themepick', 'themepick-row',
  'overlay-truco', 'btn-tru-close', 'tru-setup', 'tru-game', 'tru-status', 'tru-score', 'tru-vira', 'tru-table',
  'tru-hand', 'tru-actions', 'tru-result', 'btn-tru-end', 'tru-audit',
  'overlay-passport', 'passport-count', 'passport-name', 'btn-passport-checkin', 'passport-list',
  'overlay-photo', 'photo-wrap', 'btn-photo-retake', 'btn-photo-share', 'photo-input',
  'overlay-welcome', 'btn-welcome-go',
  'overlay-retro', 'retro-slides', 'btn-retro-share',
  'league-level', 'league-challenges', 'league-season',
  'overlay-bar', 'bar-code', 'bar-usemenu-field', 'bar-usemenu', 'bar-menu-count', 'btn-bar-open',
  'btn-offline-join', 'btn-offline-host',
  'overlay-offline', 'off-host', 'off-guest',
  'off-offer-qr', 'off-offer-code', 'btn-off-copy-offer', 'btn-off-scan-answer', 'off-answer-in', 'btn-off-connect',
  'off-offer-in', 'btn-off-scan-offer', 'btn-off-genanswer', 'off-answer-out', 'off-answer-qr', 'off-answer-code', 'btn-off-copy-answer',
  'overlay-scan', 'scan-title', 'scan-video', 'scan-hint', 'btn-scan-close',
  'fx-layer', 'brinde', 'brinde-count', 'brinde-word',
  'bebedeira', 'bebedeira-item', 'bebedeira-count', 'bebedeira-plus', 'btn-bebedeira-exit', 'toast',
];

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function cssq(s) { return String(s).replace(/["\\]/g, '\\$&'); }
// Cor vinda da rede vai para style="background:..."; esc() nao barra ';' de CSS.
// So aceitamos hex (#abc/#aabbcc/#aabbccdd) ou nome CSS simples; senao, cor padrao.
function safeColor(c) { return /^#[0-9a-f]{3,8}$|^[a-z]+$/i.test(String(c || '')) ? String(c) : '#333'; }
// Miolo do avatar: foto (miniatura) quando tem, senão emoji. O guard espelha o cleanPhoto
// do events.js — NUNCA injeta src cru vindo da rede. fill=true preenche círculo de tamanho
// fixo (.peer-avatar/.pres-av); senão .av-mini acompanha o font-size do emoji local.
function safePhoto(ph) { return typeof ph === 'string' && /^data:image\/[a-z.+-]+;base64,[A-Za-z0-9+/=]+$/.test(ph) && ph.length <= 20000 ? ph : ''; }
function avInner(photo, emoji, fill = true) {
  const ph = safePhoto(photo);
  if (!ph) return esc(emoji || '🍺');
  return `<img class="${fill ? 'av-img' : 'av-mini'}" src="${ph}" alt="" />`;
}
function fmtMoney(v) { return 'R$' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
// Anima um inteiro do valor atual até o novo (a conta "sobe" em vez de trocar seco).
function countTo(node, to) {
  to = Math.round(Number(to) || 0);
  const from = Math.round(Number(node.dataset.v) || 0);
  node.dataset.v = String(to);
  if (from === to) { node.textContent = String(to); return; }
  const dur = Math.min(600, 160 + Math.abs(to - from) * 45);
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const t0 = now();
  const tick = () => {
    if (Number(node.dataset.v) !== to) return; // outro countTo assumiu este nó
    const p = Math.min(1, (now() - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3); // easeOut
    node.textContent = String(Math.round(from + (to - from) * e));
    if (p < 1) requestAnimationFrame(tick); else node.textContent = String(to);
  };
  requestAnimationFrame(tick);
}

export function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch { /* ignore */ } }

// ---------- Gesto: toque curto vs toque longo ----------
function attachGesture(node, onTap, onLong) {
  let timer = null, longFired = false, sx = 0, sy = 0, active = false;
  const LONG = 480, MOVE = 14;
  const cancel = () => { active = false; if (timer) { clearTimeout(timer); timer = null; } };
  node.addEventListener('pointerdown', (e) => {
    active = true; longFired = false; sx = e.clientX; sy = e.clientY;
    try { node.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    timer = setTimeout(() => { if (active) { longFired = true; onLong(); } }, LONG);
  });
  node.addEventListener('pointermove', (e) => {
    if (active && (Math.abs(e.clientX - sx) > MOVE || Math.abs(e.clientY - sy) > MOVE)) cancel();
  });
  node.addEventListener('pointerup', (e) => { if (active && !longFired) onTap(); cancel(); e.preventDefault(); });
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---------- Init ----------
export function init(handlers) {
  H = handlers;
  IDS.forEach((id) => { el[id] = $(id); });

  el['btn-create'].addEventListener('click', () => H.onCreate());
  el['btn-join-code'].addEventListener('click', () => H.onJoinCode(el['input-code'].value));
  el['input-name'].addEventListener('change', () => H.onName(el['input-name'].value));
  el['btn-settings'].addEventListener('click', () => openSettings());
  el['btn-install'].addEventListener('click', () => H.onInstall());
  el['btn-stats'].addEventListener('click', () => H.onStats());
  el['btn-retro'].addEventListener('click', () => H.onRetro());
  el['btn-bar'].addEventListener('click', () => H.onBarMode());
  el['btn-passport'].addEventListener('click', () => H.onPassport());

  // sair da mesa pede confirmação (um toque errado no ‹ não te derruba da mesa)
  $('btn-leave').addEventListener('click', () => actionToast(t('menu.leaveQ'), t('menu.leaveDo'), () => H.onLeave()));
  $('btn-invite').addEventListener('click', () => H.onInvite());
  $('btn-peers').addEventListener('click', () => H.onPeers());
  $('money-block').addEventListener('click', () => H.onBill()); // tocar na conta abre "Fechar a conta"
  $('btn-menu').addEventListener('click', () => { el['overlay-menu'].hidden = false; });
  $('btn-games').addEventListener('click', () => openGames());
  $('btn-additem').addEventListener('click', () => openAddItem());
  $('btn-brinde').addEventListener('click', () => H.onBrinde());
  $('btn-react').addEventListener('click', () => openReact());
  $('btn-rodada').addEventListener('click', () => H.onRodada());

  $('btn-additem-confirm').addEventListener('click', () => submitAddItem());
  $('btn-join-confirm').addEventListener('click', () => H.onJoinConfirm(el['join-name'].value, el['join-pin'].value));
  $('btn-copy-link').addEventListener('click', () => H.onCopyLink());
  $('btn-share-invite').addEventListener('click', () => H.onShareInvite());
  $('btn-nfc').addEventListener('click', () => H.onNfc());
  el['table-name-input'].addEventListener('change', () => H.onTableName(el['table-name-input'].value));
  el['table-emoji-btn'].addEventListener('click', () => el['table-emoji-row'].hidden = !el['table-emoji-row'].hidden);
  el['invite-pin'].addEventListener('change', () => H.onInvitePin(el['invite-pin'].value));

  // menu
  $('menu-profile').addEventListener('click', () => { closeOverlays(); H.onProfile(); });
  $('menu-board').addEventListener('click', () => { closeOverlays(); H.onPeers(); });
  $('menu-pace').addEventListener('click', () => { closeOverlays(); H.onPace(); });
  $('menu-safe').addEventListener('click', () => { closeOverlays(); H.onSafe(); });
  $('menu-roulette').addEventListener('click', () => { closeOverlays(); H.onRoulette(); });
  $('menu-purrinha').addEventListener('click', () => { closeOverlays(); H.onPurrinha(); });
  $('menu-domino').addEventListener('click', () => { closeOverlays(); H.onDomino(); });
  $('menu-truco').addEventListener('click', () => { closeOverlays(); H.onTruco(); });
  $('menu-water').addEventListener('click', () => { closeOverlays(); H.onWaterRound(); });
  $('menu-jukebox').addEventListener('click', () => { closeOverlays(); H.onJukebox(); });
  $('menu-festa').addEventListener('click', () => { closeOverlays(); openFesta(); });
  $('menu-card').addEventListener('click', () => { closeOverlays(); H.onCard(); });
  $('menu-tournament').addEventListener('click', () => { closeOverlays(); H.onTournament(); });
  $('menu-bill').addEventListener('click', () => { closeOverlays(); H.onBill(); });
  $('menu-prices').addEventListener('click', () => { closeOverlays(); H.onPrices(); });
  $('menu-hh').addEventListener('click', () => { closeOverlays(); el['overlay-hh'].hidden = false; });
  $('menu-waiter').addEventListener('click', () => { closeOverlays(); H.onWaiter(); });
  $('menu-bebedeira').addEventListener('click', () => { closeOverlays(); H.onBebedeira(); });
  $('menu-ceremony').addEventListener('click', () => { closeOverlays(); H.onCeremony(); });
  $('menu-photo').addEventListener('click', () => { closeOverlays(); el['photo-input'].click(); });
  $('menu-share').addEventListener('click', () => { closeOverlays(); H.onShareNight(); });
  $('menu-stats').addEventListener('click', () => { closeOverlays(); H.onStats(); });
  $('menu-settings').addEventListener('click', () => { closeOverlays(); openSettings(); });
  el['overlay-hh'].querySelectorAll('button[data-min]').forEach((b) => b.addEventListener('click', () => { H.onHappyHour(Number(b.dataset.min)); closeOverlays(); }));

  // roleta / cerimônia
  el['btn-roulette-spin'].addEventListener('click', () => H.onRouletteSpin());
  el['btn-ceremony-share'].addEventListener('click', () => H.onCeremonyShare());
  el['btn-ceremony-broadcast'].addEventListener('click', () => H.onCeremonyBroadcast());

  // segurança / retrô / liga / modo bar
  el['btn-save-menu'].addEventListener('click', () => H.onSaveMenu());
  el['btn-safe-car'].addEventListener('click', () => H.onCallCar());
  el['btn-safe-trust'].addEventListener('click', () => H.onTrustContact());
  el['btn-retro-share'].addEventListener('click', () => H.onRetroShare());
  el['btn-bar-open'].addEventListener('click', () => H.onBarOpenTable(el['bar-code'].value, el['bar-usemenu'].checked));
  el['btn-safe-home'].addEventListener('click', () => H.onGoHome());
  el['btn-jukebox-add'].addEventListener('click', () => submitSong());
  el['btn-festa-close'].addEventListener('click', () => closeOverlays());
  el['btn-tourn-add'].addEventListener('click', () => H.onTournamentAdd());
  el['btn-tourn-reset'].addEventListener('click', () => H.onTournamentReset());
  el['btn-card-again'].addEventListener('click', () => H.onCard());
  el['btn-card-show'].addEventListener('click', () => H.onCardShow());
  el['btn-purr-seal'].addEventListener('click', () => {
    if (purrPick.hand == null || (!purrClassic && purrPick.guess == null)) return;
    H.onPurrSeal(purrPick.hand, purrPick.guess);
  });
  el['btn-purr-say'].addEventListener('click', () => { if (purrSaid != null) H.onPurrGuess(purrSaid); });
  el['btn-purr-again'].addEventListener('click', () => H.onPurrinha());
  el['btn-purr-close'].addEventListener('click', () => H.onPurrClose()); // minimiza (jogo segue); encerrar é o botão explícito
  el['btn-purr-end'].addEventListener('click', () => H.onPurrEnd());
  el['btn-dom-pass'].addEventListener('click', () => H.onDomPass());
  el['btn-dom-again'].addEventListener('click', () => H.onDomino());
  el['btn-dom-close'].addEventListener('click', () => H.onDomClose());
  el['btn-dom-end'].addEventListener('click', () => H.onDomEnd());
  el['game-pill'].addEventListener('click', () => H.onGameBack());
  el['btn-tru-close'].addEventListener('click', () => H.onTrucoClose());
  el['btn-tru-end'].addEventListener('click', () => H.onTrucoEnd());
  // tour: tocar em qualquer lugar avança; "pular" encerra
  el['tour'].addEventListener('click', () => tourNext());
  el['btn-tour-next'].addEventListener('click', (e) => { e.stopPropagation(); tourNext(); });
  el['btn-tour-skip'].addEventListener('click', (e) => { e.stopPropagation(); endTour(); });

  // escolha de tema (fim do tour): um toque aplica e fecha
  el['themepick-row'].querySelectorAll('button[data-th]').forEach((b) =>
    b.addEventListener('click', () => { H.onThemePick(b.dataset.th); closeOverlays(); }));
  el['btn-dom-L'].addEventListener('click', () => { if (domArmed) H.onDomPlay(domArmed, 'L'); domArmed = null; el['dom-side-pick'].hidden = true; });
  el['btn-dom-R'].addEventListener('click', () => { if (domArmed) H.onDomPlay(domArmed, 'R'); domArmed = null; el['dom-side-pick'].hidden = true; });
  el['btn-passport-checkin'].addEventListener('click', () => H.onCheckin(el['passport-name'].value));
  el['photo-input'].addEventListener('change', () => showPhoto());
  el['btn-photo-retake'].addEventListener('click', () => el['photo-input'].click());
  el['btn-photo-share'].addEventListener('click', () => H.onPhotoShare());
  el['btn-welcome-go'].addEventListener('click', () => closeOverlays());

  $('btn-profile-save').addEventListener('click', () => submitProfile());
  // foto de perfil: selfie/galeria compartilham o MESMO input (só troca o capture)
  el['btn-avatar-selfie'].addEventListener('click', () => openAvatarPicker(true));
  el['btn-avatar-upload'].addEventListener('click', () => openAvatarPicker(false));
  el['avatar-file'].addEventListener('change', () => avatarFilePicked());
  el['btn-crop-use'].addEventListener('click', () => cropUse());
  bindCrop();
  $('btn-pix-copy').addEventListener('click', () => H.onPixCopy());

  // conta: recalcular ao mudar opcoes + presets de gorjeta + compartilhar
  ['bill-couvert', 'bill-equal'].forEach((id) => {
    el[id].addEventListener('change', () => H.onBillChange());
    el[id].addEventListener('input', () => H.onBillChange());
  });
  el['bill-tips'].querySelectorAll('button[data-tip]').forEach((b) => b.addEventListener('click', () => { billTip = Number(b.dataset.tip) || 0; markTip(); H.onBillChange(); }));
  el['btn-bill-share'].addEventListener('click', () => H.onBillShare());

  // configuracoes: aplicar ao mudar
  el['set-theme'].addEventListener('change', () => H.onSetting({ theme: el['set-theme'].value }));
  el['set-lang'].addEventListener('change', () => H.onSetting({ lang: el['set-lang'].value }));
  el['set-bigfont'].addEventListener('change', () => H.onSetting({ bigFont: el['set-bigfont'].checked }));
  el['set-sound'].addEventListener('change', () => H.onSetting({ sound: el['set-sound'].checked }));
  el['set-limit'].addEventListener('change', () => H.onSetting({ limit: Math.max(0, parseInt(el['set-limit'].value, 10) || 0) }));
  el['set-water'].addEventListener('change', () => H.onSetting({ waterEvery: Math.max(0, parseInt(el['set-water'].value, 10) || 0) }));
  el['set-nudges'].addEventListener('change', () => H.onSetting({ nudges: el['set-nudges'].checked }));
  el['set-shake'].addEventListener('change', () => H.onShakeToggle(el['set-shake'].checked));
  el['set-weight'].addEventListener('change', () => H.onSetting({ weightKg: Math.max(0, Math.min(300, parseInt(el['set-weight'].value, 10) || 0)) }));
  el['set-sex'].addEventListener('change', () => H.onSetting({ sex: el['set-sex'].value }));
  el['set-responsa'].addEventListener('change', () => H.onSetting({ responsa: el['set-responsa'].checked }));
  el['set-carapp'].addEventListener('change', () => H.onSetting({ carApp: el['set-carapp'].value }));
  el['set-trustname'].addEventListener('change', () => H.onSetting({ trustName: el['set-trustname'].value.trim() }));
  el['set-trustphone'].addEventListener('change', () => H.onSetting({ trustPhone: el['set-trustphone'].value.trim() }));
  el['set-pixkey'].addEventListener('change', () => H.onSetting({ pixKey: el['set-pixkey'].value.trim() }));
  el['set-pixcity'].addEventListener('change', () => H.onSetting({ pixCity: el['set-pixcity'].value.trim() }));
  $('btn-clear-data').addEventListener('click', () => H.onClearData());
  el['btn-export-data'].addEventListener('click', () => H.onExportData());
  el['btn-import-data'].addEventListener('click', () => el['import-file'].click());
  el['import-file'].addEventListener('change', () => {
    const f = el['import-file'].files && el['import-file'].files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { H.onImportData(String(rd.result || '')); el['import-file'].value = ''; };
    rd.onerror = () => { toast(t('toast.fileRead')); el['import-file'].value = ''; };
    rd.readAsText(f);
  });
  el['presence-bar'].addEventListener('click', () => H.onPeers());

  // offline (pareamento por QR/código, sem servidor)
  el['btn-offline-join'].addEventListener('click', () => H.onOfflineJoin());
  el['btn-offline-host'].addEventListener('click', () => { closeOverlays(); H.onOfflineHost(); });
  el['btn-off-copy-offer'].addEventListener('click', () => copyBox('off-offer-code', t('off.copyOfferOk')));
  el['btn-off-copy-answer'].addEventListener('click', () => copyBox('off-answer-code', t('off.copyAnswerOk')));
  el['btn-off-connect'].addEventListener('click', () => H.onOfflineConnect(el['off-answer-in'].value));
  el['btn-off-genanswer'].addEventListener('click', () => H.onOfflineGenAnswer(el['off-offer-in'].value));
  el['btn-off-scan-answer'].addEventListener('click', () => openScanner(t('off.scanAnswer'), (txt) => { el['off-answer-in'].value = txt; H.onOfflineConnect(txt); }));
  el['btn-off-scan-offer'].addEventListener('click', () => openScanner(t('off.scanOffer'), (txt) => { el['off-offer-in'].value = txt; H.onOfflineGenAnswer(txt); }));
  el['btn-scan-close'].addEventListener('click', () => closeOverlays());

  // fechar overlays
  document.querySelectorAll('.overlay').forEach((ov) => {
    ov.addEventListener('click', (e) => { if (e.target === ov || e.target.hasAttribute('data-close')) closeOverlays(); });
  });

  // bebedeira
  $('btn-bebedeira-exit').addEventListener('click', () => closeBebedeira());
  attachGesture(el['bebedeira-plus'],
    () => { H.onAdd(bebedeiraItem); },
    () => { H.onRemove(bebedeiraItem); });

  // girar o aparelho / redimensionar: a media query troca o layout, o scale do tabuleiro
  // precisa acompanhar (senão as pedras ficam no tamanho da orientação antiga)
  const domRefit = () => { if (el['overlay-domino'] && !el['overlay-domino'].hidden) requestAnimationFrame(domFitBoard); };
  window.addEventListener('resize', domRefit);
  window.addEventListener('orientationchange', domRefit);

  setupA11y();
}

// ---------- Acessibilidade: diálogos, ESC, armadilha de foco ----------
let lastFocus = null;
function openOverlayEls() { return [...document.querySelectorAll('.overlay')].filter((o) => !o.hidden); }
function focusables(root) {
  return [...root.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')]
    .filter((x) => !x.disabled && x.offsetParent !== null);
}
function setupA11y() {
  // marca cada sheet como diálogo pro leitor de tela; foca o diálogo ao abrir, devolve ao fechar
  document.querySelectorAll('.overlay').forEach((ov) => {
    const sheet = ov.querySelector('.sheet') || ov;
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('tabindex', '-1');
    const h = sheet.querySelector('h2');
    if (h) { if (!h.id) h.id = 'h_' + Math.abs(hashStr(ov.id)); sheet.setAttribute('aria-labelledby', h.id); }
    new MutationObserver(() => {
      if (!ov.hidden) { lastFocus = document.activeElement; try { sheet.focus({ preventScroll: true }); } catch { /* ignore */ } }
    }).observe(ov, { attributes: true, attributeFilter: ['hidden'] });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (openOverlayEls().length) { closeOverlays(); e.preventDefault(); }
      else if (!el['bebedeira'].hidden) closeBebedeira();
      else if (!el['brinde'].hidden) { /* deixa terminar sozinho */ }
      return;
    }
    if (e.key !== 'Tab') return;
    const ovs = openOverlayEls();
    const ov = ovs[ovs.length - 1];
    if (!ov) return;
    const f = focusables(ov.querySelector('.sheet') || ov);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  });
}
function hashStr(s) { let h = 0; for (let i = 0; i < String(s).length; i++) h = (h * 31 + String(s).charCodeAt(i)) | 0; return h; }
export function reducedMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } }

export function showScreen(name) {
  el['screen-home'].classList.toggle('is-active', name === 'home');
  el['screen-table'].classList.toggle('is-active', name === 'table');
}

// ---------- Home ----------
export function setNameInput(v) { el['input-name'].value = v || ''; }
export function showInstall(v) { el['btn-install'].hidden = !v; }

export function renderHome(history) {
  const box = el['home-history'], ul = el['history-list'];
  const empty = !history || !history.length;
  if (el['home-hint']) el['home-hint'].hidden = !empty;
  if (el['home-extras']) el['home-extras'].hidden = empty; // features pessoais só aparecem quando já há histórico
  if (empty) { box.hidden = true; ul.innerHTML = ''; return; }
  box.hidden = false;
  ul.innerHTML = history.slice(0, 6).map((h) => {
    const d = new Date(h.at);
    const when = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return `<li class="hist-item" data-room="${esc(h.room)}">
      <span><strong>${esc(h.room)}</strong> <small>· ${when}</small></span>
      <small>${t('home.histLine', { me: h.myTotal || 0, tt: h.tableTotal || 0 })}</small></li>`;
  }).join('');
  ul.querySelectorAll('.hist-item').forEach((li) => li.addEventListener('click', () => H.onOpenHistory(li.dataset.room)));
}

// ---------- Mesa ----------
let lastIds = '';
export function renderTable(vm) {
  el['table-title'].textContent = vm.title || t('common.tableCap');
  el['mesa-code'].textContent = vm.code;
  countTo(el['my-total'], vm.myTotal);
  countTo(el['table-total'], vm.tableTotal);
  if (el['hero-fill']) el['hero-fill'].style.setProperty('--fill', (vm.heroFill || 0) + '%');
  el['peer-count'].textContent = vm.peerCount;
  el['money-block'].hidden = !vm.showMoney;
  if (vm.showMoney) el['my-money'].textContent = fmtMoney(vm.myMoney);

  const sig = vm.items.map((i) => i.id + ':' + (i.cat || '')).join(',');
  if (sig !== lastIds) {
    el['items-grid'].innerHTML = gridHTML(vm.items);
    el['items-grid'].querySelectorAll('.item-card').forEach((card) => {
      const id = card.dataset.item;
      attachGesture(card, () => H.onAdd(id), () => H.onRemove(id));
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); H.onAdd(id); } });
    });
    lastIds = sig;
  }
  let topId = null, topQ = 0;
  for (const it of vm.items) { const q = Number(it.qty) || 0; if (q > topQ) { topQ = q; topId = it.id; } }
  for (const it of vm.items) {
    const card = el['items-grid'].querySelector(`[data-item="${cssq(it.id)}"]`);
    if (!card) continue;
    card.querySelector('.item-emoji').textContent = it.emoji;
    card.querySelector('.item-name').textContent = it.name;
    countTo(card.querySelector('.item-qty'), it.qty);
    card.querySelector('.item-sub').textContent = it.sub;
    card.toggleAttribute('data-zero', (Number(it.qty) || 0) === 0);
    card.classList.toggle('hot', it.id === topId && topQ > 0);
  }
  if (el['table-hint']) el['table-hint'].hidden = Number(vm.tableTotal) > 0;
}
function cardHTML(it) {
  const note = it.note ? ` title="${esc(it.note)}"` : '';
  return `<div class="item-card" data-item="${esc(it.id)}" role="button" tabindex="0" aria-label="${esc(it.name)}: toque para +1, segure para −1"${note}>
    <div class="item-qty">${it.qty}</div>
    <div class="item-emoji">${esc(it.emoji)}</div>
    <div class="item-name">${esc(it.name)}</div>
    <div class="item-sub">${esc(it.sub)}</div>
    <div class="item-plus">+1</div>${it.note ? '<div class="item-badge" aria-hidden="true">📝</div>' : ''}</div>`;
}
// Cardápio agrupado por categoria (cabeçalhos só quando há mais de uma categoria).
function gridHTML(items) {
  const byCat = new Map();
  for (const it of items) { const c = it.cat || 'outros'; if (!byCat.has(c)) byCat.set(c, []); byCat.get(c).push(it); }
  const names = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.name]));
  const order = CATEGORIES.map((c) => c.id).filter((c) => byCat.has(c));
  for (const c of byCat.keys()) if (!order.includes(c)) order.push(c);
  const heads = order.length > 1;
  let html = '';
  for (const c of order) {
    if (heads) html += `<div class="cat-head">${esc(names[c] || 'Outros')}</div>`;
    html += byCat.get(c).map(cardHTML).join('');
  }
  return html;
}
export function pulse(itemId, kind) {
  const card = el['items-grid'].querySelector(`[data-item="${cssq(itemId)}"]`);
  if (card) { const cls = kind === 'remove' ? 'pop-remove' : 'pop'; card.classList.remove(cls); void card.offsetWidth; card.classList.add(cls); }
  if (!el['bebedeira'].hidden && itemId === bebedeiraItem) { const n = el['bebedeira-count']; n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop'); }
}
export function setConn(msg) { const b = el['conn-banner']; if (!msg) { b.hidden = true; return; } b.hidden = false; b.textContent = msg; }
export function setHappyHour(msg) { const b = el['hh-banner']; if (!msg) { b.hidden = true; return; } b.hidden = false; b.textContent = msg; }

// ---------- Placar / participantes ----------
export function renderPeers({ rows, selfId, mvp, myBadges }) {
  el['mvp-banner'].hidden = !mvp;
  if (mvp) el['mvp-banner'].innerHTML = t('peers.mvp', { name: esc(mvp.name || t('common.anon')), n: mvp.total });
  const medals = ['🥇', '🥈', '🥉'];
  let rank = 0;
  el['peers-list'].innerHTML = rows.map((r) => {
    const medal = (!r.driver && r.total > 0) ? (medals[rank++] || '') : '';
    const badges = (r.badges || []).map((b) => b.emoji).join('');
    const net = r.user === selfId ? `<span class="peer-net" title="${t('common.you')}">📱</span>` : netHTML(r);
    return `<li class="peer-row" data-user="${esc(r.user)}">
      <span class="peer-medal">${medal}</span>
      <span class="peer-avatar ${frameClass(r.level)}" style="background:${safeColor(r.color)}">${avInner(r.photo, r.emoji)}</span>
      <button class="peer-main" aria-label="Ver comanda de ${esc(r.name || t('common.anon'))}">
        <span class="peer-name">${esc(r.name || t('common.anon'))} ${r.level > 1 ? `<span class="lvl-chip">Nv${r.level}</span>` : ''} ${r.user === selfId ? `<span class="peer-you">${t('common.youParen')}</span>` : ''} ${r.driver ? '🚗' : ''}</span>
        <span class="peer-badges">${badges}${r.money ? ' · ' + fmtMoney(r.money) : ''}</span>
      </button>
      ${net}
      ${r.user !== selfId ? `<button class="peer-poke" title="${t('peers.pokeT')}" aria-label="${t('peers.pokeAria')}">👉</button>` : ''}
      <span class="peer-total">${r.total}</span></li>`;
  }).join('') || `<li class="peer-row">${t('peers.empty')}</li>`;
  el['peers-list'].querySelectorAll('.peer-poke').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    const li = b.closest('.peer-row');
    if (li) H.onPoke(li.dataset.user);
  }));
  el['peers-list'].querySelectorAll('.peer-main').forEach((b) => b.addEventListener('click', () => {
    const li = b.closest('.peer-row');
    if (li) H.onComanda(li.dataset.user);
  }));
  el['my-badges'].innerHTML = (myBadges || []).map((b) => `<span class="badge">${b.emoji} ${esc(b.name)}</span>`).join('');
}
// Ícone de qualidade de conexão por pessoa (host = LAN/Wi-Fi, srflx = internet, relay = via servidor).
function netHTML(r) {
  if (r.online === false) return '<span class="peer-net off" title="desconectado">💤</span>';
  const map = { host: ['📶', t('net.host')], srflx: ['🌐', t('net.inet')], prflx: ['🌐', t('net.inet')], relay: ['🛰️', t('net.relay')] };
  const m = map[r.conn];
  if (m) return `<span class="peer-net" title="${m[1]}">${m[0]}</span>`;
  if (r.online) return '<span class="peer-net" title="conectado">🟢</span>';
  return '';
}
export function openPeers() { el['overlay-peers'].hidden = false; }

// ---------- Convite ----------
export function openInvite(vm) {
  el['big-code'].textContent = vm.code;
  el['qr-wrap'].innerHTML = ''; el['qr-wrap'].appendChild(vm.qrNode);
  el['table-name-input'].value = vm.title || '';
  el['invite-pin'].value = vm.pin || '';
  el['table-emoji-btn'].textContent = vm.emoji || '🍺';
  el['table-emoji-row'].hidden = true;
  el['table-emoji-row'].innerHTML = EMOJIS.map((e) => `<button class="emoji-pick" data-e="${e}">${e}</button>`).join('');
  el['table-emoji-row'].querySelectorAll('.emoji-pick').forEach((b) => b.addEventListener('click', () => {
    el['table-emoji-btn'].textContent = b.dataset.e; el['table-emoji-row'].hidden = true; H.onTableEmoji(b.dataset.e);
  }));
  el['btn-share-invite'].hidden = !navigator.share;
  el['btn-nfc'].hidden = !('NDEFReader' in window);
  el['overlay-invite'].hidden = false;
}
export function openJoin(code, needPin) {
  el['join-code-label'].textContent = code;
  el['join-name'].value = el['input-name'].value || '';
  el['join-pin-field'].hidden = !needPin;
  el['overlay-join'].hidden = false;
  setTimeout(() => el['join-name'].focus(), 60);
}

// ---------- Perfil ----------
let profileSel = { color: COLORS[0], emoji: AVATARS[0], photo: '' };
// Herói do perfil: preview AO VIVO de como a mesa te vê — cor de fundo + foto OU emoji.
function paintProfileHero() {
  el['profile-preview'].style.background = safeColor(profileSel.color);
  const has = !!profileSel.photo;
  el['profile-photo-img'].hidden = !has;
  if (has) el['profile-photo-img'].src = profileSel.photo;
  else el['profile-photo-img'].removeAttribute('src');
  el['profile-preview-emoji'].hidden = has;
  el['profile-preview-emoji'].textContent = profileSel.emoji || '🍺';
}
export function openProfile(cur) {
  profileSel = { color: cur.color || COLORS[0], emoji: cur.emoji || AVATARS[0], photo: cur.photo || '' };
  el['profile-name'].value = cur.name || '';
  el['profile-driver'].checked = !!cur.driver;
  el['profile-colors'].innerHTML = COLORS.map((c) => `<button class="swatch ${c === profileSel.color ? 'sel' : ''}" style="background:${c}" data-c="${c}"></button>`).join('');
  el['profile-colors'].querySelectorAll('.swatch').forEach((b) => b.addEventListener('click', () => {
    profileSel.color = b.dataset.c; el['profile-colors'].querySelectorAll('.swatch').forEach((x) => x.classList.remove('sel')); b.classList.add('sel');
    paintProfileHero();
  }));
  el['profile-avatars'].innerHTML = AVATARS.map((e) => `<button class="emoji-pick ${e === profileSel.emoji ? 'sel' : ''}" data-e="${e}">${e}</button>`).join('');
  el['profile-avatars'].querySelectorAll('.emoji-pick').forEach((b) => b.addEventListener('click', () => {
    profileSel.emoji = b.dataset.e; profileSel.photo = ''; // tocar num emoji = voltar pro emoji
    el['profile-avatars'].querySelectorAll('.emoji-pick').forEach((x) => x.classList.remove('sel')); b.classList.add('sel');
    paintProfileHero();
  }));
  paintProfileHero();
  el['overlay-profile'].hidden = false;
}
function submitProfile() {
  H.onProfileSave({ name: el['profile-name'].value.trim(), color: profileSel.color, emoji: profileSel.emoji, driver: el['profile-driver'].checked, photo: profileSel.photo });
  closeOverlays();
}

// ---------- Foto de perfil: captura + recorte (arrasta/pinça/slider) ----------
// A foto original NUNCA sai do aparelho: aqui ela vira uma miniatura 128×128 (JPEG) e SÓ
// essa miniatura entra no perfil (e, ao salvar, no evento PROFILE pra mesa ver).
const CROP_VIEW = 280, THUMB = 128;
let crop = null; // { img, w, h, scale, min, x, y, pointers:Map, pinch:null }

function openAvatarPicker(selfie) {
  const inp = el['avatar-file'];
  // selfie = câmera frontal do SISTEMA (padrão da "foto da noite"); galeria = sem capture
  if (selfie) inp.setAttribute('capture', 'user');
  else inp.removeAttribute('capture');
  inp.click();
}

async function avatarFilePicked() {
  const f = el['avatar-file'].files && el['avatar-file'].files[0];
  el['avatar-file'].value = '';
  if (!f) return;
  let img;
  try {
    // createImageBitmap respeita a orientação EXIF (selfie de celular vem rotacionada)
    img = await createImageBitmap(f, { imageOrientation: 'from-image' });
  } catch {
    img = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = r.result; };
      r.onerror = rej; r.readAsDataURL(f);
    }).catch(() => null);
  }
  if (!img || !img.width || !img.height) return;
  const min = CROP_VIEW / Math.min(img.width, img.height); // cobre a janela inteira
  crop = { img, w: img.width, h: img.height, scale: min, min, x: img.width / 2, y: img.height / 2, pointers: new Map(), pinch: null };
  el['crop-zoom'].value = '100';
  el['overlay-crop'].hidden = false;
  drawCrop();
}

// centro (x,y) em coordenadas DA IMAGEM; clamp mantém a janela sempre coberta
function clampCrop() {
  const half = CROP_VIEW / 2 / crop.scale;
  crop.x = Math.min(crop.w - half, Math.max(half, crop.x));
  crop.y = Math.min(crop.h - half, Math.max(half, crop.y));
}
function drawCrop() {
  if (!crop) return;
  const g = el['crop-canvas'].getContext('2d');
  const src = CROP_VIEW / crop.scale;
  g.clearRect(0, 0, CROP_VIEW, CROP_VIEW);
  g.drawImage(crop.img, crop.x - src / 2, crop.y - src / 2, src, src, 0, 0, CROP_VIEW, CROP_VIEW);
  // guia circular (é assim que a mesa vai ver)
  g.save();
  g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2; g.setLineDash([6, 6]);
  g.beginPath(); g.arc(CROP_VIEW / 2, CROP_VIEW / 2, CROP_VIEW / 2 - 3, 0, Math.PI * 2); g.stroke();
  g.restore();
}
function cropSetScale(s, cx, cy) { // cx/cy = ponto fixo na TELA (âncora do zoom)
  const old = crop.scale;
  crop.scale = Math.min(crop.min * 3, Math.max(crop.min, s));
  if (cx != null) { // mantém o ponto sob o dedo parado enquanto o zoom muda
    crop.x += (cx - CROP_VIEW / 2) * (1 / old - 1 / crop.scale);
    crop.y += (cy - CROP_VIEW / 2) * (1 / old - 1 / crop.scale);
  }
  clampCrop(); drawCrop();
  el['crop-zoom'].value = String(Math.round((crop.scale / crop.min) * 100));
}
function bindCrop() {
  const cv = el['crop-canvas'];
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { px: (e.clientX - r.left) * (CROP_VIEW / r.width), py: (e.clientY - r.top) * (CROP_VIEW / r.height) }; };
  cv.addEventListener('pointerdown', (e) => {
    if (!crop) return;
    cv.setPointerCapture(e.pointerId);
    crop.pointers.set(e.pointerId, pos(e));
    if (crop.pointers.size === 2) {
      const [a, b] = [...crop.pointers.values()];
      crop.pinch = { d: Math.hypot(a.px - b.px, a.py - b.py), scale: crop.scale };
    }
  });
  cv.addEventListener('pointermove', (e) => {
    if (!crop || !crop.pointers.has(e.pointerId)) return;
    const p = pos(e), prev = crop.pointers.get(e.pointerId);
    crop.pointers.set(e.pointerId, p);
    if (crop.pointers.size === 2 && crop.pinch) {
      const [a, b] = [...crop.pointers.values()];
      const d = Math.hypot(a.px - b.px, a.py - b.py);
      cropSetScale(crop.pinch.scale * (d / crop.pinch.d), (a.px + b.px) / 2, (a.py + b.py) / 2);
    } else if (crop.pointers.size === 1) {
      crop.x -= (p.px - prev.px) / crop.scale;
      crop.y -= (p.py - prev.py) / crop.scale;
      clampCrop(); drawCrop();
    }
  });
  const up = (e) => { if (!crop) return; crop.pointers.delete(e.pointerId); if (crop.pointers.size < 2) crop.pinch = null; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  el['crop-zoom'].addEventListener('input', () => { if (crop) cropSetScale(crop.min * (Number(el['crop-zoom'].value) / 100)); });
}
function cropUse() {
  if (!crop) return;
  const out = document.createElement('canvas');
  out.width = THUMB; out.height = THUMB;
  const g = out.getContext('2d');
  const src = CROP_VIEW / crop.scale;
  g.drawImage(crop.img, crop.x - src / 2, crop.y - src / 2, src, src, 0, 0, THUMB, THUMB);
  let url = out.toDataURL('image/jpeg', 0.72);
  if (url.length > 13000) url = out.toDataURL('image/jpeg', 0.6); // garante folga sob o teto do evento
  profileSel.photo = url;
  paintProfileHero();
  crop = null;
  el['overlay-crop'].hidden = true;
}

// ---------- Novo item ----------
let pickedEmoji = EMOJIS[0];
function openAddItem() {
  pickedEmoji = EMOJIS[0];
  el['emoji-row'].innerHTML = EMOJIS.map((e, i) => `<button class="emoji-pick ${i === 0 ? 'sel' : ''}" data-e="${e}">${e}</button>`).join('');
  el['emoji-row'].querySelectorAll('.emoji-pick').forEach((b) => b.addEventListener('click', () => {
    pickedEmoji = b.dataset.e; el['emoji-row'].querySelectorAll('.emoji-pick').forEach((x) => x.classList.remove('sel')); b.classList.add('sel');
  }));
  el['add-cat'].innerHTML = CATEGORIES.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
  el['add-cat'].value = 'outros';
  el['add-name'].value = ''; el['add-price'].value = ''; el['add-note'].value = '';
  el['overlay-additem'].hidden = false;
}
function submitAddItem() {
  const name = el['add-name'].value.trim();
  if (!name) { toast(t('toast.itemName')); return; }
  const price = parseFloat(String(el['add-price'].value).replace(',', '.')) || 0;
  H.onAddItemConfirm({ emoji: pickedEmoji, name, price, cat: el['add-cat'].value, note: el['add-note'].value.trim() });
  closeOverlays();
}

// ---------- Preços ----------
export function openPrices(items) {
  el['price-list'].innerHTML = items.map((it) => `<li class="price-row">
    <span>${esc(it.emoji)} ${esc(it.name)}</span>
    <input type="number" inputmode="decimal" min="0" step="0.5" value="${it.price || ''}" data-id="${esc(it.id)}" placeholder="${t('add.pricePh')}" /></li>`).join('');
  el['price-list'].querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => H.onPriceChange(inp.dataset.id, inp.value)));
  el['overlay-prices'].hidden = false;
}

// ---------- Conta ----------
let billTip = 10;                 // gorjeta escolhida (%)
let billExcluded = new Set();     // quem ficou de fora do "rachar igual"
function markTip() {
  el['bill-tips'].querySelectorAll('button[data-tip]').forEach((b) => b.classList.toggle('sel', Number(b.dataset.tip) === billTip));
}
export function openBill(vm) {
  billExcluded = new Set();
  if (vm && Number.isFinite(vm.tipPct)) billTip = vm.tipPct;
  markTip();
  el['overlay-bill'].hidden = false;
}
export function billOptions() {
  return {
    tipPct: billTip,
    couvert: Math.max(0, parseFloat(String(el['bill-couvert'].value).replace(',', '.')) || 0),
    equal: el['bill-equal'].checked,
    excluded: [...billExcluded],
  };
}
export function renderBill(vm) {
  el['bill-note'].textContent = vm.note || '';
  const equal = !!vm.equal;
  el['bill-list'].innerHTML = vm.rows.map((r) => {
    const items = (r.items || []).map((it) => `${esc(it.emoji)}${it.n}`).join(' ');
    const sel = equal ? `<input type="checkbox" class="b-sel" ${r.included ? 'checked' : ''} aria-label="${t('bill.selAria')}" />` : '';
    const right = r.coveredByName
      ? `<span class="b-covered">🙌 ${esc(r.coveredByName)}</span>`
      : `<span class="b-amt">${fmtMoney(r.amount)}</span>`;
    const pix = (vm.canPix && r.amount > 0 && !r.isSelf && !r.coveredByName) ? '<button class="b-pix">PIX</button>' : '';
    const pay = r.isSelf ? '' : `<button class="b-pay ${r.iPayThem ? 'on' : ''}" title="${t('bill.payTitle')}">🙌</button>`;
    return `<li class="bill-row" data-user="${esc(r.user)}">
      ${sel}
      <span class="peer-avatar" style="background:${safeColor(r.color)}">${avInner(r.photo, r.emoji)}</span>
      <div class="b-main">
        <span class="b-name">${esc(r.name || t('common.anon'))}${r.isSelf ? ` <span class="peer-you">${t('common.youParen')}</span>` : ''}</span>
        <span class="b-items">${items}</span>
      </div>
      ${right}
      <span class="b-actions">${pay}${pix}</span>
    </li>`;
  }).join('');
  el['bill-list'].querySelectorAll('.bill-row').forEach((li) => {
    const u = li.dataset.user;
    const pixb = li.querySelector('.b-pix'); if (pixb) pixb.addEventListener('click', () => H.onPix(u));
    const payb = li.querySelector('.b-pay'); if (payb) payb.addEventListener('click', () => H.onPayFor(u, !payb.classList.contains('on')));
    const selb = li.querySelector('.b-sel'); if (selb) selb.addEventListener('change', () => { if (selb.checked) billExcluded.delete(u); else billExcluded.add(u); H.onBillChange(); });
  });
  el['bill-total'].textContent = 'Total: ' + fmtMoney(vm.total);
}

// ---------- PIX ----------
export function openPix(vm) {
  el['pix-title'].textContent = vm.title || t('bill.pixTitle');
  el['pix-qr'].innerHTML = ''; if (vm.qrNode) el['pix-qr'].appendChild(vm.qrNode);
  el['pix-code'].value = vm.code || '';
  el['overlay-pix'].hidden = false;
}
export function pixCode() { return el['pix-code'].value; }

// ---------- Configuracoes ----------
function openSettings() { H.onOpenSettings(); el['overlay-settings'].hidden = false; }
// Fim do tour: pergunta o tema preferido (1 toque aplica; ✕ mantém o claro padrão).
export function openThemePick() { el['overlay-themepick'].hidden = false; }
export function fillSettings(s) {
  el['set-theme'].value = s.theme || 'light';
  el['set-lang'].value = s.lang || 'pt';
  el['set-bigfont'].checked = !!s.bigFont;
  el['set-sound'].checked = !!s.sound;
  el['set-limit'].value = s.limit || '';
  el['set-water'].value = s.waterEvery || '';
  el['set-nudges'].checked = s.nudges !== false;
  el['set-shake'].checked = !!s.shake;
  el['set-weight'].value = s.weightKg || '';
  el['set-sex'].value = s.sex || '';
  el['set-responsa'].checked = !!s.responsa;
  el['set-carapp'].value = s.carApp || 'uber';
  el['set-trustname'].value = s.trustName || '';
  el['set-trustphone'].value = s.trustPhone || '';
  el['set-pixkey'].value = s.pixKey || '';
  el['set-pixcity'].value = s.pixCity || '';
}
function prefersLight() { try { return window.matchMedia('(prefers-color-scheme: light)').matches; } catch { return false; } }
// Padrão de fábrica: CLARO. 'auto' (escolha manual) segue o sistema; senão usa o tema escolhido.
function resolveTheme(s) {
  const th = s.theme || 'light';
  if (th === 'auto') return prefersLight() ? 'light' : 'dark';
  return ['dark', 'light', 'neon', 'retro'].includes(th) ? th : 'light';
}
export function themeIsLight(s) { return resolveTheme(s) === 'light'; }
export function applyTheme(s) {
  const th = resolveTheme(s);
  document.body.classList.remove('light', 'neon', 'retro');
  if (th !== 'dark') document.body.classList.add(th);
  document.body.classList.toggle('bigfont', !!s.bigFont);
}
// Idioma: aplica o dicionário no shell (elementos com data-i18n).
export function applyLang(pref) { setLang(pref); applyI18n(); }
// Moldura do avatar conforme o nível (liga).
function frameClass(level) { level = Number(level) || 0; return level >= 5 ? 'fr-gold' : level >= 3 ? 'fr-silver' : ''; }

// ---------- Reações ----------
const REACTIONS = ['🍻', '🔥', '👏', '😂', '❤️', '🤢', '🎉', '🥴'];
function openReact() {
  el['react-row'].innerHTML = REACTIONS.map((e) => `<button data-e="${e}">${e}</button>`).join('');
  el['react-row'].querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { H.onReact(b.dataset.e); closeOverlays(); }));
  el['overlay-react'].hidden = false;
}

// ---------- Efeitos ----------
export function floatReaction(emoji) {
  const n = document.createElement('div');
  n.className = 'fx-float'; n.textContent = emoji;
  n.style.left = (10 + Math.floor(seededRand() * 78)) + 'vw';
  n.style.bottom = '12vh';
  el['fx-layer'].appendChild(n);
  setTimeout(() => n.remove(), 2300);
}
export function floatPlus(text, color) {
  const n = document.createElement('div');
  n.className = 'fx-plus'; n.textContent = text;
  if (color) n.style.color = color;
  n.style.left = (25 + Math.floor(seededRand() * 45)) + 'vw';
  n.style.bottom = '30vh';
  el['fx-layer'].appendChild(n);
  setTimeout(() => n.remove(), 1900);
}
// Comemoração: chuva de emoji (marcos: 10ª rodada, recorde da mesa, rodada coletiva).
export function celebrate(emojis) {
  vibrate([40, 30, 90]);
  if (reducedMotion()) return; // respeita "reduzir movimento": sem chuva de confete
  const layer = el['fx-layer'];
  const set = emojis && emojis.length ? emojis : ['🍺', '🎉', '🍻', '✨', '🥂'];
  for (let i = 0; i < 26; i++) {
    const s = document.createElement('div');
    s.className = 'confetti'; s.textContent = set[i % set.length];
    s.style.left = (seededRand() * 100).toFixed(1) + 'vw';
    s.style.fontSize = (14 + seededRand() * 22).toFixed(0) + 'px';
    s.style.animationDelay = (seededRand() * 0.25).toFixed(2) + 's';
    s.style.animationDuration = (1.6 + seededRand() * 1.3).toFixed(2) + 's';
    layer.appendChild(s);
    setTimeout(() => s.remove(), 3400);
  }
}
// aleatoriedade leve sem depender de Math.random em ambientes que o proíbem
let _r = 1;
function seededRand() { _r = (_r * 9301 + 49297) % 233280; return _r / 233280; }

let brindeRunning = false;
export function brinde() {
  if (brindeRunning) return;
  brindeRunning = true;
  const b = el['brinde'], cnt = el['brinde-count'], word = el['brinde-word'];
  b.hidden = false; b.classList.remove('go');
  let n = 3;
  cnt.textContent = n; word.textContent = t('brinde.prep');
  vibrate(30);
  const iv = setInterval(() => {
    n -= 1;
    if (n > 0) { cnt.textContent = n; vibrate(30); }
    else {
      clearInterval(iv);
      cnt.textContent = '🥂'; word.textContent = t('brinde.go'); b.classList.add('go');
      vibrate([60, 40, 120]);
      if (H.onBrindeGo) H.onBrindeGo();
      setTimeout(() => { b.hidden = true; brindeRunning = false; }, 1400);
    }
  }, 800);
}

// ---------- Jogos (atalho rápido da mesa) ----------
const GAMES = () => [
  ['🫲', t('games.purr'), 'onPurrinha'],
  ['🁫', t('games.dom'), 'onDomino'],
  ['🂠', t('games.truco'), 'onTruco'],
  ['🎰', t('games.roul'), 'onRoulette'],
  ['🏟️', t('games.tourn'), 'onTournament'],
  ['🃏', t('games.card'), 'onCard'],
];
function openGames() {
  const games = GAMES();
  el['games-grid'].innerHTML = games.map(([e, n], i) =>
    `<button class="game-pick" data-i="${i}"><span class="game-pick-e">${e}</span><span>${esc(n)}</span></button>`).join('');
  el['games-grid'].querySelectorAll('.game-pick').forEach((btn) => btn.addEventListener('click', () => {
    const g = games[Number(btn.dataset.i)]; closeOverlays(); H[g[2]]();
  }));
  el['overlay-games'].hidden = false;
}

// ---------- Bebedeira ----------
let bebedeiraItem = 'cerveja';
export function openBebedeira(vm) {
  bebedeiraItem = vm.item;
  el['bebedeira-item'].textContent = vm.emoji;
  el['bebedeira-count'].textContent = vm.count;
  el['bebedeira-count'].dataset.v = String(vm.count);
  el['bebedeira'].hidden = false;
}
export function updateBebedeira(count) { if (!el['bebedeira'].hidden) countTo(el['bebedeira-count'], count); }
export function closeBebedeira() { el['bebedeira'].hidden = true; if (H.onBebedeiraClose) H.onBebedeiraClose(); }
export function isBebedeira() { return !el['bebedeira'].hidden; }
export function currentBebedeiraItem() { return bebedeiraItem; }

// ---------- Offline (pareamento por QR/código, sem servidor) ----------
async function copyBox(id, okMsg) {
  const v = el[id].value;
  try { await navigator.clipboard.writeText(v); toast(okMsg || t('toast.copied')); }
  catch { el[id].focus(); el[id].select(); toast(t('toast.selectCopy')); }
}
export function openOfflineHost() {
  el['off-host'].hidden = false; el['off-guest'].hidden = true;
  el['off-offer-qr'].innerHTML = ''; el['off-offer-code'].value = t('off.generating'); el['off-answer-in'].value = '';
  el['overlay-offline'].hidden = false;
}
export function openOfflineGuest() {
  el['off-host'].hidden = true; el['off-guest'].hidden = false;
  el['off-offer-in'].value = ''; el['off-answer-out'].hidden = true;
  el['off-answer-qr'].innerHTML = ''; el['off-answer-code'].value = '';
  el['overlay-offline'].hidden = false;
}
export function showOfflineOffer(code, qrNode) {
  el['off-offer-code'].value = code;
  el['off-offer-qr'].innerHTML = ''; if (qrNode) el['off-offer-qr'].appendChild(qrNode);
}
export function showOfflineAnswer(code, qrNode) {
  el['off-answer-out'].hidden = false;
  el['off-answer-code'].value = code;
  el['off-answer-qr'].innerHTML = ''; if (qrNode) el['off-answer-qr'].appendChild(qrNode);
}

// ---------- Scanner de QR (câmera) ----------
let activeScan = null;
export function openScanner(title, onResult) {
  if (!scanSupported()) { toast(t('off.noCamera')); return; }
  el['scan-title'].textContent = title || t('off.scanTitle');
  el['scan-hint'].textContent = t('off.scanHint');
  el['overlay-scan'].hidden = false;
  const h = scanQR(el['scan-video']);
  activeScan = h;
  h.promise.then((txt) => {
    activeScan = null; el['overlay-scan'].hidden = true; vibrate(30);
    if (onResult) onResult(txt);
  }).catch((e) => {
    activeScan = null; el['overlay-scan'].hidden = true;
    if (e && e.name === 'NotAllowedError') toast(t('off.cameraPerm'));
    else if (e && e.message === 'sem-camera') toast(t('off.noCamera2'));
    // cancelamento manual (fechar overlay): silencioso
  });
}

// ---------- Meu ritmo (consciência) ----------
function fmtDur(ms) {
  const m = Math.round((ms || 0) / 60000);
  if (m < 60) return m + 'min';
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h}h${String(mm).padStart(2, '0')}` : `${h}h`;
}
function roundRectPath(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function drawChart(canvas, bars) {
  const g = canvas.getContext('2d');
  const W = canvas.width, Hh = canvas.height;
  g.clearRect(0, 0, W, Hh);
  const light = document.body.classList.contains('light');
  if (!bars || !bars.length) {
    g.fillStyle = light ? 'rgba(60,40,10,.45)' : 'rgba(255,240,200,.45)';
    g.font = '20px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText('sem bebidas ainda', W / 2, Hh / 2);
    return;
  }
  const max = Math.max(1, ...bars);
  const n = bars.length, gap = 6;
  const bw = (W - gap * (n + 1)) / n;
  g.fillStyle = light ? '#c8811f' : '#f4b13c';
  for (let i = 0; i < n; i++) {
    const h = Math.round((bars[i] / max) * (Hh - 20));
    if (h <= 0) continue;
    roundRectPath(g, gap + i * (bw + gap), Hh - 4 - h, bw, h, 4);
    g.fill();
  }
}
export function openPace(vm) {
  el['pace-summary'].innerHTML = `<strong>${vm.count}</strong> bebida${vm.count === 1 ? '' : 's'} em ${fmtDur(vm.spanMs)}`;
  el['pace-bar'].style.width = Math.min(100, (vm.recent / 6) * 100) + '%';
  el['pace-bar'].className = 'pace-bar lvl-' + vm.level;
  el['pace-label'].textContent = t('pace.lastHour', { label: vm.label, n: vm.recent });
  drawChart(el['pace-chart'], vm.bars || []);
  if (vm.bac) {
    const sober = vm.bac.soberInMs > 0 ? t('pace.soberIn', { t: fmtDur(vm.bac.soberInMs) }) : '';
    el['pace-bac'].innerHTML = `<div class="bac-big">${vm.bac.bac.toFixed(2)} <small>g/L</small></div>
      <div class="bac-lbl">${vm.bac.label}${sober}</div>
      ${vm.bac.canDrive ? '' : `<div class="bac-drive">${t('pace.noDrive')}</div>`}`;
  } else {
    el['pace-bac'].innerHTML = `<div class="bac-lbl">${t('pace.setWeight')}</div>`;
  }
  if (vm.coach) {
    const proj = vm.coach.predicted != null ? `<div class="coach-proj">${t('pace.proj', { n: vm.coach.predicted })}</div>` : '';
    const tips = (vm.coach.tips || []).map((t) => `<div class="coach-tip">${esc(t)}</div>`).join('');
    el['pace-coach'].innerHTML = `<div class="coach-head">${t('pace.coachHead')}</div>${proj}${tips}`;
  } else {
    el['pace-coach'].innerHTML = '';
  }
  el['overlay-pace'].hidden = false;
}

// ---------- Roleta: quem paga a próxima ----------
let rouletteRunning = false;
export function openRoulette(vm) {
  const entrants = (vm && vm.entrants) || [];
  el['roulette-result'].hidden = true;
  el['btn-roulette-spin'].disabled = entrants.length < 2 || rouletteRunning;
  el['roulette-list'].innerHTML = entrants.map((e, i) => `<li class="roul-item" data-i="${i}">
    <span class="peer-avatar" style="background:${safeColor(e.color)}">${avInner(e.photo, e.avatar)}</span>
    <span class="roul-name">${esc(e.name || t('common.anon'))}${e.isSelf ? ` <span class="peer-you">${t('common.youParen')}</span>` : ''}</span></li>`).join('')
    || `<li class="roul-item">${t('roul.empty')}</li>`;
  el['overlay-roulette'].hidden = false;
}
// Anima o giro terminando no vencedor (mesma lista/vencedor em todos os aparelhos → sincronizado).
export function runRoulette(entrants, winnerUser) {
  if (rouletteRunning || !entrants || !entrants.length) return;
  openRoulette({ entrants });
  const items = [...el['roulette-list'].querySelectorAll('.roul-item')];
  const n = entrants.length;
  let winIdx = entrants.findIndex((e) => e.user === winnerUser);
  if (winIdx < 0) winIdx = 0;
  const steps = 3 * n + winIdx; // algumas voltas + parar no vencedor
  const highlight = (idx) => items.forEach((it, i) => it.classList.toggle('on', i === idx % n));
  const finish = () => {
    const w = entrants[winIdx];
    el['roulette-result'].hidden = false;
    el['roulette-result'].innerHTML = t('roul.result', { name: esc(w.name || t('common.someoneLow')) });
    if (H.onSfx) H.onSfx('win'); vibrate([60, 40, 120]);
    celebrate(['🎉', '🎰', '🍻', '🥂']);
  };
  if (reducedMotion()) { highlight(winIdx); finish(); return; } // sem giro: mostra o resultado
  rouletteRunning = true;
  el['btn-roulette-spin'].disabled = true;
  let s = 0;
  const step = () => {
    highlight(s);
    if (H.onSfx) H.onSfx('tick'); vibrate(8);
    s++;
    if (s <= steps) {
      const remaining = steps - s;
      setTimeout(step, remaining < n ? 90 + (n - remaining) * 45 : 70); // desacelera no fim
    } else {
      highlight(steps);
      rouletteRunning = false;
      el['btn-roulette-spin'].disabled = false;
      finish();
    }
  };
  step();
}

// ---------- Cutucar / desafiar ----------
export function openPoke(vm) {
  el['poke-title'].textContent = 'Provocar ' + (vm.name || t('common.someoneLow'));
  const btns = ['<button class="btn btn-primary poke-btn" data-kind="poke">👉 Cutucar</button>'];
  for (const it of (vm.items || [])) {
    btns.push(`<button class="btn btn-ghost poke-btn" data-kind="challenge" data-item="${esc(it.id)}">${esc(it.emoji)} Desafiar: ${esc(it.name)}</button>`);
  }
  el['poke-actions'].innerHTML = btns.join('');
  el['poke-actions'].querySelectorAll('.poke-btn').forEach((b) => b.addEventListener('click', () => {
    H.onPokeSend(vm.user, b.dataset.kind, b.dataset.item || '');
    closeOverlays();
  }));
  el['overlay-poke'].hidden = false;
}

// ---------- Cerimônia de troféus ----------
export function openCeremony(vm) {
  const list = (vm && vm.awards) || [];
  el['ceremony-list'].innerHTML = list.length ? list.map((a) => `<li class="ceremony-row">
    <span class="cer-emoji">${esc(a.emoji || '🏅')}</span>
    <div class="cer-main"><span class="cer-title">${esc(a.title)}</span>
    <span class="cer-name">${esc(a.name || t('common.anon'))}${a.detail ? ` · ${esc(a.detail)}` : ''}</span></div></li>`).join('')
    : `<li class="ceremony-row">${t('cer.empty')}</li>`;
  el['overlay-ceremony'].hidden = false;
  if (list.length) { celebrate(['🏆', '🎉', '🥇', '🍻', '✨']); if (H.onSfx) H.onSfx('fanfare'); }
}

// ---------- Meus números (estatísticas de vida) ----------
export function openStats(vm) {
  const s = vm.stats || {};
  const cell = (v, l, wide) => `<div class="stat-cell${wide ? ' wide' : ''}"><span class="stat-v">${v}</span><span class="stat-l">${esc(l)}</span></div>`;
  let html = cell(s.nights || 0, t('stats.nights'))
    + cell(s.totalDrinks || 0, t('stats.drinks'))
    + cell((s.avgPerNight || 0).toFixed(1), t('stats.avg'))
    + cell(s.thisMonth || 0, t('stats.month'))
    + cell(s.record ? s.record.total : 0, t('stats.record'))
    + cell('🔥' + (s.streakWeeks || 0), t('stats.weeks'));
  if (s.favDrink) html += cell(vm.favEmoji || '🍺', 'favorita: ' + (vm.favName || s.favDrink), true);
  if (s.totalSpent > 0) html += cell(fmtMoney(s.totalSpent), t('stats.spent'), true);
  el['stats-grid'].innerHTML = html;
  el['stats-badges'].innerHTML = (vm.badges || []).map((b) => `<span class="badge">${b.emoji} ${esc(b.name)}</span>`).join('') || '<span class="seal">Suas conquistas aparecem aqui 🏅</span>';
  const trend = vm.trend || [];
  const hasTrend = trend.some((t) => t.total > 0);
  el['stats-chart'].hidden = !hasTrend;
  el['stats-chart-h'].hidden = !hasTrend;
  if (hasTrend) drawBars(el['stats-chart'], trend);
  const ins = vm.insight;
  if (ins && ins.best && ins.worst && ins.best.wd !== ins.worst.wd) {
    el['stats-insight'].textContent = t('stats.insight', { best: ins.best.day, worst: ins.worst.day });
    el['stats-insight'].hidden = false;
  } else {
    el['stats-insight'].hidden = true;
  }
  el['stats-history'].innerHTML = (vm.history || []).slice(0, 12).map((h) => {
    const d = new Date(h.at);
    const when = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    return `<li><span>${esc(h.title || h.room)} <small>· ${when}</small></span><small>${t('home.histLine', { me: h.myTotal || 0, tt: h.tableTotal || 0 })}</small></li>`;
  }).join('') || '<li>Sem noites ainda — bora criar a primeira? 🍻</li>';
  el['overlay-stats'].hidden = false;
}
// Barras com rótulo (tendência mensal).
function drawBars(canvas, items) {
  const g = canvas.getContext('2d');
  const W = canvas.width, Hh = canvas.height;
  g.clearRect(0, 0, W, Hh);
  const light = document.body.classList.contains('light');
  const col = light ? '#c8811f' : '#f4b13c';
  const lab = light ? 'rgba(60,40,10,.72)' : 'rgba(255,240,200,.72)';
  const n = items.length, gap = 8, padB = 24;
  const max = Math.max(1, ...items.map((i) => i.total));
  const bw = (W - gap * (n + 1)) / n;
  g.textAlign = 'center'; g.font = '18px system-ui, sans-serif';
  for (let i = 0; i < n; i++) {
    const h = Math.round((items[i].total / max) * (Hh - padB - 10));
    const x = gap + i * (bw + gap);
    if (h > 0) { g.fillStyle = col; roundRectPath(g, x, Hh - padB - h, bw, h, 4); g.fill(); }
    g.fillStyle = lab; g.fillText(items[i].label, x + bw / 2, Hh - 7);
  }
}

// ---------- Presença (avatares de quem está na mesa, no topo) ----------
export function renderPresence(list) {
  const bar = el['presence-bar'];
  const others = (list || []).filter((p) => !p.self);
  if (!others.length) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  // quem apagou a tela / caiu há pouco fica esmaecido com 💤 (em vez de sumir da barra)
  bar.innerHTML = (list || []).map((p) => `<span class="pres-av${p.online ? '' : ' zz'} ${frameClass(p.level)}" title="${esc(p.name || '')}${p.online ? '' : t('pres.away')}" style="background:${safeColor(p.color)}">${avInner(p.photo, p.emoji)}${p.online ? '' : '<i class="zz-b">💤</i>'}</span>`).join('');
}

// ---------- Comanda individual ----------
export function openComanda(vm) {
  el['comanda-title'].textContent = `${vm.emoji || '🍺'} ${vm.name || t('common.anon')}`;
  el['comanda-list'].innerHTML = (vm.rows || []).map((r) => `<li class="comanda-row">
    <span class="c-emoji">${esc(r.emoji || '🍺')}</span>
    <span class="c-name">${esc(r.name)}</span>
    <span class="c-qty">×${r.n}</span>
    ${r.money ? `<span class="c-money">${fmtMoney(r.money)}</span>` : ''}</li>`).join('')
    || `<li class="comanda-row">${t('comanda.empty')}</li>`;
  el['comanda-total'].textContent = `Total: ${vm.total} 🍺${vm.money ? ' · ' + fmtMoney(vm.money) : ''}`;
  el['overlay-comanda'].hidden = false;
}

// ---------- Tour guiado da primeira mesa (spotlight + balão; leve, sem lib) ----------
let tourSteps = null, tourIdx = 0, tourDone = null;
export function startTour(steps, onDone) {
  tourSteps = Array.isArray(steps) && steps.length ? steps : null;
  tourIdx = 0;
  tourDone = tourSteps && typeof onDone === 'function' ? onDone : null;
  if (!tourSteps) { el['tour'].hidden = true; return; }
  renderTourStep();
}
// completed=true só quando os passos acabaram (viu tudo); "pular" fecha sem perguntar nada.
function endTour(completed) {
  tourSteps = null; el['tour'].hidden = true;
  const cb = tourDone; tourDone = null;
  if (cb) cb(!!completed);
}
function tourNext() { tourIdx++; renderTourStep(); }
function renderTourStep() {
  const st = tourSteps && tourSteps[tourIdx];
  if (!st) { endTour(true); return; }
  const target = document.querySelector(st.sel);
  if (!target) { tourIdx++; renderTourStep(); return; } // âncora não existe: segue o baile
  target.scrollIntoView({ block: 'center' });
  requestAnimationFrame(() => {
    if (!tourSteps) return;
    const r = target.getBoundingClientRect();
    const spot = el['tour-spot'];
    spot.style.left = (r.left - 8) + 'px';
    spot.style.top = (r.top - 8) + 'px';
    spot.style.width = (r.width + 16) + 'px';
    spot.style.height = (r.height + 16) + 'px';
    el['tour-count'].textContent = `${tourIdx + 1}/${tourSteps.length}`;
    el['tour-title'].textContent = st.title || '';
    el['tour-text'].textContent = st.text || '';
    el['btn-tour-next'].textContent = tourIdx + 1 >= tourSteps.length ? t('common.go') : t('tour.next');
    const bal = el['tour-balloon'];
    bal.style.top = ''; bal.style.bottom = '';
    if (r.top > window.innerHeight / 2) bal.style.bottom = (window.innerHeight - r.top + 16) + 'px'; // balão acima do alvo
    else bal.style.top = (r.bottom + 16) + 'px';                                                     // ou abaixo
    el['tour'].hidden = false;
  });
}

// ---------- Tô de boa? (segurança) ----------
export function openSafe(vm) {
  const v = vm.verdict;
  el['safe-verdict'].className = 'safe-verdict lvl-' + v.level;
  el['safe-verdict'].innerHTML = `<div class="sv-title">${esc(v.title)}</div><div class="sv-advice">${esc(v.advice)}</div>`;
  const row = (emoji, label, val) => `<div class="safe-row"><span class="sr-emoji">${emoji}</span><span class="sr-label">${esc(label)}</span><span class="sr-val">${esc(val)}</span></div>`;
  let rows = row('🍺', t('safe.bacRow'), vm.bacText);
  if (vm.lastText) rows += row('⏱️', t('safe.lastRow'), vm.lastText);
  if (vm.hydration) rows += row('💧', t('safe.hydRow'), vm.hydration.label);
  el['safe-rows'].innerHTML = rows;
  el['btn-safe-trust'].hidden = !vm.hasTrust;
  el['btn-safe-home'].hidden = !vm.hasTrust;
  el['overlay-safe'].hidden = false;
}

// ---------- Retrospectiva "Seu rolê" ----------
export function openRetro(vm) {
  el['retro-slides'].innerHTML = (vm.slides || []).map((s) => `<div class="retro-slide">
    <span class="rs-emoji">${esc(s.emoji || '🍺')}</span>
    <span class="rs-big">${esc(String(s.big))}</span>
    <span class="rs-sub">${esc(s.sub || '')}</span></div>`).join('') || '<div class="retro-slide">Sem noites ainda — bora criar a primeira? 🍻</div>';
  el['overlay-retro'].hidden = false;
}

// ---------- Liga & desafios (renderizada DENTRO do Placar; sem overlay próprio) ----------
export function renderLeague(vm) {
  const L = vm.level;
  const pct = L.xpForNext > 0 ? Math.min(100, (L.xpInLevel / L.xpForNext) * 100) : 100;
  el['league-level'].innerHTML = `<div class="ll-top"><span class="ll-badge">Nível ${L.level}</span><span class="ll-title">${esc(L.title)}</span></div>
    <div class="pace-meter"><div class="pace-bar lvl-medio" style="width:${pct}%"></div></div>
    <div class="ll-xp">${L.xpInLevel}/${L.xpForNext} XP pro próximo nível</div>`;
  el['league-challenges'].innerHTML = (vm.challenges || []).map((c) => `<li class="chal-row ${c.done ? 'done' : ''}">
    <span class="chal-emoji">${esc(c.emoji)}</span>
    <div class="chal-main"><span class="chal-title">${esc(c.title)}</span>
      <div class="pace-meter sm"><div class="pace-bar lvl-calmo" style="width:${Math.min(100, (c.progress / c.goal) * 100)}%"></div></div></div>
    <span class="chal-tick">${c.done ? '✅' : `${c.progress}/${c.goal}`}</span></li>`).join('');
  const s = vm.season;
  el['league-season'].innerHTML = s ? `<div class="season-card"><span class="season-emoji">${esc(s.emoji)}</span>
    <div><div class="season-title">${esc(s.title)}</div><div class="season-sub">${s.month} rodada${s.month === 1 ? '' : 's'} em ${esc(s.label)}</div></div></div>` : '';
}

// ---------- Modo bar ----------
export function openBar(vm) {
  el['bar-code'].value = '';
  const n = (vm && vm.menuCount) || 0;
  el['bar-usemenu-field'].hidden = n <= 0;
  el['bar-menu-count'].textContent = n;
  el['bar-usemenu'].checked = n > 0;
  el['overlay-bar'].hidden = false;
}

// ---------- Torneio da galera ----------
export function openTournament(vm) {
  el['tourn-list'].innerHTML = (vm.rank || []).map((r, i) => `<li class="tourn-row">
    <span class="tourn-medal">${['🥇', '🥈', '🥉'][i] || (i + 1 + 'º')}</span>
    <span class="tourn-name">${esc(r.name)}</span>
    <span class="tourn-pts">${r.points} pts <small>· ${r.nights} noite${r.nights === 1 ? '' : 's'}</small></span></li>`).join('')
    || '<li class="tourn-row">Sem torneio ainda — some a primeira noite! 🏟️</li>';
  el['overlay-tournament'].hidden = false;
}

// ---------- Carta da mesa (deck) ----------
export function openCard(vm) {
  el['card-draw'].innerHTML = `<div class="card-emoji">${esc(vm.emoji || '🃏')}</div><div class="card-text">${esc(vm.text || '')}</div>`;
  el['overlay-card'].hidden = false;
}

// ---------- Purrinha (commit-reveal; modos: rápida = 1 rodada / clássica = eliminação) ----------
let purrPick = { hand: null, guess: null };
let purrClassic = false; // modo da partida em curso (controla o botão de lacre)
let purrSaid = null;     // palpite selecionado na fase de turno (clássico)
function purrPhase(which) {
  el['purr-setup'].hidden = which !== 'setup';
  el['purr-pick'].hidden = which !== 'pick';
  el['purr-wait'].hidden = which !== 'wait';
  el['purr-guessing'].hidden = which !== 'guessing';
  el['purr-result'].hidden = which !== 'result';
}
// escolha do modo ao iniciar (quem inicia decide) — mesmo padrão do dominó
// ---------- Jogo minimizado (✕ = minimizar; a partida segue e o pill traz de volta) ----------
// Enquanto minimizado, os renders continuam atualizando o conteúdo por baixo — só não reabrem
// o overlay na cara de quem voltou pro contador. O pill na mesa traz de volta com um toque.
const gameMin = { dom: false, purr: false, truco: false };
export function setGameMin(kind, v) { gameMin[kind] = !!v; }
export function showGame(kind) {
  gameMin[kind] = false;
  el[kind === 'dom' ? 'overlay-domino' : kind === 'truco' ? 'overlay-truco' : 'overlay-purrinha'].hidden = false;
}
export function setGamePill(vm) {
  const p = el['game-pill'];
  if (!vm) { p.hidden = true; return; }
  p.textContent = vm.label;
  p.classList.toggle('urgent', !!vm.urgent);
  p.hidden = false;
}

export function purrinhaStartChoice() {
  el['purr-sub'].textContent = t('purr.subIntro');
  el['purr-setup'].innerHTML = `<div class="dom-start">
    <p class="dom-start-q">${t('game.how')}</p>
    <button class="btn btn-primary btn-lg" id="btn-purr-sticks">${t('purr.modeSticks')}</button>
    <button class="btn btn-ghost dom-start-alt" id="btn-purr-classic">${t('purr.modeClassic')}</button>
    <button class="btn btn-ghost dom-start-alt" id="btn-purr-fast">${t('purr.modeFast')}</button>
    <p class="dom-start-note">${t('purr.modesNote')}</p>
  </div>`;
  el['purr-setup'].querySelector('#btn-purr-sticks').onclick = () => H.onPurrStart('sticks');
  el['purr-setup'].querySelector('#btn-purr-classic').onclick = () => H.onPurrStart('classic');
  el['purr-setup'].querySelector('#btn-purr-fast').onclick = () => H.onPurrStart('fast');
  el['btn-purr-end'].hidden = true; // ainda não tem partida
  purrPhase('setup');
  el['overlay-purrinha'].hidden = false;
}
// mão como palitos de verdade (0 = punho fechado)
function purrSticks(n, sm) {
  n = Math.max(0, Number(n) || 0);
  if (n === 0) return `<span class="purr-fist${sm ? ' sm' : ''}">✊</span>`;
  return `<span class="purr-hsticks${sm ? ' sm' : ''}">${'<i class="pstick"></i>'.repeat(n)}</span>`;
}
export function openPurrinha(vm) {
  purrPick = { hand: null, guess: null };
  purrClassic = !!vm.classic;
  el['purr-sub'].textContent = vm.sub || (purrClassic
    ? t('purr.subClassic')
    : t('purr.subFast'));
  el['purr-guess-wrap'].hidden = purrClassic; // no clássico o palpite é falado depois, em voz alta
  el['btn-purr-seal'].textContent = purrClassic ? t('purr.sealHand') : t('purr.seal');
  el['purr-pstatus'].hidden = !vm.status;
  el['purr-pstatus'].textContent = vm.status || '';
  const mh = vm.maxHand == null ? 3 : Math.max(0, Math.min(3, vm.maxHand)); // 3-2-1: só até o seu estoque
  el['purr-hands'].innerHTML = [0, 1, 2, 3].map((n) => `<button class="purr-hand" data-hand="${n}"${n > mh ? ` disabled title="${t('purr.noSticks')}"` : ''}><span class="purr-hvis">${purrSticks(n)}</span><span class="purr-hn">${n}</span></button>`).join('');
  const mg = Math.max(0, vm.maxGuess || 0);
  let gs = '';
  for (let i = 0; i <= mg; i++) gs += `<button class="purr-opt" data-guess="${i}">${i}</button>`;
  el['purr-guesses'].innerHTML = gs;
  const sync = () => { el['btn-purr-seal'].disabled = purrPick.hand == null || (!purrClassic && purrPick.guess == null); };
  el['purr-hands'].querySelectorAll('[data-hand]').forEach((b) => b.addEventListener('click', () => {
    purrPick.hand = Number(b.dataset.hand);
    el['purr-hands'].querySelectorAll('.purr-hand').forEach((x) => x.classList.toggle('on', x === b));
    sync();
  }));
  el['purr-guesses'].querySelectorAll('[data-guess]').forEach((b) => b.addEventListener('click', () => {
    purrPick.guess = Number(b.dataset.guess);
    el['purr-guesses'].querySelectorAll('.purr-opt').forEach((x) => x.classList.toggle('on', x === b));
    sync();
  }));
  el['btn-purr-seal'].disabled = true;
  el['btn-purr-end'].hidden = false;
  purrPhase('pick');
  if (!gameMin.purr) el['overlay-purrinha'].hidden = false;
}
export function purrinhaSealed(vm) {
  el['purr-waitcount'].textContent = `🔒 ${vm.count}/${vm.total}`;
  el['purr-waitsub'].textContent = vm.sub || t('purr.waiting');
  el['purr-seals'].innerHTML = (vm.seals || []).map((s) => `<li class="purr-seal${s.sealed ? ' done' : ''}">
    <span class="purr-sav">${avInner(s.photo, s.avatar, false)}</span><span class="purr-sname">${esc(s.name)}</span>
    <span class="purr-sst">${s.sealed ? t('purr.sealed') : t('purr.choosing')}</span></li>`).join('');
  el['btn-purr-end'].hidden = false;
  purrPhase('wait');
  if (!gameMin.purr) el['overlay-purrinha'].hidden = false;
}
// clássico: fase dos palpites em turno — mostra os já falados e libera o picker só na SUA vez
export function purrinhaGuessing(vm) {
  purrSaid = null;
  el['purr-status'].textContent = vm.status || '';
  el['purr-said'].innerHTML = (vm.said || []).map((s) => `<li class="purr-sd${s.isSelf ? ' me' : ''}">
    <span class="purr-sdav">${avInner(s.photo, s.avatar, false)}</span><span class="purr-sdn">${esc(s.name)}</span>
    <b class="purr-sdg">${s.guess}</b></li>`).join('');
  if (vm.myTurn) {
    el['purr-turnrow'].textContent = t('purr.yourSay');
    const taken = new Set((vm.taken || []).map(Number));
    let gs = '';
    for (let i = 0; i <= (vm.maxGuess || 0); i++) gs += `<button class="purr-opt" data-say="${i}"${taken.has(i) ? ` disabled title="${t('purr.saidTaken')}"` : ''}>${i}</button>`;
    el['purr-gpick'].innerHTML = gs; el['purr-gpick'].hidden = false;
    el['btn-purr-say'].hidden = false; el['btn-purr-say'].disabled = true;
    el['purr-gpick'].querySelectorAll('[data-say]:not([disabled])').forEach((b) => b.addEventListener('click', () => {
      purrSaid = Number(b.dataset.say);
      el['purr-gpick'].querySelectorAll('.purr-opt').forEach((x) => x.classList.toggle('on', x === b));
      el['btn-purr-say'].disabled = false;
    }));
  } else {
    el['purr-turnrow'].textContent = vm.turnName ? t('purr.turnSay', { name: vm.turnName }) : '';
    el['purr-gpick'].hidden = true; el['btn-purr-say'].hidden = true;
  }
  el['btn-purr-end'].hidden = false;
  purrPhase('guessing');
  if (!gameMin.purr) el['overlay-purrinha'].hidden = false;
}
export function purrinhaResult(vm) {
  el['purr-rstatus'].hidden = !vm.status;
  el['purr-rstatus'].textContent = vm.status || '';
  el['purr-total'].innerHTML = t('purr.total', { n: vm.total });
  el['purr-reveals'].innerHTML = (vm.rows || []).map((r) => {
    const tag = r.isSeer ? `<span class="purr-tag seer">${t('purr.tagSeer')}</span>` : (r.isLoser ? `<span class="purr-tag loser">${t('purr.tagPays')}</span>` : '');
    return `<li class="purr-rev${r.isSeer ? ' seer' : ''}${r.isLoser ? ' loser' : ''}">
      <span class="purr-av">${avInner(r.photo, r.avatar, false)}</span>
      <span class="purr-rname">${esc(r.name)}${r.isSelf ? ` <small>${t('common.youParen')}</small>` : ''}</span>
      <span class="purr-rhand">${purrSticks(r.hand, true)}</span>
      <span class="purr-rguess">🎯 ${r.guess}</span>
      ${tag}</li>`;
  }).join('');
  el['purr-verdict'].className = 'purr-verdict ' + (vm.verdict.kind || '');
  el['purr-verdict'].textContent = vm.verdict.text;
  el['btn-purr-again'].hidden = vm.final === false; // rodada intermediária do clássico não tem "de novo"
  el['btn-purr-end'].hidden = vm.final !== false;   // no fim, o ✕ já resolve; no meio, dá pra encerrar
  purrPhase('result');
  if (!gameMin.purr) el['overlay-purrinha'].hidden = false;
}

// ---------- Dominó (pedras desenhadas com pips) ----------
// Nas metades lado a lado (divisor VERTICAL) a sena são duas FILEIRAS de 3 (perpendicular ao
// divisor, como na pedra de verdade); na carroça (metades empilhadas, divisor horizontal) a
// sena vira duas COLUNAS de 3. Os demais números são simétricos e não mudam.
const DOM_PIPS = { 0: [], 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 1, 2, 6, 7, 8] };
const DOM_PIPS_UP = { ...DOM_PIPS, 6: [0, 3, 6, 2, 5, 8] };
function domHalf(n, upright) {
  const on = new Set((upright ? DOM_PIPS_UP : DOM_PIPS)[n] || []);
  let cells = '';
  for (let i = 0; i < 9; i++) cells += `<i class="dp${on.has(i) ? ' on' : ''}"></i>`;
  return `<span class="dom-half">${cells}</span>`;
}
// pedra: dobra (carroça) fica atravessada (metades empilhadas); na mão fica sempre deitada (flat).
function domTileHTML(a, b, { flat = false, cls = '', chip = '' } = {}) {
  const isDbl = !flat && a === b;
  return `<span class="dom-tile${isDbl ? ' dbl' : ''}${cls ? ' ' + cls : ''}">${domHalf(a, isDbl)}${domHalf(b, isDbl)}${chip}</span>`;
}
// ajusta a escala do tabuleiro pra caber TUDO numa linha só (sem quebrar linha nem scroll)
function domFitBoard() {
  const board = el['dom-board'], wrap = board.parentElement;
  board.style.transform = '';
  const avail = wrap.clientWidth - 12;
  if (avail <= 0) return;
  const natural = board.scrollWidth;
  const s = natural > avail ? Math.max(0.28, avail / natural) : 1;
  board.style.transform = s < 1 ? `scale(${s})` : '';
}
let domArmed = null; // key da pedra que casa nas duas pontas, aguardando escolha de ponta
export function openDomino() { domArmed = null; el['overlay-domino'].hidden = false; }
// contagem regressiva do auto-passe (sem jogada legal, o passe sai sozinho em 5s)
export function setDomPassCount(n) {
  el['btn-dom-pass'].textContent = n != null ? t('dom.passN', { n: n }) : t('dom.pass');
}
// tela de espera do handshake da mesa verificada (antes do jogo começar)
export function dominoSetup(msg) {
  el['dom-setup'].innerHTML = `<div class="dom-setup-spin">🔒</div><div class="dom-setup-msg">${esc(msg)}</div>`;
  el['dom-setup'].hidden = false;
  el['dom-game'].hidden = true;
  el['btn-dom-end'].hidden = false;
  if (!gameMin.dom) el['overlay-domino'].hidden = false;
}
export function renderDomino(vm) {
  el['dom-setup'].hidden = true;
  el['dom-game'].hidden = false;
  if (vm.verified) {
    el['dom-verified'].hidden = false;
    el['dom-verified'].textContent = vm.verified.text;
    el['dom-verified'].className = 'dom-verified' + (vm.verified.ok === true ? ' ok' : vm.verified.ok === false ? ' bad' : '');
  } else { el['dom-verified'].hidden = true; }
  el['dom-opps'].innerHTML = (vm.opponents || []).map((o) => `<span class="dom-opp${o.isTurn ? ' turn' : ''}${o.justPlayed ? ' played' : ''}">
    <span class="dom-oav">${avInner(o.photo, o.avatar, false)}</span><span class="dom-oname">${esc(o.name)}</span><span class="dom-ocount">🁫 ${o.count}</span></span>`).join('');
  el['dom-turn'].textContent = vm.turn || '';
  el['dom-turn'].className = 'dom-turn' + (vm.myTurn ? ' mine' : '');
  // tabuleiro: UMA linha que escala pra caber; pontas abertas brilham (sem banner dedicado); a
  // peça recém-jogada ganha destaque + o avatar de quem jogou (como acompanhar a mão na mesa real).
  const board = vm.board || [];
  el['dom-board'].innerHTML = board.length
    ? board.map((t, i) => {
      const open = i === 0 || i === board.length - 1;
      const just = i === vm.lastPlayIdx;
      const chip = just && vm.lastPlayAvatar ? `<span class="dom-played-av" title="${esc(vm.lastPlayName || '')}">${avInner(vm.lastPlayPhoto, vm.lastPlayAvatar)}</span>` : '';
      return domTileHTML(t.a, t.b, { cls: (open ? 'open' : '') + (just ? ' just' : ''), chip });
    }).join('')
    : `<span class="dom-empty">${t('dom.starting')}</span>`;
  requestAnimationFrame(domFitBoard);
  el['dom-hand'].innerHTML = (vm.hand || []).map((h) => {
    const playable = h.sides.length > 0 && vm.myTurn;
    return `<button class="dom-htile${playable ? ' can' : ' dim'}" data-key="${h.key}" data-sides="${h.sides.join('')}"${playable ? '' : ' disabled'}>${domTileHTML(h.a, h.b, { flat: true })}</button>`;
  }).join('');
  el['dom-hand'].querySelectorAll('.dom-htile').forEach((b) => b.addEventListener('click', () => {
    const sides = (b.dataset.sides || '').split('').filter(Boolean);
    if (!sides.length) return;
    if (sides.length === 1) { H.onDomPlay(b.dataset.key, sides[0]); return; }
    domArmed = b.dataset.key; // casa nas duas pontas → escolhe qual
    el['dom-endL'].textContent = vm.ends[0]; el['dom-endR'].textContent = vm.ends[1];
    el['dom-side-pick'].hidden = false;
  }));
  el['dom-side-pick'].hidden = true;
  el['btn-dom-pass'].hidden = vm.over || !vm.canPass;
  el['btn-dom-pass'].textContent = t('dom.pass'); // zera contagem antiga; o app re-arma se for o caso
  el['dom-hand-wrap'].hidden = !!vm.over;
  el['dom-result'].hidden = !vm.over;
  el['dom-result'].textContent = vm.over ? (vm.result || '') : '';
  el['dom-result'].className = 'dom-result' + (vm.over && vm.iWon ? ' win' : '');
  el['btn-dom-again'].hidden = !vm.over;
  el['btn-dom-end'].hidden = !!vm.over; // no fim, o ✕ já resolve; no meio, dá pra encerrar pra mesa
  if (!gameMin.dom) el['overlay-domino'].hidden = false;
}


// ---------- Truco (mesa: vira, placar, vaza central, mão em CSS puro) ----------
function truCardHTML(cardStr, { small = false, back = false } = {}) {
  if (back) return `<span class="tru-card back${small ? ' sm' : ''}"></span>`;
  const [r, s] = String(cardStr).split(':');
  const suit = { ouros: '♦', espadas: '♠', copas: '♥', paus: '♣', bastos: '🪵' }[s] || s;
  const red = s === 'copas' || s === 'ouros';
  return `<span class="tru-card${red ? ' red' : ''}${small ? ' sm' : ''}"><b>${esc(r)}</b><i>${suit}</i></span>`;
}
export function trucoStartChoice(vm) {
  el['tru-setup'].innerHTML = `<div class="dom-start">
    <p class="dom-start-q">${t('tru.how')} <small>(${vm.mode})</small></p>
    <button class="btn btn-primary btn-lg" id="btn-tru-pta">🂠 ${t('tru.vPaulista')}</button>
    <button class="btn btn-ghost dom-start-alt" id="btn-tru-min">⛏️ ${t('tru.vMineira')}</button>
    <button class="btn btn-ghost dom-start-alt" id="btn-tru-gau">🧉 ${t('tru.vGaucha')}</button>
    <p class="dom-start-note">${t('tru.note')}</p>
  </div>`;
  el['tru-setup'].querySelector('#btn-tru-pta').onclick = () => H.onTrucoStart('paulista');
  el['tru-setup'].querySelector('#btn-tru-min').onclick = () => H.onTrucoStart('mineira');
  el['tru-setup'].querySelector('#btn-tru-gau').onclick = () => H.onTrucoStart('gaucha');
  el['tru-setup'].hidden = false; el['tru-game'].hidden = true;
  el['btn-tru-end'].hidden = true;
  if (!gameMin.truco) el['overlay-truco'].hidden = false;
}
export function renderTruco(vm) {
  el['tru-setup'].hidden = true; el['tru-game'].hidden = false;
  el['tru-score'].innerHTML = `<span class="tru-var">${esc(vm.variant)}</span>
    <b class="${vm.myTeam === 0 ? 'us' : ''}">${vm.score[0]}</b> × <b class="${vm.myTeam === 1 ? 'us' : ''}">${vm.score[1]}</b>
    <span class="tru-stake">${t('tru.worth', { n: vm.stake })}</span>`;
  el['tru-vira'].innerHTML = vm.vira ? `${t('tru.vira')} ${truCardHTML(vm.vira, { small: true })}` : '';
  el['tru-vira'].hidden = !vm.vira;
  if (vm.audit) { el['tru-audit'].hidden = false; el['tru-audit'].textContent = vm.audit === 'ok' ? t('tru.auditOk') : t('tru.auditBad'); el['tru-audit'].className = 'dom-verified ' + (vm.audit === 'ok' ? 'ok' : 'bad'); }
  else el['tru-audit'].hidden = true;
  el['tru-status'].textContent = vm.handshake || vm.turnName || '';
  el['tru-table'].innerHTML = (vm.table || []).map((p) => `<span class="tru-played${p.self ? ' me' : ''}">
    ${truCardHTML(p.card && p.card.r ? p.card.r + ':' + p.card.s : p.card)}<small>${avInner(p.photo, p.avatar, false)} ${esc(p.name)}</small></span>`).join('');
  el['tru-hand'].innerHTML = (vm.mine || []).map((m) =>
    `<button class="tru-hcard${vm.myTurn ? '' : ' dim'}" data-card="${esc(m.card)}"${vm.myTurn ? '' : ' disabled'}>${truCardHTML(m.card)}</button>`).join('');
  el['tru-hand'].querySelectorAll('.tru-hcard:not([disabled])').forEach((b) => b.addEventListener('click', () => H.onTrucoPlay(b.dataset.card)));
  let acts = '';
  if (vm.envido && vm.envido.pend && !vm.envido.pend.mine) {
    acts += `<div class="tru-pend">${t('tru.envQ', { chain: vm.envido.pend.chain })}</div>
      <div class="tru-btns">
        <button class="btn btn-primary" id="btn-tru-envacc">${t('tru.accept')}</button>
        ${vm.envido.canReal ? `<button class="btn btn-ghost" id="btn-tru-realenv">${t('tru.realEnv')}</button>` : ''}
        <button class="btn btn-ghost tru-run" id="btn-tru-envrun">${t('tru.run')}</button>
      </div>`;
  } else if (vm.envido && vm.envido.pend && vm.envido.pend.mine) {
    acts += `<div class="tru-pend">${t('tru.envWait', { chain: vm.envido.pend.chain })}</div>`;
  } else if (vm.envido && vm.envido.canCall) {
    acts += `<div class="tru-btns">
      <button class="btn btn-ghost" id="btn-tru-env">🎯 ${t('tru.envCall')}</button>
      ${vm.envido.canFlor ? `<button class="btn btn-ghost" id="btn-tru-flor">🌸 ${t('tru.florCall')}</button>` : ''}
    </div>`;
  }
  if (vm.envido && vm.envido.closed && vm.envido.myPts != null && vm.envido.value > 0) {
    acts += `<div class="tru-envinfo">${t('tru.envMine', { n: vm.envido.myPts })}</div>`;
  }
  if (vm.onze) {
    acts = vm.onze.mine
      ? `<div class="tru-onze">${t('tru.onzeQ', { n: vm.onze.value })}
           <button class="btn btn-primary" id="btn-tru-onze-go">${t('tru.onzePlay')}</button>
           <button class="btn btn-ghost" id="btn-tru-onze-run">${t('tru.onzeRun')}</button></div>`
      : `<div class="tru-onze">${t('tru.onzeWait')}</div>`;
  } else if (vm.pend) {
    acts += vm.pend.mine
      ? `<div class="tru-pend">${t('tru.pendWait', { label: vm.pend.label })}</div>`
      : `<div class="tru-pend">${t('tru.pendQ', { label: vm.pend.label, n: vm.pend.value })}</div>
         <div class="tru-btns">
           <button class="btn btn-primary" id="btn-tru-acc">${t('tru.accept')}</button>
           ${vm.pend.canRaiseBack ? `<button class="btn btn-ghost" id="btn-tru-reraise">${t('tru.raiseBack')}</button>` : ''}
           <button class="btn btn-ghost tru-run" id="btn-tru-run">${t('tru.run')}</button>
         </div>`;
  } else if (vm.canRaise && !(vm.envido && vm.envido.pend)) {
    acts += `<button class="btn btn-ghost tru-raise" id="btn-tru-raise">🔥 ${esc(vm.raiseLabel)}</button>`;
  }
  el['tru-actions'].innerHTML = acts;
  const on = (id, fn) => { const b = el['tru-actions'].querySelector('#' + id); if (b) b.onclick = fn; };
  on('btn-tru-raise', () => H.onTrucoRaise());
  on('btn-tru-acc', () => H.onTrucoResp('accept'));
  on('btn-tru-reraise', () => H.onTrucoResp('raise'));
  on('btn-tru-run', () => H.onTrucoResp('fold'));
  on('btn-tru-onze-go', () => H.onTrucoOnze(true));
  on('btn-tru-onze-run', () => H.onTrucoOnze(false));
  on('btn-tru-env', () => H.onTrucoEnv('envido'));
  on('btn-tru-realenv', () => H.onTrucoEnv('realenvido'));
  on('btn-tru-envacc', () => H.onTrucoEnvResp('accept'));
  on('btn-tru-envrun', () => H.onTrucoEnvResp('fold'));
  on('btn-tru-flor', () => H.onTrucoFlor());
  const res = vm.gameResult || vm.handResult || '';
  el['tru-result'].textContent = res;
  el['tru-result'].hidden = !res;
  el['tru-result'].className = 'dom-result' + (res && (vm.gameResult ? vm.gameOver : true) && /🏆|!/.test(res) ? '' : '');
  el['btn-tru-end'].hidden = !!vm.gameOver;
  if (!gameMin.truco) el['overlay-truco'].hidden = false;
}

// ---------- Jukebox ----------
export function openJukebox(vm) {
  renderJukebox((vm && vm.songs) || []);
  el['jukebox-input'].value = '';
  el['overlay-jukebox'].hidden = false;
}
export function renderJukebox(list) {
  el['jukebox-list'].innerHTML = (list || []).map((s, i) => `<li class="jbx-row">
    <span class="jbx-n">${i + 1}</span>
    <div class="jbx-main"><span class="jbx-title">${esc(s.title)}</span>
      <span class="jbx-by">pedida por ${esc(s.name || t('common.someoneLow'))}</span></div>
    <button class="jbx-play" data-i="${i}" aria-label="${t('jbx.play')}">▶️</button></li>`).join('') || `<li class="jbx-row">${t('jbx.empty')}</li>`;
  el['jukebox-list'].querySelectorAll('.jbx-play').forEach((b) => b.addEventListener('click', () => H.onSongPlay(list[Number(b.dataset.i)])));
}
function submitSong() {
  const t = el['jukebox-input'].value.trim();
  if (!t) { el['jukebox-input'].focus(); return; }
  H.onSongAdd(t);
  el['jukebox-input'].value = '';
}

// ---------- Modo festa (visualizador + trilha lo-fi procedural) ----------
let festaRAF = null;
function drawFesta() {
  const cv = el['festa-canvas'];
  if (!cv) return;
  const g = cv.getContext('2d');
  const W = cv.width, Hh = cv.height;
  const spec = music.spectrum();
  g.clearRect(0, 0, W, Hh);
  const light = document.body.classList.contains('light');
  const n = spec.length || 1;
  const bw = W / n;
  for (let i = 0; i < n; i++) {
    const h = (spec[i] / 255) * Hh;
    g.fillStyle = `hsl(${38 + (i / n) * 22}, 85%, ${light ? 42 : 58}%)`;
    g.fillRect(i * bw + 1, Hh - h, bw - 2, h);
  }
  festaRAF = requestAnimationFrame(drawFesta);
}
export function openFesta() {
  music.start();
  el['overlay-festa'].hidden = false;
  if (!festaRAF) drawFesta();
}
function stopFesta() {
  if (festaRAF) { cancelAnimationFrame(festaRAF); festaRAF = null; }
  music.stop();
}

// ---------- Passaporte de botecos (check-ins locais) ----------
export function openPassport(vm) {
  const list = (vm && vm.checkins) || [];
  const places = new Set(list.map((c) => c.name || t('pass.fallback'))).size;
  el['passport-count'].textContent = list.length
    ? `${list.length} check-in${list.length === 1 ? '' : 's'} · ${places} lugar${places === 1 ? '' : 'es'}`
    : t('pass.empty');
  el['passport-list'].innerHTML = list.map((c) => {
    const d = new Date(c.at);
    const when = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    const map = (c.lat != null && c.lng != null) ? `https://maps.google.com/?q=${c.lat},${c.lng}` : '';
    return `<li class="pass-row"><span class="pass-pin">📍</span>
      <div class="pass-main"><span class="pass-name">${esc(c.name || t('pass.fallback'))}</span><span class="pass-when">${when}</span></div>
      ${map ? `<a class="pass-map" href="${map}" target="_blank" rel="noopener" aria-label="ver no mapa">🗺️</a>` : ''}</li>`;
  }).join('') || '<li class="pass-row">Nenhum check-in ainda 🥲</li>';
  el['passport-name'].value = (vm && vm.suggestName) || '';
  el['overlay-passport'].hidden = false;
  setTimeout(() => { try { el['passport-name'].focus(); } catch { /* ignore */ } }, 60);
}

// ---------- Foto da noite (álbum local) ----------
let lastPhoto = null;
function showPhoto() {
  const f = el['photo-input'].files && el['photo-input'].files[0];
  if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    lastPhoto = { url: String(rd.result), name: f.name || 'boteco.jpg', type: f.type || 'image/jpeg' };
    el['photo-wrap'].innerHTML = `<img src="${lastPhoto.url}" alt="foto da noite" />`;
    el['overlay-photo'].hidden = false;
    el['photo-input'].value = '';
  };
  rd.onerror = () => { toast(t('toast.photoOpen')); el['photo-input'].value = ''; };
  rd.readAsDataURL(f);
}
export function currentPhoto() { return lastPhoto; }

// ---------- Guia de boas-vindas (primeira vez) ----------
export function openWelcome() { el['overlay-welcome'].hidden = false; }

// ---------- Overlays / toast ----------
export function closeOverlays() {
  if (activeScan) { activeScan.stop(); activeScan = null; }
  stopFesta();
  document.querySelectorAll('.overlay').forEach((o) => { o.hidden = true; });
  if (lastFocus) { try { lastFocus.focus({ preventScroll: true }); } catch { /* ignore */ } lastFocus = null; }
}
let toastTimer = null;
export function toast(msg) {
  const t = el['toast']; t.onclick = null; t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}
// Toast com uma acao (ex.: "desfazer", "chamar carro").
export function actionToast(msg, label, cb, ms = 5000) {
  const t = el['toast'];
  t.innerHTML = `${esc(msg)} · <span class="toast-action">${esc(label)}</span>`;
  t.hidden = false;
  const done = () => { clearTimeout(toastTimer); t.hidden = true; t.onclick = null; };
  t.onclick = () => { done(); if (cb) cb(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(done, ms);
}
