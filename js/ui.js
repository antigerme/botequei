// ============================================================================
// ui.js — A CAMADA DE APRESENTAÇÃO. Telas, overlays, cards, gestos e efeitos.
//
// Contrato com o app.js (mão dupla, e SÓ com ele):
//   entrada → o app chama funções exportadas (render*, open*, toast…) passando
//             um VIEW-MODEL pronto (objetos simples; nada de estado de domínio
//             vive aqui — este arquivo não sabe o que é CRDT nem WebRTC);
//   saída   → interações do usuário disparam handlers do objeto H (H.onAdd,
//             H.onProfileSave…), registrado em init(handlers) pelo app.js.
//
// Regras da casa que este arquivo carrega:
//   - TODO id de elemento usado aqui PRECISA estar no array IDS abaixo —
//     init() amarra os listeners por ele e a auditoria (tests/audit.mjs)
//     confere IDS ↔ index.html (id fantasma quebra o CI, não a produção);
//   - toda string visível nasce do t() de i18n.js (três línguas; audit trava);
//   - overlays seguem o padrão .overlay > .sheet (a11y automática: role=dialog,
//     foco preso e ESC via setupA11y); gestos: toque = +1, toque longo = −1.
//
// SUMÁRIO (âncoras "// ----------" na ordem do arquivo):
//   Gesto curto/longo · Init · A11y · Home · Mesa · Placar · Convite · Perfil
//   (+ foto: captura e recorte) · Novo item · Preços · Conta · PIX · Configs ·
//   Reações · Efeitos · Jogos (grid) · Offline (QR) · Scanner ·
//   Meu ritmo · Roleta · Cutucar · Cerimônia · Meus números · Presença ·
//   Comanda · Tour · Tô de boa? · Retrospectiva · Liga · Torneio ·
//   Carta da mesa · Purrinha · Jogo minimizado · Dominó · Truco ·
//   Passaporte de botecos · Guia de boas-vindas ·
//   Overlays/toast (tema e idioma vivem na seção Configurações: resolveTheme/
//   applyTheme/applyLang)
// ============================================================================

import { EMOJIS, COLORS, AVATARS, CATEGORIES } from './catalog.js';
import { snakeLayout } from './domino.js';
import { scanQR, scanSupported } from './scan.js';
import { applyI18n, setLang, t } from './i18n.js';
import { VERSION, verLabel } from './version.js';

const $ = (id) => document.getElementById(id);
let H = {};
const el = {};

const IDS = [
  'screen-home', 'screen-table', 'input-name', 'input-code', 'btn-create', 'btn-join-code',
  'home-history', 'history-list', 'home-hint', 'btn-install', 'btn-me',
  'overlay-me', 'me-avatar', 'me-name', 'me-profile', 'me-stats', 'me-passport', 'me-settings',
  'table-title', 'mesa-code', 'my-total', 'table-total', 'money-block', 'my-money', 'peer-count', 'table-hint', 'hero-fill',
  'conn-banner', 'presence-bar', 'items-grid', 'btn-additem', 'btn-invite', 'btn-leave', 'btn-peers', 'btn-menu',
  'menu-empty', 'btn-empty-custom', 'btn-empty-boteco',
  'btn-react', 'btn-rodada', 'btn-games', 'overlay-games', 'games-grid',
  'overlay-invite', 'qr-wrap', 'big-code', 'table-name-input', 'table-emoji-btn', 'table-emoji-row', 'invite-pin',
  'btn-copy-link', 'btn-share-invite',
  'overlay-join', 'join-code-label', 'join-name', 'join-pin-field', 'join-pin', 'btn-join-confirm',
  'overlay-peers', 'mvp-banner', 'peers-list', 'my-badges',
  'overlay-menu',
  'menu-bill', 'menu-prices',
  'menu-waiter', 'menu-share', 'menu-tour', 'btn-peers-crown', 'btn-bill-crown',
  'overlay-prices', 'price-list',
  'overlay-profile', 'profile-name', 'profile-colors', 'profile-avatars', 'profile-driver', 'btn-profile-save',
  'profile-preview', 'profile-preview-emoji', 'profile-photo-img', 'btn-avatar-webcam', 'btn-avatar-camera', 'btn-avatar-upload', 'avatar-file',
  'overlay-crop', 'crop-canvas', 'crop-zoom', 'btn-crop-use',
  'overlay-camera', 'cam-video', 'btn-cam-shoot',
  'overlay-additem', 'emoji-row', 'add-name', 'add-price', 'add-note', 'add-share', 'btn-additem-confirm',
  'add-prev-emoji', 'add-prev-name', 'add-prev-sub',
  'overlay-bill', 'bill-note', 'bill-tips', 'bill-couvert', 'bill-equal', 'bill-list', 'bill-total', 'btn-bill-share',
  'bill-pool', 'bill-pool-line', 'bill-shareall-wrap', 'bill-shareall', 'bill-bankrolls',
  'bill-pix-setup', 'bill-pixkey', 'btn-bill-pixkey',
  'overlay-pix', 'pix-title', 'pix-qr', 'pix-code', 'btn-pix-copy',
  'overlay-settings', 'set-theme', 'set-bigfont', 'set-sound', 'set-geo', 'btn-version',
  'dev-section', 'set-dev', 'btn-dev-report', 'btn-dev-copy', 'btn-dev-view', 'dev-log-view', 'dev-fab',
  'set-lang',
  'set-pixkey', 'set-pixcity', 'btn-export-data', 'btn-import-data', 'import-file', 'btn-clear-data',
  'overlay-react', 'react-row',
  'overlay-poke', 'poke-title', 'poke-actions',
  'overlay-payround', 'payround-list',
  'overlay-ceremony', 'ceremony-list', 'btn-ceremony-share', 'btn-ceremony-broadcast',
  'overlay-stats', 'stats-grid', 'stats-badges', 'stats-chart', 'stats-chart-h', 'stats-insight', 'stats-history', 'btn-stats-share',
  'overlay-comanda', 'comanda-title', 'comanda-away', 'comanda-list', 'comanda-total', 'comanda-actions',
  'set-shake',
  'overlay-purrinha', 'purr-sub', 'purr-setup', 'purr-pick', 'purr-pstatus', 'purr-hands', 'purr-guess-wrap', 'purr-guesses', 'btn-purr-seal',
  'purr-wait', 'purr-waitcount', 'purr-waitsub', 'purr-seals',
  'purr-guessing', 'purr-status', 'purr-said', 'purr-turnrow', 'purr-gpick', 'btn-purr-say',
  'purr-result', 'purr-rstatus', 'purr-total', 'purr-reveals', 'purr-verdict',
  'btn-purr-again', 'btn-purr-close',
  'overlay-domino', 'btn-dom-close', 'dom-setup', 'dom-game', 'dom-verified',
  'dom-opps', 'dom-turn', 'dom-board', 'dom-result',
  'dom-hand-wrap', 'dom-hand', 'dom-side-pick', 'btn-dom-L', 'btn-dom-R', 'dom-endL', 'dom-endR',
  'btn-dom-pass', 'btn-dom-again', 'game-pill',
  'tour', 'tour-spot', 'tour-balloon', 'tour-count', 'tour-title', 'tour-text', 'btn-tour-skip', 'btn-tour-next',
  'overlay-tour', 'tour-trails',
  'overlay-truco', 'btn-tru-close', 'tru-setup', 'tru-game', 'tru-status', 'tru-score', 'tru-vira', 'tru-table',
  'tru-hand', 'tru-actions', 'tru-result', 'tru-audit',
  'overlay-passport', 'passport-count', 'passport-list',
  'overlay-boteco', 'boteco-title', 'boteco-stats', 'boteco-menu', 'btn-boteco-load',
  'btn-boteco-rename', 'btn-boteco-del', 'btn-boteco-delall', 'boteco-rename-box', 'boteco-rename', 'btn-boteco-rename-go',
  'btn-open-data', 'overlay-data', 'data-list',
  'overlay-welcome', 'btn-welcome-go', 'welcome-demo', 'welcome-demo-n',
  'league-level', 'league-challenges', 'league-season',
  'btn-offline-join', 'btn-offline-host',
  'overlay-offline', 'off-host', 'off-guest',
  'off-offer-qr', 'off-offer-code', 'btn-off-copy-offer', 'btn-off-scan-answer', 'off-answer-in', 'btn-off-connect',
  'off-offer-in', 'btn-off-scan-offer', 'btn-off-genanswer', 'off-answer-out', 'off-answer-qr', 'off-answer-code', 'btn-off-copy-answer',
  'overlay-scan', 'scan-title', 'scan-video', 'scan-hint', 'btn-scan-close',
  'fx-layer', 'brinde', 'brinde-count', 'brinde-word',
  'toast',
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
  let timer = null, longFired = false, sx = 0, sy = 0, active = false, pid = null;
  const LONG = 480, MOVE = 14;
  const cancel = () => { active = false; pid = null; if (timer) { clearTimeout(timer); timer = null; } };
  node.addEventListener('pointerdown', (e) => {
    if (active) return; // UM dedo por card: o 2º toque simultâneo NÃO abre outro gesto (dois
    // dedos no mesmo card sobrescreviam o timer sem cancelá-lo → onLong dobrado = −1/−2 fantasma)
    active = true; longFired = false; pid = e.pointerId; sx = e.clientX; sy = e.clientY;
    try { node.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    timer = setTimeout(() => { if (active) { longFired = true; onLong(); } }, LONG);
  });
  node.addEventListener('pointermove', (e) => {
    if (active && e.pointerId === pid && (Math.abs(e.clientX - sx) > MOVE || Math.abs(e.clientY - sy) > MOVE)) cancel();
  });
  node.addEventListener('pointerup', (e) => { if (e.pointerId !== pid) return; if (active && !longFired) onTap(); cancel(); e.preventDefault(); });
  node.addEventListener('pointercancel', (e) => { if (e.pointerId === pid) cancel(); });
  node.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---------- Init ----------
export function init(handlers) {
  H = handlers;
  IDS.forEach((id) => { el[id] = $(id); });

  el['btn-create'].addEventListener('click', () => H.onCreate());
  el['btn-join-code'].addEventListener('click', () => H.onJoinCode(el['input-code'].value));
  el['input-name'].addEventListener('change', () => H.onName(el['input-name'].value));
  el['input-name'].addEventListener('input', syncCreateBtn); // o "Criar mesa" só liga quando há apelido
  el['btn-me'].addEventListener('click', () => H.onMe()); // avatar no canto da home → hub pessoal
  el['btn-install'].addEventListener('click', () => H.onInstall());
  // hub do "Você": cada item abre o overlay que já existe (padrão de troca do menu — fecha o hub, abre o alvo)
  el['me-profile'].addEventListener('click', () => { closeOverlays(); H.onProfile(); });
  el['me-stats'].addEventListener('click', () => { closeOverlays(); H.onStats(); });
  el['me-passport'].addEventListener('click', () => { closeOverlays(); H.onPassport(); });
  el['me-settings'].addEventListener('click', () => { closeOverlays(); openSettings(); });
  // teu rosto grande no hub é a porta do perfil (ação óbvia > botão extra — igual tocar no emoji volta pro emoji)
  el['me-avatar'].addEventListener('click', () => { closeOverlays(); H.onProfile(); });

  // sair da mesa pede confirmação (um toque errado no ‹ não te derruba da mesa)
  $('btn-leave').addEventListener('click', () => actionToast(t('menu.leaveQ'), t('menu.leaveDo'), () => H.onLeave()));
  $('btn-invite').addEventListener('click', () => H.onInvite());
  $('btn-peers').addEventListener('click', () => H.onPeers());
  $('money-block').addEventListener('click', () => H.onBill()); // tocar na conta abre "Fechar a conta"
  $('btn-menu').addEventListener('click', () => { el['overlay-menu'].hidden = false; });
  $('btn-games').addEventListener('click', () => openGames());
  $('btn-additem').addEventListener('click', () => openAddItem());      // "+ item" da mesa montada
  $('btn-empty-custom').addEventListener('click', () => openAddItem()); // mesa limpa: mesmo overlay, catálogo primeiro
  $('btn-empty-boteco').addEventListener('click', () => H.onLoadBoteco()); // recarrega o cardápio salvo do boteco
  $('btn-react').addEventListener('click', () => openReact());
  $('btn-rodada').addEventListener('click', () => H.onPayRound()); // 💸 Rodada: você paga uma rodada pra mesa (era o "Pagar rodada" do menu)

  $('btn-additem-confirm').addEventListener('click', () => submitAddItem());
  $('add-name').addEventListener('input', renderAddPreview);   // preview ao vivo enquanto digita
  $('add-price').addEventListener('input', renderAddPreview);
  $('add-share').addEventListener('change', renderAddPreview);
  $('btn-join-confirm').addEventListener('click', () => H.onJoinConfirm(el['join-name'].value, el['join-pin'].value));
  $('btn-copy-link').addEventListener('click', () => H.onCopyLink());
  $('btn-share-invite').addEventListener('click', () => H.onShareInvite());
  el['table-name-input'].addEventListener('change', () => H.onTableName(el['table-name-input'].value));
  el['table-emoji-btn'].addEventListener('click', () => el['table-emoji-row'].hidden = !el['table-emoji-row'].hidden);
  el['invite-pin'].addEventListener('change', () => H.onInvitePin(el['invite-pin'].value));

  // menu "…" (só coisa de MESA — perfil/números/config moram no hub do avatar agora)
  $('menu-bill').addEventListener('click', () => { closeOverlays(); H.onBill(); });
  $('menu-prices').addEventListener('click', () => { closeOverlays(); H.onPrices(); });
  $('menu-waiter').addEventListener('click', () => { closeOverlays(); H.onWaiter(); });
  // "🏅 Coroar a noite" — a cerimônia agora mora no Placar (casa das conquistas) e no fechar a conta
  // (o momento natural do fim da noite), não mais num tile do "…". Fecha o overlay atual e abre a cerimônia.
  el['btn-peers-crown'].addEventListener('click', () => { closeOverlays(); H.onCeremony(); });
  el['btn-bill-crown'].addEventListener('click', () => { closeOverlays(); H.onCeremony(); });
  $('menu-share').addEventListener('click', () => { closeOverlays(); H.onShareNight(); });
  $('menu-tour').addEventListener('click', () => { closeOverlays(); H.onTourMenu(); });

  // cerimônia
  el['btn-ceremony-share'].addEventListener('click', () => H.onCeremonyShare());
  el['btn-ceremony-broadcast'].addEventListener('click', () => H.onCeremonyBroadcast());

  // "📸 Compartilhar meu rolê" nos Meus Números (o Retrô fundiu aqui): reusa o card do rolê (onRetroShare)
  el['btn-stats-share'].addEventListener('click', () => H.onRetroShare());
  el['btn-purr-seal'].addEventListener('click', () => {
    if (purrPick.hand == null || (!purrClassic && purrPick.guess == null)) return;
    H.onPurrSeal(purrPick.hand, purrPick.guess);
  });
  el['btn-purr-say'].addEventListener('click', () => { if (purrSaid != null) H.onPurrGuess(purrSaid); });
  el['btn-purr-again'].addEventListener('click', () => H.onPurrAgain()); // "de novo" REPETE a última config (setup só no grid 🎮)
  el['btn-purr-close'].addEventListener('click', () => H.onPurrClose()); // ✕ minimiza (jogo segue); encerrar é o ✕ da pill
  el['btn-dom-pass'].addEventListener('click', () => H.onDomPass());
  el['btn-dom-again'].addEventListener('click', () => H.onDomAgain()); // "de novo" REPETE a última config (setup só no grid 🎮)
  el['btn-dom-close'].addEventListener('click', () => H.onDomClose());
  // pill de "jogo rolando": no chip, tocar no rótulo VOLTA pro jogo; o ✕ vermelho ENCERRA pra mesa toda
  el['game-pill'].addEventListener('click', (e) => {
    const end = e.target.closest('.game-chip-end'), open = e.target.closest('.game-chip-open');
    if (end) H.onGamePillEnd(end.dataset.kind);
    else if (open) H.onGamePillOpen(open.dataset.kind);
  });
  el['btn-tru-close'].addEventListener('click', () => H.onTrucoClose());
  // tour: tocar em qualquer lugar avança; "pular" encerra
  el['tour'].addEventListener('click', () => tourNext());
  el['btn-tour-next'].addEventListener('click', (e) => { e.stopPropagation(); tourNext(); });
  el['btn-tour-skip'].addEventListener('click', (e) => { e.stopPropagation(); endTour(); });
  el['tour'].addEventListener('click', () => { if (tourSteps) tourNext(); }); // toque em qualquer lugar avança (padrão stories)
  window.addEventListener('resize', () => { if (tourSteps) renderTourStep(); }); // girou o aparelho no meio? recorte segue o alvo

  el['btn-dom-L'].addEventListener('click', () => { if (domArmed) H.onDomPlay(domArmed, 'L'); domArmed = null; el['dom-side-pick'].hidden = true; });
  el['btn-dom-R'].addEventListener('click', () => { if (domArmed) H.onDomPlay(domArmed, 'R'); domArmed = null; el['dom-side-pick'].hidden = true; });
  el['btn-boteco-load'].addEventListener('click', () => H.onBotecoLoadNew(el['btn-boteco-load'].dataset.place || ''));
  // gerenciar cardápio salvo (na ficha do boteco): renomear o lugar / apagar o cardápio
  el['btn-boteco-rename'].addEventListener('click', () => {
    const box = el['boteco-rename-box'];
    box.hidden = !box.hidden;
    if (!box.hidden) setTimeout(() => { try { el['boteco-rename'].focus(); el['boteco-rename'].select(); } catch { /* ignore */ } }, 60);
  });
  const doRename = () => H.onBotecoRename(el['overlay-boteco'].dataset.place || '', el['boteco-rename'].value);
  el['btn-boteco-rename-go'].addEventListener('click', doRename);
  el['boteco-rename'].addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doRename(); } });
  el['btn-boteco-del'].addEventListener('click', () => H.onBotecoDelMenu(el['overlay-boteco'].dataset.place || ''));
  el['btn-boteco-delall'].addEventListener('click', () => H.onDeletePlaceAll(el['overlay-boteco'].dataset.place || ''));
  el['btn-welcome-go'].addEventListener('click', () => { closeOverlays(); focusNameSoft(); }); // solta na HOME (apelido/criar moram lá) e foca o apelido
  { // demo do bem-vindo: o GESTO do app pra treinar antes da 1ª mesa (toque = +1, segurar = −1)
    let n = 0, tm = null, held = false;
    const card = el['welcome-demo'];
    const bump = () => { el['welcome-demo-n'].textContent = String(n); card.classList.remove('pop'); void card.offsetWidth; card.classList.add('pop'); try { if (navigator.vibrate) navigator.vibrate(held ? 18 : 8); } catch { /* ignore */ } };
    card.addEventListener('pointerdown', () => { held = false; tm = setTimeout(() => { held = true; if (n > 0) { n--; bump(); } }, 480); });
    const up = (e) => { if (tm) { clearTimeout(tm); tm = null; } if (e.type === 'pointerup' && !held) { n++; bump(); } held = false; };
    card.addEventListener('pointerup', up); card.addEventListener('pointercancel', up); card.addEventListener('pointerleave', up);
    card.addEventListener('contextmenu', (e) => e.preventDefault()); // segurar no touch não abre menu
  }

  $('btn-profile-save').addEventListener('click', () => submitProfile());
  // foto de perfil: "Trocar foto" abre o sheet NATIVO do sistema (câmera OU galeria no celular;
  // arquivo no desktop) — SEM `capture`, é o SO quem monta o menu. A "Webcam" (só no desktop,
  // onde o seletor de arquivo não tem câmera) abre a câmera ao vivo, mesmo motor do leitor de QR.
  // Câmera nativa: seta capture (o SO abre o app de câmera direto — selfie do perfil). Galeria:
  // TIRA o capture (input volta a ser seletor de imagens). Os dois caem no MESMO #avatar-file →
  // mesmo recorte. Sem isso, no Android moderno o "Trocar foto" ia direto pro Photo Picker (só galeria).
  el['btn-avatar-camera'].addEventListener('click', () => { el['avatar-file'].setAttribute('capture', 'user'); el['avatar-file'].click(); });
  el['btn-avatar-upload'].addEventListener('click', () => { el['avatar-file'].removeAttribute('capture'); el['avatar-file'].click(); });
  el['btn-avatar-webcam'].addEventListener('click', () => openCam());
  el['btn-cam-shoot'].addEventListener('click', () => shootCam());
  el['avatar-file'].addEventListener('change', () => avatarFilePicked());
  el['btn-crop-use'].addEventListener('click', () => cropUse());
  bindCrop();
  $('btn-pix-copy').addEventListener('click', () => H.onPixCopy());

  // conta: recalcular ao mudar opcoes + presets de gorjeta + compartilhar
  ['bill-couvert', 'bill-equal', 'bill-shareall'].forEach((id) => {
    el[id].addEventListener('change', () => H.onBillChange());
    el[id].addEventListener('input', () => H.onBillChange());
  });
  el['bill-tips'].querySelectorAll('button[data-tip]').forEach((b) => b.addEventListener('click', () => { billTip = Number(b.dataset.tip) || 0; markTip(); H.onBillChange(); }));
  el['btn-bill-share'].addEventListener('click', () => H.onBillShare());
  // captura a chave PIX no momento da conta (aparece só quando não há chave e há dinheiro a receber)
  el['btn-bill-pixkey'].addEventListener('click', () => { const v = el['bill-pixkey'].value.trim(); if (v) H.onBillSetPix(v); });

  // configuracoes: aplicar ao mudar
  el['set-theme'].addEventListener('change', () => H.onSetting({ theme: el['set-theme'].value }));
  el['set-lang'].addEventListener('change', () => H.onSetting({ lang: el['set-lang'].value }));
  el['set-bigfont'].addEventListener('change', () => H.onSetting({ bigFont: el['set-bigfont'].checked }));
  el['set-sound'].addEventListener('change', () => H.onSetting({ sound: el['set-sound'].checked }));
  el['set-shake'].addEventListener('change', () => H.onShakeToggle(el['set-shake'].checked));
  el['set-geo'].addEventListener('change', () => H.onGeoToggle(el['set-geo'].checked)); // ligar pede a permissão; recusar volta pra off
  el['set-dev'].addEventListener('change', () => H.onDevToggle(el['set-dev'].checked));
  el['btn-dev-report'].addEventListener('click', () => H.onDevReport());
  el['dev-fab'].addEventListener('click', () => H.onDevShot()); // 📸 flutuante: captura a tela ATUAL em contexto
  el['btn-dev-copy'].addEventListener('click', () => H.onDevCopy());
  el['btn-dev-view'].addEventListener('click', () => H.onDevView());

  // versão no rodapé das configs (serial de zona YYYYMMDDnn): tocar confere se há mais nova
  el['btn-version'].textContent = '🍺 Botequei ' + verLabel(VERSION);
  el['btn-version'].addEventListener('click', () => H.onCheckUpdate());
  el['set-pixkey'].addEventListener('change', () => H.onSetting({ pixKey: el['set-pixkey'].value.trim() }));
  el['set-pixcity'].addEventListener('change', () => H.onSetting({ pixCity: el['set-pixcity'].value.trim() }));
  el['btn-open-data'].addEventListener('click', () => H.onOpenData());
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
  // barra de presença: tocar no SEU rosto (data-self) abre o hub pessoal; no resto da barra → placar
  el['presence-bar'].addEventListener('click', (e) => { if (e.target.closest('[data-self]')) H.onMe(); else H.onPeers(); });

  // offline (pareamento por QR/código, sem servidor)
  el['btn-offline-join'].addEventListener('click', () => H.onOfflineJoin());
  ['online', 'offline'].forEach((ev) => window.addEventListener(ev, syncOfflineEntry)); // conectou/caiu → mostra/esconde o 📴
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

  // girar o aparelho / redimensionar: a media query troca o layout, o scale do tabuleiro
  // precisa acompanhar (senão as pedras ficam no tamanho da orientação antiga)
  const domRefit = () => { if (el['overlay-domino'] && !el['overlay-domino'].hidden) requestAnimationFrame(domFitBoard); };
  window.addEventListener('resize', domRefit);
  window.addEventListener('orientationchange', domRefit);

  setupA11y();
  setupSheetSwipe();
}

// ---------- Acessibilidade: diálogos, ESC, armadilha de foco ----------
function openOverlayEls() { return [...document.querySelectorAll('.overlay')].filter((o) => !o.hidden); }
function focusables(root) {
  return [...root.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])')]
    .filter((x) => !x.disabled && x.offsetParent !== null);
}
// Botão VOLTAR (Android) / swipe de voltar (iOS) fecha o overlay aberto, em vez de sair do app.
// Modelo de UM estado só (robusto): enquanto HÁ overlay aberto, mantemos UM estado empurrado no
// histórico; o "voltar" fecha SÓ o topo e, se ainda sobra overlay, RE-EMPURRA um estado (aí o
// próximo voltar fecha o de baixo — antes um marcador único fechava TODOS de uma vez, e recortar
// foto sobre o perfil perdia o apelido não salvo). Quando o ÚLTIMO fecha, desfazemos o estado com
// history.back() GUARDADO (só se estamos MESMO no nosso estado) — sem esse guard, fechar por
// ✕/ESC/`hidden` direto (o que a suíte e o próprio app fazem) chamava history.go() e NAVEGAVA pra
// FORA da mesa (derrubava a malha). A pilha guarda a ORDEM (topo) e o foco de origem de cada overlay.
const overlayStack = []; // [{ ov, focus }] — foco = o que estava ativo quando aquele overlay abriu
let overlayHistoryPushed = false; // temos UM estado empurrado enquanto ≥1 overlay está aberto?
// Trava de scroll do FUNDO enquanto há overlay aberto (padrão modal M3/HIG). Sem isso o documento
// de trás (.screen, min-height:100dvh) rolava ATRÁS do sheet — o "scroll fantasma" que deixava o
// app com cara de solto. `position:fixed` no body é o único que segura no iOS (o `overflow:hidden`
// ele ignora no toque); guardamos o Y pra devolver EXATO na volta. Idempotente: não re-grava o Y
// ao empilhar um 2º overlay (recortar sobre o perfil), então só destrava quando o ÚLTIMO fecha —
// ref-contado pela contagem real de overlays abertos (openOverlayEls), a mesma do histórico.
let scrollLockY = 0, scrollLocked = false;
function lockScroll(on) {
  if (on === scrollLocked) return;
  const b = document.body;
  if (on) {
    scrollLockY = window.scrollY || window.pageYOffset || 0;
    b.style.top = `-${scrollLockY}px`;
    b.classList.add('scroll-locked');
  } else {
    b.classList.remove('scroll-locked');
    b.style.top = '';
    window.scrollTo(0, scrollLockY);
  }
  scrollLocked = on;
}
function syncOverlayHistory() {
  if (devHook) { // jornada de overlays: só a MUDANÇA (o sync roda em rajada nos closes — sem isso floodava o diário)
    const sig = openOverlayEls().map((o) => o.id).join(',') || '(nenhum)';
    if (sig !== lastOverlaySig) { lastOverlaySig = sig; devHook('tela.overlay', { abertos: sig }); }
  }
  const open = openOverlayEls().length > 0;
  lockScroll(open); // trava/destrava o fundo junto do histórico — fim do scroll fantasma atrás do sheet
  if (open && !overlayHistoryPushed) {
    overlayHistoryPushed = true;
    try { history.pushState({ botequeiOverlay: 1 }, ''); } catch { /* ignore */ }
  } else if (!open && overlayHistoryPushed) {
    // último overlay fechou: desfaz NOSSO estado — mas só se ainda estamos nele (guard: um close
    // por ✕/ESC/hidden não pode navegar pra fora do app se o estado já foi consumido por um voltar)
    overlayHistoryPushed = false;
    try { if (history.state && history.state.botequeiOverlay) history.back(); } catch { /* ignore */ }
  }
}
// remove um overlay da pilha e devolve o foco pro que ficou POR BAIXO (empilhado) ou pra origem
function popOverlayEntry(ov) {
  const i = overlayStack.findIndex((e) => e.ov === ov);
  if (i < 0) return;
  const [entry] = overlayStack.splice(i, 1);
  const top = overlayStack[overlayStack.length - 1];
  const target = top ? (top.ov.querySelector('.sheet') || top.ov) : entry.focus;
  if (target) { try { target.focus({ preventScroll: true }); } catch { /* ignore */ } }
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
      if (!ov.hidden) {
        // abriu: entra na pilha (guardando o foco de origem); sheet reabre sempre do TOPO
        // (scroll fica gravado no elemento escondido, e reabrir rolado esconde a alcinha)
        if (!overlayStack.some((e) => e.ov === ov)) overlayStack.push({ ov, focus: document.activeElement });
        sheet.scrollTop = 0; try { sheet.focus({ preventScroll: true }); } catch { /* ignore */ }
      } else {
        popOverlayEntry(ov); // fechou: sai da pilha e devolve o foco (nunca cai no <body>)
      }
      syncOverlayHistory(); // mantém UM estado no histórico enquanto houver overlay aberto
    }).observe(ov, { attributes: true, attributeFilter: ['hidden'] });
  });
  // voltar (Android/iOS): fecha SÓ o overlay do topo; se sobra overlay, o syncOverlayHistory
  // re-empurra um estado (o próximo voltar fecha o de baixo). Sem overlay nosso na pilha → deixa
  // o app navegar normalmente. O history.back() que NÓS disparamos (quando o último fecha) chega
  // aqui com a pilha JÁ vazia (o observer removeu antes) → cai no return, sem fechar nada por engano.
  window.addEventListener('popstate', () => {
    if (!overlayStack.length) return;
    overlayHistoryPushed = false; // o voltar já consumiu o nosso estado
    const top = overlayStack[overlayStack.length - 1];
    top.ov.hidden = true;         // observer tira da pilha + devolve o foco
    syncOverlayHistory();         // sobrou overlay embaixo? re-empurra um estado pro próximo voltar
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (openOverlayEls().length) { closeOverlays(); e.preventDefault(); }
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

// Alcinha + arrastar-pra-fechar dos sheets (padrão de bottom sheet do Android/iOS).
// A faixa de arrasto é criada AQUI (um elemento por sheet — sem varrer 30 overlays no HTML).
// Fora: os JOGOS (✕ deles minimiza com bookkeeping próprio — um puxão sem querer não pode
// fechar a partida) e o desktop ≥900px (sheet vira diálogo central; o CSS esconde a alcinha).
const NO_SWIPE = new Set(['overlay-domino', 'overlay-purrinha', 'overlay-truco']);
function setupSheetSwipe() {
  document.querySelectorAll('.overlay').forEach((ov) => {
    if (NO_SWIPE.has(ov.id)) return;
    const sheet = ov.querySelector('.sheet');
    if (!sheet) return;
    const grab = document.createElement('div');
    grab.className = 'sheet-grab';
    grab.setAttribute('aria-hidden', 'true'); // decorativa: o ✕ segue sendo o fechar acessível
    sheet.prepend(grab);
    let startY = 0, dragging = false;
    grab.addEventListener('pointerdown', (e) => {
      if (window.matchMedia('(min-width: 900px)').matches) return;
      dragging = true; startY = e.clientY; sheet.style.transition = 'none';
      try { grab.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    grab.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = Math.max(0, e.clientY - startY);
      sheet.style.transform = dy ? `translateY(${dy}px)` : '';
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      const dy = Math.max(0, (e.clientY || 0) - startY);
      sheet.style.transition = '';
      if (dy > 96) { sheet.style.transform = ''; closeOverlays(); }         // puxou de verdade → fecha
      else if (dy) {                                                        // puxãozinho → volta
        if (reducedMotion()) { sheet.style.transform = ''; return; }
        sheet.style.transition = 'transform var(--t-rise) var(--ease-spring)';
        sheet.style.transform = '';
        setTimeout(() => { sheet.style.transition = ''; }, 320);
      }
    };
    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', end);
  });
}
export function reducedMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } }

export function showScreen(name) {
  if (devHook) devHook('tela.screen', { id: name }); // jornada de telas (home ↔ mesa)
  el['screen-home'].classList.toggle('is-active', name === 'home');
  el['screen-table'].classList.toggle('is-active', name === 'table');
}

// ---------- Home ----------
export function setNameInput(v) { el['input-name'].value = v || ''; syncCreateBtn(); }
// o "Criar mesa" parece clicável mas falhava com toast quando o apelido estava vazio: agora TRAVA
// (disabled) até ter texto — evita o beco. Setar o valor por JS não dispara 'input', então quem
// chama setNameInput/o listener de 'input' sincroniza na mão.
function syncCreateBtn() { if (el['btn-create'] && el['input-name']) el['btn-create'].disabled = !el['input-name'].value.trim(); }
// foco SUAVE no apelido — só quando a home está ativa, SEM overlay aberto e o campo vazio (não briga
// com o welcome nem rouba foco de um overlay). Chamado no boot e ao fechar a saudação.
export function focusNameSoft() {
  if (!el['screen-home'] || !el['screen-home'].classList.contains('is-active')) return;
  if (document.querySelector('.overlay:not([hidden])')) return;
  if (!el['input-name'] || el['input-name'].value.trim()) return;
  try { el['input-name'].focus({ preventScroll: true }); } catch { el['input-name'].focus(); }
}
export function showInstall(v) { el['btn-install'].hidden = !v; }

let homeReturning = false; // "já usou o app antes?" — pra revelar o 📴 sem internet (setado no renderHome)
// "📴 Entrar sem internet" só na 1ª tela quando FAZ SENTIDO: sem internet (o navegador avisa) OU
// pra quem já é de casa. Estreante ONLINE não vê o conceito de nicho (home fica Criar + Entrar);
// offline de verdade OU recorrente vê. (e2e-offline seta tourSeen → o botão aparece pro teste.)
function syncOfflineEntry() { if (el['btn-offline-join']) el['btn-offline-join'].hidden = navigator.onLine && !homeReturning; }
export function renderHome(history, me, returning = false) {
  homeReturning = !!returning; syncOfflineEntry();
  const box = el['home-history'], ul = el['history-list'];
  const empty = !history || !history.length;
  if (el['home-hint']) el['home-hint'].hidden = !empty;
  // pinta o avatar do "eu" no canto (abre o hub) — mesma pele .pres-av da barra de presença
  if (el['btn-me'] && me) el['btn-me'].innerHTML = `<span class="pres-av ${frameClass(me.level)}" style="background:${safeColor(me.color)}">${avInner(me.photo, me.emoji)}</span>`;
  if (empty) { box.hidden = true; ul.innerHTML = ''; return; }
  box.hidden = false;
  ul.innerHTML = history.slice(0, 6).map((h) => {
    const d = new Date(h.at);
    const when = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return `<li class="hist-item" data-room="${esc(h.room)}">
      <div class="hist-open" role="button" tabindex="0" aria-label="${esc(h.title || h.room)}">
        <span><strong>${esc(h.room)}</strong> <small>· ${when}</small></span>
        <small>${t('home.histLine', { me: h.myTotal || 0, tt: h.tableTotal || 0 })}</small></div>
      <button class="hist-del" aria-label="${esc(t('data.delMesaAria'))}" title="${esc(t('data.delMesaAria'))}">🗑️</button></li>`;
  }).join('');
  ul.querySelectorAll('.hist-item').forEach((li) => {
    const r = li.dataset.room;
    const open = li.querySelector('.hist-open');
    open.addEventListener('click', () => H.onOpenHistory(r));
    open.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); H.onOpenHistory(r); } });
    li.querySelector('.hist-del').addEventListener('click', (e) => { e.stopPropagation(); H.onDeleteMesa(r); });
  });
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

  const sig = vm.items.map((i) => i.id + ':' + (i.cat || '') + (i.share ? ':s' : '')).join(',');
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
    if (!it.share) { const sub = card.querySelector('.item-sub'); if (sub) sub.textContent = it.sub; }
    card.toggleAttribute('data-zero', (Number(it.qty) || 0) === 0);
    card.classList.toggle('hot', it.id === topId && topQ > 0);
  }
  // mesa LIMPA: sem nenhum item a tela mostra só o convite; o ➕ abre direto o formulário
  // de novo item (sem catálogo — decisão de UX). Com o 1º item, o "+ item" assume.
  const building = vm.items.length === 0;
  el['menu-empty'].hidden = !building;
  el['items-grid'].hidden = building;
  el['btn-additem'].hidden = building; // o empty já traz o botão (➕ Montar o cardápio)
  // CTA "carregar cardápio do boteco": só quando a mesa vazia casa com um lugar salvo (via
  // check-in ou nome da mesa). Mantém a mesa nascendo LIMPA — carregar é 1 toque explícito.
  if (building && vm.boteco) {
    el['btn-empty-boteco'].hidden = false;
    el['btn-empty-boteco'].textContent = t('empty.loadBoteco', { name: vm.boteco.name, n: vm.boteco.count });
  } else {
    el['btn-empty-boteco'].hidden = true;
  }
  if (el['table-hint']) el['table-hint'].hidden = building || Number(vm.tableTotal) > 0;
}
function cardHTML(it) {
  const note = it.note ? ` title="${esc(it.note)}"` : '';
  if (it.share) {
    // COMPARTILHADO: o número grande é DA MESA ("chegou mais uma" — qualquer um marca).
    // SEM contagem de copo (mesquinharia): quem não bebe sai do racha na própria conta.
    return `<div class="item-card share" data-item="${esc(it.id)}" role="button" tabindex="0" aria-label="${esc(it.name)}: ${t('card.ariaShare')}"${note}>
    <div class="item-qty" data-v="${it.qty}">${it.qty}</div>
    <div class="item-emoji">${esc(it.emoji)}</div>
    <div class="item-name">${esc(it.name)}</div>
    ${it.note ? `<div class="item-note">${esc(it.note)}</div>` : ''}
    <div class="item-plus">+1</div>
    <div class="share-flag" aria-hidden="true">${t('card.mesa')}</div></div>`;
  }
  return `<div class="item-card" data-item="${esc(it.id)}" role="button" tabindex="0" aria-label="${esc(it.name)}: ${t('card.aria')}"${note}>
    <div class="item-qty" data-v="${it.qty}">${it.qty}</div>
    <div class="item-emoji">${esc(it.emoji)}</div>
    <div class="item-name">${esc(it.name)}</div>
    <div class="item-sub">${esc(it.sub)}</div>
    ${it.note ? `<div class="item-note">${esc(it.note)}</div>` : ''}
    <div class="item-plus">+1</div></div>`;
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
}
export function setConn(msg) { const b = el['conn-banner']; if (!msg) { b.hidden = true; return; } b.hidden = false; b.textContent = msg; }

// ---------- Placar / participantes ----------
export function renderPeers({ rows, selfId, mvp, myBadges }) {
  el['mvp-banner'].hidden = !mvp;
  el['btn-peers-crown'].hidden = !mvp; // "coroar a noite" só com consumo (mvp existe ⟺ alguém contou algo)
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
  if (r.online === false) return `<span class="peer-net off" title="${t('net.off')}">💤${r.away ? `<i class="net-away">${esc(r.away)}</i>` : ''}</span>`;
  const map = { host: ['📶', t('net.host')], srflx: ['🌐', t('net.inet')], prflx: ['🌐', t('net.inet')], relay: ['🛰️', t('net.relay')] };
  const m = map[r.conn];
  if (m) return `<span class="peer-net" title="${m[1]}">${m[0]}</span>`;
  if (r.online) return `<span class="peer-net" title="${t('net.on')}">🟢</span>`;
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
  // Câmera vs galeria por plataforma: no DESKTOP a webcam ao vivo (getUserMedia); no CELULAR o app
  // de câmera nativo via capture — porque o Android moderno manda <input accept=image/*> SEM capture
  // direto pro Photo Picker (só galeria, sem câmera), então não dá mais pra confiar no "sheet nativo".
  const wideScreen = window.matchMedia('(min-width: 900px)').matches;
  const touchDev = (navigator.maxTouchPoints || 0) > 0 || window.matchMedia('(pointer: coarse)').matches;
  const webcamOn = scanSupported() && wideScreen;
  el['btn-avatar-webcam'].hidden = !webcamOn;              // webcam ao vivo: desktop
  el['btn-avatar-camera'].hidden = webcamOn || !touchDev; // câmera nativa (capture): celular/touch
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

async function avatarFilePicked() {
  const f = el['avatar-file'].files && el['avatar-file'].files[0];
  el['avatar-file'].value = '';
  if (!f) return;
  let img;
  try {
    // createImageBitmap respeita a orientação EXIF (foto de celular vem rotacionada)
    img = await createImageBitmap(f, { imageOrientation: 'from-image' });
  } catch {
    img = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = r.result; };
      r.onerror = rej; r.readAsDataURL(f);
    }).catch(() => null);
  }
  startCrop(img);
}

// Abre o recorte com QUALQUER fonte desenhável — arquivo (ImageBitmap/Image) OU o frame da webcam
// (um <canvas>): todos servem de `drawImage` source pro cropper. A foto original nunca sai do
// aparelho; só a miniatura 128px (no cropUse) entra no perfil.
function startCrop(img) {
  if (!img || !img.width || !img.height) return;
  const min = CROP_VIEW / Math.min(img.width, img.height); // cobre a janela inteira
  crop = { img, w: img.width, h: img.height, scale: min, min, x: img.width / 2, y: img.height / 2, pointers: new Map(), pinch: null };
  el['crop-zoom'].value = '100';
  el['overlay-crop'].hidden = false;
  drawCrop();
}

// ---------- Webcam do perfil (getUserMedia; só no desktop) ----------
// No CELULAR o sheet nativo do "Trocar foto" já traz a câmera; no DESKTOP o seletor de arquivo
// NÃO tem câmera, então aqui abrimos a webcam ao vivo (mesmo motor do leitor de QR) e o frame
// capturado cai no MESMO recorte. A limpeza da stream é centralizada no closeOverlays (fecha por
// ✕/ESC/voltar/arrastar), igualzinho ao scanner de QR — câmera nunca fica ligada zumbi.
let camStream = null;
function stopCam() {
  if (camStream) { try { camStream.getTracks().forEach((tr) => tr.stop()); } catch { /* ignore */ } camStream = null; }
  try { el['cam-video'].srcObject = null; } catch { /* ignore */ }
}
async function openCam() {
  if (!scanSupported()) { toast(t('cam.fail')); return; }
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
  } catch (e) {
    toast(e && e.name === 'NotAllowedError' ? t('cam.perm') : t('cam.fail'));
    return;
  }
  if (el['overlay-profile'].hidden) { stopCam(); return; } // fechou o perfil enquanto a permissão era pedida
  const v = el['cam-video']; v.srcObject = camStream; v.setAttribute('playsinline', '');
  try { await v.play(); } catch { /* alguns browsers só tocam após gesto — segue */ }
  el['overlay-camera'].hidden = false;
}
function shootCam() {
  const v = el['cam-video']; const w = v.videoWidth, h = v.videoHeight;
  if (!w || !h) { toast(t('cam.fail')); return; }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.translate(w, 0); g.scale(-1, 1); // espelha pra bater com a prévia (WYSIWYG)
  g.drawImage(v, 0, 0, w, h);
  stopCam();
  el['overlay-camera'].hidden = true; // fecha só a câmera; o recorte abre por cima do perfil
  startCrop(c);
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
// emoji → categoria provável: escolher o ícone já pré-seleciona a categoria (a pessoa ajusta se quiser)
const EMOJI_CAT = {
  '🍺': 'cerveja', '🍻': 'cerveja',
  '🥃': 'destilado', '🍸': 'destilado', '🍹': 'destilado', '🍾': 'destilado', '🍷': 'destilado', '🥂': 'destilado',
  '🥤': 'sem-alcool', '🧃': 'sem-alcool', '💧': 'sem-alcool', '☕': 'sem-alcool', '🧉': 'sem-alcool',
  '🍟': 'comida', '🍕': 'comida', '🌭': 'comida', '🧀': 'comida', '🥓': 'comida',
  '🍗': 'comida', '🥜': 'comida', '🫒': 'comida', '🍤': 'comida', '🥟': 'comida', '🍢': 'comida',
};
// preview AO VIVO: o card que vai nascer (emoji + nome + preço · da mesa), a cada toque/tecla
function renderAddPreview() {
  if (!el['add-prev-emoji']) return;
  el['add-prev-emoji'].textContent = pickedEmoji;
  const nm = el['add-name'].value.trim();
  el['add-prev-name'].textContent = nm || t('add.previewName');
  el['add-prev-name'].classList.toggle('ph', !nm);
  const price = parseFloat(String(el['add-price'].value).replace(',', '.')) || 0;
  const bits = [];
  if (price > 0) bits.push(fmtMoney(price));
  if (el['add-share'].checked) bits.push(t('card.mesa'));
  const sub = el['add-prev-sub'];
  if (bits.length) { sub.textContent = bits.join(' · '); sub.hidden = false; } else sub.hidden = true;
}
function openAddItem() {
  pickedEmoji = EMOJIS[0];
  el['emoji-row'].innerHTML = EMOJIS.map((e, i) => `<button class="emoji-pick ${i === 0 ? 'sel' : ''}" type="button" data-e="${e}" aria-label="${e}">${e}</button>`).join('');
  el['emoji-row'].querySelectorAll('.emoji-pick').forEach((b) => b.addEventListener('click', () => {
    pickedEmoji = b.dataset.e; el['emoji-row'].querySelectorAll('.emoji-pick').forEach((x) => x.classList.remove('sel')); b.classList.add('sel');
    renderAddPreview(); // a categoria deriva do ícone no confirm (EMOJI_CAT) — sem campo pra escolher
  }));
  el['add-name'].value = ''; el['add-price'].value = ''; el['add-note'].value = ''; el['add-share'].checked = false;
  renderAddPreview();
  el['overlay-additem'].hidden = false;
  const sheet = el['overlay-additem'].querySelector('.sheet'); if (sheet) sheet.scrollTop = 0; // abre no topo (título + ✕ à vista)
  setTimeout(() => el['add-name'].focus(), 60); // tela limpa = só o formulário → teclado já no nome (mínimo de toques)
}
function submitAddItem() {
  const name = el['add-name'].value.trim();
  if (!name) { toast(t('toast.itemName')); return; }
  const price = parseFloat(String(el['add-price'].value).replace(',', '.')) || 0;
  // categoria = derivada do ÍCONE (o campo Categoria saiu do formulário — menos trabalho manual)
  H.onAddItemConfirm({ emoji: pickedEmoji, name, price, cat: EMOJI_CAT[pickedEmoji] || 'outros', note: el['add-note'].value.trim(), share: el['add-share'].checked });
  closeOverlays();
}

// ---------- Preços ----------
export function openPrices(items) {
  el['price-list'].innerHTML = items.map((it) => `<li class="price-row${it.off ? ' off' : ''}" data-id="${esc(it.id)}">
    <span class="pr-emoji">${esc(it.emoji)}</span>
    <input class="pr-brand" type="text" maxlength="28" value="${esc(it.brand || '')}" placeholder="${esc(it.name)}" aria-label="${t('prices.brandAria')}" />
    <input class="pr-price" type="number" inputmode="decimal" min="0" step="0.5" value="${it.price || ''}" placeholder="${t('add.pricePh')}" aria-label="${t('prices.priceAria')}" />
    <button class="pr-eye" type="button" title="${t(it.off ? 'prices.show' : 'prices.hide')}" aria-label="${t(it.off ? 'prices.show' : 'prices.hide')}">${it.off ? '🚫' : '👁'}</button>
    <input class="pr-note" type="text" maxlength="40" value="${esc(it.note || '')}" placeholder="${t('add.notePh')}" aria-label="${t('prices.noteAria')}" /></li>`).join('');
  el['price-list'].querySelectorAll('li').forEach((li) => {
    const id = li.dataset.id;
    li.querySelector('.pr-price').addEventListener('change', (e) => H.onPriceChange(id, e.target.value));
    li.querySelector('.pr-brand').addEventListener('change', (e) => H.onBrandChange(id, e.target.value));
    li.querySelector('.pr-note').addEventListener('change', (e) => H.onNoteChange(id, e.target.value));
    li.querySelector('.pr-eye').addEventListener('click', () => H.onItemToggle(id));
  });
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
  el['bill-shareall'].checked = false; // cada fechamento começa no padrão: motorista fora do bolo
  // default ao ABRIR (o usuário ainda troca): sem preço → já "rachar igual"; couvert lembrado por boteco.
  el['bill-equal'].checked = !!(vm && vm.equalDefault);
  el['bill-couvert'].value = (vm && vm.couvert) ? String(vm.couvert) : '';
  if (vm && Number.isFinite(vm.tipPct)) billTip = vm.tipPct;
  markTip();
  el['overlay-bill'].hidden = false;
}
export function billOptions() {
  return {
    tipPct: billTip,
    couvert: Math.max(0, parseFloat(String(el['bill-couvert'].value).replace(',', '.')) || 0),
    equal: el['bill-equal'].checked,
    shareAll: el['bill-shareall'].checked,
    excluded: [...billExcluded],
  };
}
export function renderBill(vm) {
  el['bill-note'].textContent = vm.note || '';
  // bolo da mesa (garrafas/torres compartilhadas): resumo + fatia; toggle do motorista quando muda algo
  const pool = vm.pool;
  el['bill-pool'].hidden = !pool;
  if (pool) {
    const items = pool.lines.map((l) => `${l.count}× ${l.name}`).join(' + ');
    el['bill-pool-line'].textContent = t('bill.pool', { items, total: fmtMoney(pool.total), each: fmtMoney(pool.each), n: pool.heads });
    el['bill-shareall-wrap'].hidden = !pool.canToggle;
  }
  // 🎁 quem BANCOU o quê (rodadas/garrafas) — "cada um nas suas costas o que prometeu"
  const bk = vm.bankrolls || [];
  el['bill-bankrolls'].hidden = !bk.length;
  if (bk.length) {
    el['bill-bankrolls'].innerHTML = `<span class="b-bank-title">${t('bill.bankTitle')}</span>` + bk.map((b) => {
      const what = b.items.map((x) => `${x.units}× ${esc(x.name)}`).join(', ');
      return `<span class="b-bank-line">🎁 <b>${esc(b.name)}</b> ${t('bill.bankVerb')} ${what} · ${fmtMoney(b.total)}</span>`;
    }).join('');
  }
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
  // sem chave PIX configurada MAS há dinheiro a receber (linha de outro, com valor, sem cobertura):
  // captura a chave AQUI, no fechar a conta — senão não havia caminho pra receber (toast inalcançável).
  const hasReceivable = vm.rows.some((r) => r.amount > 0 && !r.isSelf && !r.coveredByName);
  el['bill-pix-setup'].hidden = !(!vm.canPix && hasReceivable);
  el['bill-total'].textContent = t('bill.total', { v: fmtMoney(vm.total) });
  el['btn-bill-crown'].hidden = !vm.hasNight; // a conta fechando + houve consumo → oferece coroar a noite
}

// ---------- PIX ----------
export function openPix(vm) {
  el['pix-title'].textContent = vm.title || t('bill.pixTitle');
  el['pix-qr'].innerHTML = ''; if (vm.qrNode) el['pix-qr'].appendChild(vm.qrNode);
  el['pix-code'].value = vm.code || '';
  el['overlay-pix'].hidden = false;
}
export function pixCode() { return el['pix-code'].value; }

// ---------- Hub do "Você" (avatar) ----------
// Junta o que é PESSOAL num lugar só (perfil/números/passaporte/config). Cada item abre o overlay
// que já existe (fiação no init); o Retrô/rolê e a Liga fundiram DENTRO de Números. Números só
// aparece com histórico (espelha o antigo gate do #home-extras); Perfil, Passaporte e Config
// sempre. O rosto grande (#me-avatar) também abre o perfil. vm: {color,emoji,photo,level,name,hasHistory}.
export function openMe(vm) {
  const v = vm || {};
  el['me-avatar'].className = `pres-av ${frameClass(v.level)}`;
  el['me-avatar'].style.background = safeColor(v.color);
  el['me-avatar'].innerHTML = avInner(v.photo, v.emoji);
  el['me-name'].textContent = v.name || t('common.you');
  el['me-stats'].hidden = !v.hasHistory; // Números (com o rolê/liga dentro) só com histórico
  el['overlay-me'].hidden = false;
}

// ---------- Configuracoes ----------
function openSettings() { H.onOpenSettings(); el['overlay-settings'].hidden = false; }
export function fillSettings(s) {
  el['set-theme'].value = s.theme || 'light';
  el['set-lang'].value = s.lang || 'pt';
  el['set-bigfont'].checked = !!s.bigFont;
  el['set-sound'].checked = !!s.sound;
  el['set-shake'].checked = !!s.shake;
  el['set-geo'].checked = s.geo !== false;             // default ligado (o 1º uso pede a permissão)
  el['set-dev'].checked = !!s.dev;                     // modo desenvolvedor (seção só aparece destravada)
  el['set-pixkey'].value = s.pixKey || '';
  el['set-pixcity'].value = s.pixCity || '';
}
// Seção 🐛 Desenvolvedor: escondida de fábrica; o app mostra depois dos 7 toques na versão
// (e no boot, se a flag devUnlocked já existe — destravou uma vez, fica).
export function showDev(show) { el['dev-section'].hidden = !show; }
// 📸 flutuante: aparece SÓ com o modo dev ligado (captura a tela atual em contexto, sem ir às Configs).
export function setDevFab(on) { el['dev-fab'].hidden = !on; }
// Visor do diário dentro do app: as últimas linhas cruas, mais recentes embaixo (mão rola até o fim)
export function renderDevLog(entries) {
  const fmt = (e) => { const { t: ts, k, ...r } = e; const hh = new Date(ts || 0).toTimeString().slice(0, 8); return `${hh} ${k}  ${JSON.stringify(r)}`; };
  el['dev-log-view'].textContent = (entries || []).map(fmt).join('\n') || '(diário vazio)';
  el['dev-log-view'].hidden = false;
}
// Espião do diário técnico (modo dev): o app injeta o dlog SÓ com o switch ligado (desligado o
// hook é null = custo zero); a ui reporta o que o USUÁRIO vê — toasts (o que o app disse) e a
// jornada de telas/overlays (o "print" textual).
let devHook = null;
let lastOverlaySig = null; // último conjunto de overlays logado (loga só mudança, não a rajada)
export function setDevHook(fn) { devHook = fn; lastOverlaySig = null; }
function prefersLight() { try { return window.matchMedia('(prefers-color-scheme: light)').matches; } catch { return false; } }
// Padrão de fábrica: CLARO. 'auto' (escolha manual) segue o sistema; senão usa o tema escolhido.
function resolveTheme(s) {
  const th = s.theme || 'light';
  if (th === 'auto') return prefersLight() ? 'light' : 'dark';
  // valor desconhecido/corrompido cai no claro, sem drama
  return ['dark', 'light'].includes(th) ? th : 'light';
}
export function themeIsLight(s) { return resolveTheme(s) === 'light'; }
// Cor da moldura do navegador/status bar POR TEMA (a meta estática do index é só o pré-JS).
// Espelha a cor sólida de segurança do body de cada tema — mudou lá, mude aqui.
const THEME_CHROME = { dark: '#0b0e07', light: '#ece0c7' };
export function applyTheme(s) {
  const th = resolveTheme(s);
  document.body.classList.remove('light');
  if (th !== 'dark') document.body.classList.add(th);
  // fonte grande escala a RAIZ (rem): tudo cresce junto, somando com a fonte do sistema
  document.documentElement.classList.toggle('bigfont', !!s.bigFont);
  // plataforma acompanha o tema: status bar/chrome (theme-color) e controles nativos (color-scheme)
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_CHROME[th] || THEME_CHROME.dark);
  document.documentElement.style.colorScheme = th === 'light' ? 'light' : 'dark';
}
// Idioma: aplica o dicionário no shell (elementos com data-i18n).
export function applyLang(pref) { setLang(pref); applyI18n(); }
// Moldura do avatar conforme o nível (liga).
function frameClass(level) { level = Number(level) || 0; return level >= 5 ? 'fr-gold' : level >= 3 ? 'fr-silver' : ''; }

// ---------- Reações ----------
const REACTIONS = ['🍻', '🔥', '👏', '😂', '❤️', '🤢', '🎉', '🥴'];
function openReact() {
  // o 🍻 aqui é o BRINDE de verdade (3‑2‑1 na tela de todos), não um emoji solto — o chip "Brinde"
  // saiu da barra e virou esta reação (ação óbvia > botão extra).
  el['react-row'].innerHTML = REACTIONS.map((e) => `<button data-e="${e}"${e === '🍻' ? ` title="${esc(t('chip.brinde'))}"` : ''}>${e}</button>`).join('');
  el['react-row'].querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.e === '🍻') H.onBrinde(); else H.onReact(b.dataset.e);
    closeOverlays();
  }));
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

// ---------- Rodada: escolher o item (2 toques no total; sem disparo acidental) ----------
// ---------- Jogos (atalho rápido da mesa) ----------
// FONTE ÚNICA por jogo: as MESMAS chaves *.title que o menu "…" usa (emoji + nome juntos).
// Lição aprendida: quando o grid tinha emoji próprio E o i18n do truco também carregava um,
// a mesa mostrou "🂠 🂠 Truco" — duas fontes de verdade SEMPRE acabam divergindo. O split
// abaixo só separa o 1º token (emoji) pra estilizar maior; o texto continua vindo inteiro
// da chave. O e2e-liso compara menu ↔ grid e trava qualquer nova divergência no CI.
const GAMES = () => [
  [t('purr.title'), 'onPurrinha'],
  [t('dom.title'), 'onDomino'],
  [t('tru.title'), 'onTruco'],
].map(([full, h]) => {
  const sp = full.indexOf(' ');
  return sp > 0 ? [full.slice(0, sp), full.slice(sp + 1), h] : ['', full, h];
});
function openGames() {
  const games = GAMES();
  el['games-grid'].innerHTML = games.map(([e, n], i) =>
    `<button class="game-pick" data-i="${i}"><span class="game-pick-e">${e}</span><span>${esc(n)}</span></button>`).join('');
  el['games-grid'].querySelectorAll('.game-pick').forEach((btn) => btn.addEventListener('click', () => {
    const g = games[Number(btn.dataset.i)]; closeOverlays(); H[g[2]]();
  }));
  el['overlay-games'].hidden = false;
}

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

// Caminho de retângulo arredondado (compartilhado pelo gráfico de tendência do Placar).
function roundRectPath(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath(); g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// ---------- 💸 Pagar uma rodada (item da mesa com dono) ----------
export function openPayRound(vm) {
  el['payround-list'].innerHTML = (vm.items || []).map((it) => {
    const n = it.n || 1;
    // item DA MESA (share): unidade coletiva → só o selo "da mesa" (+ preço unitário se houver), SEM ×N.
    // item PESSOAL: um pra cada online → mostra ×N e ANTECIPA o total (preço × N) já no botão.
    const tail = it.share
      ? ` · <small class="opt-tag">${t('round.tableTag')}</small>${it.price ? ' · ' + fmtMoney(it.price) : ''}`
      : ` ×${n}${it.price ? ' · ' + fmtMoney(it.price * n) : ''}`;
    return `<button class="btn btn-primary pay-btn" data-id="${esc(it.id)}">${esc(it.emoji)} ${esc(it.name)}${tail}</button>`;
  }).join('');
  el['payround-list'].querySelectorAll('.pay-btn').forEach((b) => b.addEventListener('click', () => { closeOverlays(); H.onPayPick(b.dataset.id); }));
  el['overlay-payround'].hidden = false;
}

// ---------- Cutucar / desafiar ----------
export function openPoke(vm) {
  el['poke-title'].textContent = t('poke.title', { name: vm.name || t('common.someoneLow') });
  const btns = [];
  for (const it of (vm.items || [])) {
    btns.push(`<button class="btn btn-ghost poke-btn" data-kind="challenge" data-item="${esc(it.id)}">${esc(it.emoji)} ${t('poke.dare', { item: esc(it.name) })}</button>`);
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
  if (s.favDrink) html += cell(vm.favEmoji || '🍺', t('stats.fav', { name: vm.favName || s.favDrink }), true);
  if (vm.topMate) html += cell(esc(vm.topMate.name), t('stats.topMate'), true); // 🤝 com quem mais bebeu (veio do Retrô)
  if (s.totalSpent > 0) html += cell(fmtMoney(s.totalSpent), t('stats.spent'), true);
  el['stats-grid'].innerHTML = html;
  el['stats-badges'].innerHTML = (vm.badges || []).map((b) => `<span class="badge">${b.emoji} ${esc(t('lbadge.' + b.id, b.n != null ? { n: b.n } : undefined))}</span>`).join('') || `<span class="seal">${t('stats.badgesEmpty')}</span>`;
  const trend = vm.trend || [];
  const hasTrend = trend.some((t) => t.total > 0);
  el['stats-chart'].hidden = !hasTrend;
  el['stats-chart-h'].hidden = !hasTrend;
  if (hasTrend) drawBars(el['stats-chart'], trend);
  const ins = vm.insight;
  if (ins && ins.best && ins.worst && ins.best.wd !== ins.worst.wd) {
    el['stats-insight'].textContent = t('stats.insight', { best: t('wd.' + ins.best.wd), worst: t('wd.' + ins.worst.wd) });
    el['stats-insight'].hidden = false;
  } else {
    el['stats-insight'].hidden = true;
  }
  el['stats-history'].innerHTML = (vm.history || []).slice(0, 12).map((h) => {
    const d = new Date(h.at);
    const when = d.toLocaleDateString(document.documentElement.lang || 'pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    return `<li><span>${esc(h.title || h.room)} <small>· ${when}</small></span><small>${t('home.histLine', { me: h.myTotal || 0, tt: h.tableTotal || 0 })}</small></li>`;
  }).join('') || `<li>${t('stats.noNights')}</li>`;
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
    g.fillStyle = lab; g.fillText(t('mon.' + items[i].monthIdx), x + bw / 2, Hh - 7);
  }
}

// ---------- Presença (avatares de quem está na mesa, no topo) ----------
export function renderPresence(list) {
  const bar = el['presence-bar'];
  const all = list || [];
  if (!all.length) { bar.hidden = true; bar.innerHTML = ''; return; } // fora da mesa
  // SEMPRE mostra pelo menos VOCÊ (mesmo sozinho na mesa): seu rosto é a porta do hub pessoal
  // aqui — antes a barra sumia sem outros peers e não dava pra tocar. `data-self` marca o seu.
  bar.hidden = false;
  // quem apagou a tela / caiu fica esmaecido com 💤 e, passado 1min, ganha o RELÓGIO de há
  // quanto tempo ("12min"/"1h") — a mesa CONCLUI quem já foi embora, sem o app anunciar nada
  bar.innerHTML = all.map((p) => `<span class="pres-av${p.online ? '' : ' zz'} ${frameClass(p.level)}${p.self ? ' pres-me' : ''}"${p.self ? ' data-self="1"' : ''} title="${esc(p.name || '')}${p.online ? '' : t('pres.away')}" style="background:${safeColor(p.color)}">${avInner(p.photo, p.emoji)}${p.online ? '' : '<i class="zz-b">💤</i>'}${!p.online && p.awayLabel ? `<i class="zz-t">${esc(p.awayLabel)}</i>` : ''}</span>`).join('');
}

// ---------- Comanda individual ----------
export function openComanda(vm) {
  el['comanda-title'].textContent = `${vm.emoji || '🍺'} ${vm.name || t('common.anon')}`;
  el['comanda-away'].hidden = !vm.away;
  el['comanda-away'].textContent = vm.away || '';
  el['comanda-list'].innerHTML = (vm.rows || []).map((r) => `<li class="comanda-row">
    <span class="c-emoji">${esc(r.emoji || '🍺')}</span>
    <span class="c-name">${esc(r.name)}${r.note ? `<small class="c-note">${esc(r.note)}</small>` : ''}</span>
    <span class="c-qty">×${r.n}</span>
    ${r.money ? `<span class="c-money">${fmtMoney(r.money)}</span>` : ''}</li>`).join('')
    || `<li class="comanda-row">${t('comanda.empty')}</li>`;
  el['comanda-total'].textContent = t('comanda.total', { n: vm.total }) + (vm.money ? ' · ' + fmtMoney(vm.money) : '');
  // AÇÕES na própria comanda (cobrar dali, sem fechar e ir na conta): só de OUTRA pessoa com dívida.
  // "🙌 eu pago" (PAYFOR, liga/desliga por vm.iPayThem — highlight = ativo) + PIX (se tenho chave).
  const acts = el['comanda-actions'];
  if (!vm.isSelf && vm.money > 0) {
    const btns = [`<button class="btn ${vm.iPayThem ? 'btn-primary' : 'btn-ghost'}" id="comanda-pay">${t('comanda.pay')}</button>`];
    if (vm.canPix) btns.push(`<button class="btn btn-ghost" id="comanda-pix">${t('comanda.pix')}</button>`);
    acts.innerHTML = btns.join('');
    acts.hidden = false;
    const pay = acts.querySelector('#comanda-pay');
    if (pay) pay.addEventListener('click', () => { H.onPayFor(vm.user, !vm.iPayThem); H.onComanda(vm.user); }); // re-abre pra o botão refletir
    const pix = acts.querySelector('#comanda-pix');
    if (pix) pix.addEventListener('click', () => H.onPix(vm.user));
  } else { acts.hidden = true; acts.innerHTML = ''; }
  el['overlay-comanda'].hidden = false;
}

// ---------- Tour guiado (spotlight + balão; leve, sem lib) ----------
// Paradas podem ABRIR a tela de verdade: passo com `pre` (um clique real — ex.: abrir o menu)
// roda a partir da mesa LIMPA (closeOverlays antes de cada passo) e o recorte espera a âncora
// ficar VISÍVEL. Pular/terminar também limpa — o tour nunca deixa porta aberta.
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
  closeOverlays(); // se a parada tinha aberto menu/jogos, não fica porta aberta
  const cb = tourDone; tourDone = null;
  if (cb) cb(!!completed);
}
function tourNext() { tourIdx++; renderTourStep(); }
function renderTourStep() {
  const st = tourSteps && tourSteps[tourIdx];
  if (!st) { endTour(true); return; }
  closeOverlays();          // cada parada parte da mesa limpa…
  if (st.pre) { try { st.pre(); } catch { /* âncora cuida */ } } // …e abre a tela DELA (clique real)
  const t0 = Date.now();
  const tryShow = () => {
    if (!tourSteps || tourSteps[tourIdx] !== st) return; // avançou/pulou no meio da espera
    const target = document.querySelector(st.sel);
    const box = target && target.getBoundingClientRect();
    if (!target || !box || box.width < 2) {
      // âncora ainda abrindo (overlay animando) → re-tenta; não apareceu → segue o baile
      if (Date.now() - t0 < 1500) { requestAnimationFrame(tryShow); return; }
      tourIdx++; renderTourStep(); return;
    }
    // rola SÓ no rAF: o reset de scroll do sheet recém-aberto (MutationObserver do setupA11y)
    // roda como microtask ANTES do rAF — rolar no mesmo task do clique seria desfeito por ele
    requestAnimationFrame(() => {
      if (!tourSteps || tourSteps[tourIdx] !== st) return;
      // rola o scroller REAL (sheet do overlay, se houver) pra âncora ficar no meio — o
      // scrollIntoView nem sempre acerta o container em diálogo centrado de desktop
      const scroller = target.closest('.sheet');
      if (scroller && scroller.scrollHeight > scroller.clientHeight + 4) {
        const sr = scroller.getBoundingClientRect(), tr = target.getBoundingClientRect();
        scroller.scrollTop += (tr.top - sr.top) - (scroller.clientHeight - tr.height) / 2;
      } else target.scrollIntoView({ block: 'center' });
      requestAnimationFrame(() => positionTourStep(st, target));
    });
  };
  tryShow();
}
function positionTourStep(st, target) {
  if (!tourSteps || tourSteps[tourIdx] !== st) return;
  const r = target.getBoundingClientRect();
  const spot = el['tour-spot'];
  spot.style.left = (r.left - 8) + 'px';
  spot.style.top = (r.top - 8) + 'px';
  spot.style.width = (r.width + 16) + 'px';
  spot.style.height = (r.height + 16) + 'px';
  // bolinhas de progresso (feitas ○ · atual ● · por vir ○ menor) + "1/4" pro leitor de tela —
  // o textContent do contêiner segue sendo só o número (os <i> são vazios)
  el['tour-count'].innerHTML = tourSteps.map((_, i) => `<i class="tour-dot${i === tourIdx ? ' on' : ''}${i < tourIdx ? ' done' : ''}"></i>`).join('')
    + `<span class="tour-num">${tourIdx + 1}/${tourSteps.length}</span>`;
  el['tour-title'].textContent = st.title || '';
  el['tour-text'].textContent = st.text || '';
  el['btn-tour-next'].textContent = tourIdx + 1 >= tourSteps.length ? t('common.go') : t('tour.next');
  el['tour'].hidden = false;
  // balão acima/abaixo do alvo, mas SEMPRE dentro da tela (clamp — alvo fora não expulsa o botão)
  const bal = el['tour-balloon'];
  bal.style.top = ''; bal.style.bottom = '';
  const balH = bal.offsetHeight || 190;
  let top = r.top > window.innerHeight / 2 ? r.top - balH - 16 : r.bottom + 16;
  top = Math.max(12, Math.min(top, window.innerHeight - balH - 12));
  bal.style.top = top + 'px';
  try { el['btn-tour-next'].focus({ preventScroll: true }); } catch { /* ignore */ } // teclado/leitor avança sem caçar o botão
}

// ---------- Liga & desafios (renderizada DENTRO de Meus Números; sem overlay próprio) ----------
export function renderLeague(vm) {
  const L = vm.level;
  const pct = L.xpForNext > 0 ? Math.min(100, (L.xpInLevel / L.xpForNext) * 100) : 100;
  el['league-level'].innerHTML = `<div class="ll-top"><span class="ll-badge">${t('league.level', { n: L.level })}</span><span class="ll-title">${esc(t('league.title.' + Math.min(L.level, 5)))}</span></div>
    <div class="pace-meter"><div class="pace-bar lvl-medio" style="width:${pct}%"></div></div>
    <div class="ll-xp">${t('league.xp', { a: L.xpInLevel, b: L.xpForNext })}</div>`;
  el['league-challenges'].innerHTML = (vm.challenges || []).map((c) => `<li class="chal-row ${c.done ? 'done' : ''}">
    <span class="chal-emoji">${esc(c.emoji)}</span>
    <div class="chal-main"><span class="chal-title">${esc(t('league.chal.' + c.id))}</span>
      <div class="pace-meter sm"><div class="pace-bar lvl-calmo" style="width:${Math.min(100, (c.progress / c.goal) * 100)}%"></div></div></div>
    <span class="chal-tick">${c.done ? '✅' : `${c.progress}/${c.goal}`}</span></li>`).join('');
  const s = vm.season;
  el['league-season'].innerHTML = s ? `<div class="season-card"><span class="season-emoji">${esc(s.emoji)}</span>
    <div><div class="season-title">${esc(t('league.season.' + s.tier))}</div><div class="season-sub">${esc(t(s.month === 1 ? 'league.season1' : 'league.seasonN', { n: s.month, label: t('mon.' + s.monthIdx) }))}</div></div></div>` : '';
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
// fileira de chips: 1 por jogo minimizado. Tocar no rótulo VOLTA; o ✕ vermelho ENCERRA pra mesa toda.
export function setGamePill(parts) {
  const p = el['game-pill'];
  const list = Array.isArray(parts) ? parts : [];
  if (!list.length) { p.hidden = true; p.innerHTML = ''; return; }
  p.innerHTML = list.map((g) => `<span class="game-chip${g.urgent ? ' urgent' : ''}">
    <button class="game-chip-open" data-kind="${g.kind}">${esc(g.label)}${t('game.pillBack')}</button>
    <button class="game-chip-end" data-kind="${g.kind}" aria-label="${t('game.pillEndAria')}" title="${t('game.pillEndAria')}">✕</button>
  </span>`).join('');
  p.hidden = false;
}

// Seletor da "turma virtual" (bots) — reutilizado nos setups dos 3 jogos. Guarda a escolha
// num módulo-var; `botPickCount()` devolve ao iniciar. Um toque num chip escolhe quantos 🤖.
let botPick = 0;
function botPickerHTML(max = 3) {
  const chips = [];
  for (let n = 0; n <= max; n++) chips.push(`<button class="bot-chip${n === botPick ? ' sel' : ''}" data-n="${n}">${n === 0 ? t('bots.none') : '🤖'.repeat(n)}</button>`);
  return `<div class="bot-picker"><span class="bot-picker-lbl">${t('bots.call')}</span><div class="bot-chips">${chips.join('')}</div></div>`;
}
function wireBotPicker(root) {
  root.querySelectorAll('.bot-chip').forEach((b) => b.addEventListener('click', () => {
    botPick = Number(b.dataset.n) || 0;
    root.querySelectorAll('.bot-chip').forEach((x) => x.classList.toggle('sel', x === b));
  }));
}
export function botPickCount() { return botPick; }

export function purrinhaStartChoice(vm = {}) {
  botPick = Math.max(0, Math.min(3, Number(vm.botsDefault) || 0));
  el['purr-sub'].textContent = t('purr.subIntro');
  el['purr-setup'].innerHTML = `<div class="dom-start">
    <p class="dom-start-q">${t('game.how')}</p>
    <button class="btn btn-primary btn-lg" id="btn-purr-sticks">${t('purr.modeSticks')}</button>
    <button class="btn btn-ghost dom-start-alt" id="btn-purr-classic">${t('purr.modeClassic')}</button>
    <button class="btn btn-ghost dom-start-alt" id="btn-purr-fast">${t('purr.modeFast')}</button>
    ${botPickerHTML(3)}
    <p class="dom-start-note">${t('purr.modesNote')}</p>
  </div>`;
  el['purr-setup'].querySelector('#btn-purr-sticks').onclick = () => H.onPurrStart('sticks', botPick);
  el['purr-setup'].querySelector('#btn-purr-classic').onclick = () => H.onPurrStart('classic', botPick);
  el['purr-setup'].querySelector('#btn-purr-fast').onclick = () => H.onPurrStart('fast', botPick);
  wireBotPicker(el['purr-setup']);
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
  purrPhase('pick');
  if (!gameMin.purr) el['overlay-purrinha'].hidden = false;
}
export function purrinhaSealed(vm) {
  el['purr-waitcount'].textContent = `🔒 ${vm.count}/${vm.total}`;
  el['purr-waitsub'].textContent = vm.sub || t('purr.waiting');
  el['purr-seals'].innerHTML = (vm.seals || []).map((s) => `<li class="purr-seal${s.sealed ? ' done' : ''}">
    <span class="purr-sav">${avInner(s.photo, s.avatar, false)}</span><span class="purr-sname">${esc(s.name)}</span>
    <span class="purr-sst">${s.sealed ? t('purr.sealed') : t('purr.choosing')}</span></li>`).join('');
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
// pedra: DEITADA (a|b); EM PÉ (`vert`: bucha atravessada ou quina — metades empilhadas, pips de pé);
// `flip` mostra b|a (fileira de volta, pra corrente ler contínua); `pos` posiciona no feltro (absoluto).
function domTileHTML(a, b, { flat = false, cls = '', chip = '', vert = false, flip = false, pos = null } = {}) {
  const stand = vert || (!flat && a === b);          // em pé: bucha OU pedra da quina
  const [h1, h2] = flip ? [b, a] : [a, b];
  const style = pos ? ` style="position:absolute;left:${pos.x}px;top:${pos.y}px"` : '';
  return `<span class="dom-tile${stand ? ' dbl' : ''}${cls ? ' ' + cls : ''}"${style}>${domHalf(h1, stand)}${domHalf(h2, stand)}${chip}</span>`;
}
// tamanho natural da pedra (bate com o CSS: metade 32 + borda 1 = 66×34 deitada, 34×66 em pé)
const DOM_L = 66, DOM_S = 34;
let domBoardState = null; // guarda o último tabuleiro pra re-layout no resize/rotação
// desenha o tabuleiro como SERPENTINA de mesa real (domino.js/snakeLayout): pedras coladas casando
// pip; buchas atravessadas; vira a quina descendo com 2 pedras em pé; cresce ↓ no retrato / → no
// deitado. Escala só como último recurso (mesa cheíssima) — nunca volta pro tamanho ilegível.
function domFitBoard() {
  if (!domBoardState) return;
  const boardEl = el['dom-board'], wrap = boardEl.parentElement;
  // largura ÚTIL = caixa de CONTEÚDO do wrap (desconta o padding) — não o clientWidth cru.
  const cs = getComputedStyle(wrap);
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const availW = Math.max(160, wrap.clientWidth - padX - 4); // -4: respiro anti-arredondamento
  const st = domBoardState;
  // SERPENTINA ancorada na ABERTURA (fica no meio): cabe na largura em TAMANHO CHEIO — não encolhe a
  // pedra, serpenteia pra caber (pedido do André). Cresce em ALTURA; o feltro ROLA por dentro quando
  // passa do teto (a mão fica sempre embaixo à mão) e acompanha a última jogada. Só GIRAR re-arruma.
  const lay = snakeLayout(st.board.map((t) => [t.a, t.b]), { width: availW, long: DOM_L, short: DOM_S, pad: 6, anchor: st.anchor });
  boardEl.style.transform = '';
  boardEl.style.width = lay.width + 'px';
  boardEl.style.height = lay.height + 'px';
  boardEl.innerHTML = lay.tiles.map((tile) => {
    const isJust = tile.idx === st.lastPlayIdx;
    const chip = (isJust && st.lastPlayAvatar) ? `<span class="dom-played-av" title="${esc(st.lastPlayName || '')}">${avInner(st.lastPlayPhoto, st.lastPlayAvatar)}</span>` : '';
    return domTileHTML(tile.a, tile.b, { vert: tile.vert, flip: tile.flip, pos: tile, cls: (tile.open ? 'open' : '') + (isJust ? ' just' : ''), chip });
  }).join('');
  const landscape = window.innerWidth > window.innerHeight;
  const maxH = Math.max(140, Math.round(window.innerHeight * (landscape ? 0.6 : 0.46)));
  wrap.style.maxHeight = maxH + 'px';
  wrap.style.height = Math.min(lay.height + 6, maxH) + 'px';
  const just = lay.tiles.find((t) => t.idx === st.lastPlayIdx);   // rola pra deixar a última peça à vista
  if (just && lay.height + 6 > maxH) wrap.scrollTop = Math.max(0, Math.min(just.y + just.h / 2 - wrap.clientHeight / 2, lay.height + 6 - wrap.clientHeight));
}
let domArmed = null; // key da pedra que casa nas duas pontas, aguardando escolha de ponta
export function openDomino() { domArmed = null; el['overlay-domino'].hidden = false; }
// tela de início do dominó: escolhe quantos da turma virtual entram, depois começa (handshake)
export function dominoStartChoice(vm = {}) {
  botPick = Math.max(0, Math.min(3, Number(vm.botsDefault) || 0));
  el['dom-setup'].innerHTML = `<div class="dom-start">
    <p class="dom-start-q">${t('dom.startTitle')}</p>
    ${botPickerHTML(3)}
    <button class="btn btn-primary btn-lg" id="btn-dom-go">${t('dom.startGo')}</button>
    <p class="dom-start-note">${t('dom.startNote')}</p>
  </div>`;
  el['dom-setup'].querySelector('#btn-dom-go').onclick = () => H.onDomStart(botPick);
  wireBotPicker(el['dom-setup']);
  el['dom-setup'].hidden = false; el['dom-game'].hidden = true;
  if (!gameMin.dom) el['overlay-domino'].hidden = false;
}
// contagem regressiva do auto-passe (sem jogada legal, o passe sai sozinho em 5s)
export function setDomPassCount(n) {
  el['btn-dom-pass'].textContent = n != null ? t('dom.passN', { n: n }) : t('dom.pass');
}
// tela de espera do handshake da mesa verificada (antes do jogo começar)
export function dominoSetup(msg) {
  el['dom-setup'].innerHTML = `<div class="dom-setup-spin">🔒</div><div class="dom-setup-msg">${esc(msg)}</div>`;
  el['dom-setup'].hidden = false;
  el['dom-game'].hidden = true;
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
  // tabuleiro: SERPENTINA de mesa real (domSnakeLayout) — pontas abertas brilham; a peça recém-jogada
  // ganha destaque + o avatar de quem jogou (como acompanhar a mão na mesa). O layout roda no domFitBoard.
  const board = vm.board || [];
  if (!board.length) {
    domBoardState = null;
    el['dom-board'].innerHTML = `<span class="dom-empty">${t('dom.starting')}</span>`;
    el['dom-board'].style.width = el['dom-board'].style.height = el['dom-board'].style.transform = '';
    el['dom-board'].parentElement.style.height = '';
  } else {
    domBoardState = { board, anchor: vm.anchor, lastPlayIdx: vm.lastPlayIdx, lastPlayAvatar: vm.lastPlayAvatar, lastPlayPhoto: vm.lastPlayPhoto, lastPlayName: vm.lastPlayName };
    requestAnimationFrame(domFitBoard);
  }
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
  if (!gameMin.dom) el['overlay-domino'].hidden = false;
}


// ---------- Truco (mesa: vira, placar, vaza central, mão em CSS puro) ----------
function truCardHTML(cardStr, { small = false, back = false } = {}) {
  if (back) return `<span class="tru-card back${small ? ' sm' : ''}"></span>`;
  const [r, s] = String(cardStr).split(':');
  // o naipe conhecido vira um glifo seguro; QUALQUER outra coisa é dado do fio (a vira é pública
  // e a mão chega por thand — um peer trapaceiro manda "3:<img onerror=…>") e PRECISA de esc():
  // sem isto o fallback `|| s` injetava HTML cru no innerHTML da vira/mão = XSS que exfiltra o
  // localStorage (log + chave PIX), sem clique, mesmo com o overlay escondido.
  const suit = { ouros: '♦', espadas: '♠', copas: '♥', paus: '♣', bastos: '🪵' }[s] || esc(s || '');
  const red = s === 'copas' || s === 'ouros';
  return `<span class="tru-card${red ? ' red' : ''}${small ? ' sm' : ''}"><b>${esc(r)}</b><i>${suit}</i></span>`;
}
export function trucoStartChoice(vm) {
  botPick = Math.max(0, Math.min(3, Number(vm.botsDefault) || 0));
  el['tru-setup'].innerHTML = `<div class="dom-start">
    <p class="dom-start-q">${t('tru.how')} <small>(${vm.mode})</small></p>
    <button class="btn btn-primary btn-lg" id="btn-tru-pta">🂠 ${t('tru.vPaulista')}</button>
    <button class="btn btn-ghost dom-start-alt" id="btn-tru-min">⛏️ ${t('tru.vMineira')}</button>
    <button class="btn btn-ghost dom-start-alt" id="btn-tru-gau">🧉 ${t('tru.vGaucha')}</button>
    ${botPickerHTML(3)}
    <p class="dom-start-note">${t('tru.note')}</p>
  </div>`;
  el['tru-setup'].querySelector('#btn-tru-pta').onclick = () => H.onTrucoStart('paulista', botPick);
  el['tru-setup'].querySelector('#btn-tru-min').onclick = () => H.onTrucoStart('mineira', botPick);
  el['tru-setup'].querySelector('#btn-tru-gau').onclick = () => H.onTrucoStart('gaucha', botPick);
  wireBotPicker(el['tru-setup']);
  el['tru-setup'].hidden = false; el['tru-game'].hidden = true;
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
  if (!gameMin.truco) el['overlay-truco'].hidden = false;
}

// ---------- Passaporte de botecos (check-ins locais) ----------
export function openPassport(vm) {
  const list = (vm && vm.checkins) || [];
  const keyOf = (vm && vm.keyOf) || ((s) => String(s || '').toLowerCase());
  const menuSet = new Set((vm && vm.menuKeys) || []); // chaves normalizadas com cardápio salvo
  const places = new Set(list.map((c) => c.name || t('pass.fallback'))).size;
  el['passport-count'].textContent = list.length
    ? `${list.length} ${list.length === 1 ? t('pass.checkin1') : t('pass.checkinN')} · ${places} ${places === 1 ? t('pass.place1') : t('pass.placeN')}`
    : t('pass.empty');
  el['passport-list'].innerHTML = list.map((c) => {
    const d = new Date(c.at);
    const when = d.toLocaleDateString(document.documentElement.lang || 'pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    const map = (c.lat != null && c.lng != null) ? `https://maps.google.com/?q=${c.lat},${c.lng}` : '';
    const hasMenu = menuSet.has(keyOf(c.name || ''));
    const badge = hasMenu ? ` <span class="pass-menu" title="${esc(t('boteco.menu'))}">📓</span>` : '';
    // clareана #2: onde tem cardápio salvo, DIZ o que fazer (a linha já abre a ficha c/ "carregar")
    const sub = hasMenu ? `<span class="pass-sub">📓 ${esc(t('pass.hasMenu'))}</span>` : '';
    return `<li class="pass-row" data-place="${esc(c.name || '')}" data-at="${c.at}"><span class="pass-pin">📍</span>
      <div class="pass-main" role="button" tabindex="0" aria-label="${esc(c.name || t('pass.fallback'))}"><span class="pass-name">${esc(c.name || t('pass.fallback'))}${badge}</span><span class="pass-when">${when}</span>${sub}</div>
      ${map ? `<a class="pass-map" href="${map}" target="_blank" rel="noopener" aria-label="ver no mapa">🗺️</a>` : ''}
      <button class="pass-del" aria-label="${esc(t('data.delCheckinAria'))}" title="${esc(t('data.delCheckinAria'))}">🗑️</button></li>`;
  }).join('') || `<li class="pass-row">${t('pass.none')}</li>`;
  // tocar num lugar abre a FICHA do boteco (mesmo padrão do placar → comanda)
  el['passport-list'].querySelectorAll('.pass-main').forEach((b) => {
    const open = () => { const li = b.closest('.pass-row'); if (li && li.dataset.place) H.onBoteco(li.dataset.place); };
    b.addEventListener('click', open);
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
  // 🗑️ apagar UM check-in in-context (no lugar onde ele vive) — não trava o toque que abre a ficha
  el['passport-list'].querySelectorAll('.pass-del').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation(); const li = b.closest('.pass-row'); if (li && li.dataset.at) H.onDeleteCheckin(li.dataset.at);
  }));
  el['overlay-passport'].hidden = false;
}

// Ficha de um boteco: visitas · gasto · bebida favorita + o cardápio salvo, com "carregar numa
// mesa nova". Reusa as classes .comanda-* (lista) e .sheet-sub (stats) — sem CSS novo.
export function openBoteco(vm) {
  el['boteco-title'].textContent = `📓 ${vm.name || t('common.anon')}`;
  el['overlay-boteco'].dataset.place = vm.name || ''; // fonte de verdade do lugar aberto (renomear/apagar)
  const lang = document.documentElement.lang || 'pt-BR';
  el['boteco-stats'].innerHTML = [
    `📍 ${vm.visits || 0} ${vm.visits === 1 ? t('pass.checkin1') : t('pass.checkinN')}`,
    vm.spent > 0 ? `💸 ${esc(fmtMoney(vm.spent))}` : '',
    vm.fav ? `⭐ ${esc(t('boteco.fav'))}: ${esc(vm.fav.emoji)} ${esc(vm.fav.name)}` : '',
    vm.lastAt ? `🕒 ${esc(t('boteco.last'))} ${esc(new Date(vm.lastAt).toLocaleDateString(lang))}` : '',
  ].filter(Boolean).join(' · ');
  const hasMenu = !!(vm.menu && vm.menu.length);
  el['boteco-menu'].innerHTML = hasMenu
    ? vm.menu.map((it) => `<li class="comanda-row"><span class="c-emoji">${esc(it.emoji || '🍺')}</span><span class="c-name">${esc(it.name)}</span>${it.price > 0 ? `<span class="c-money">${esc(fmtMoney(it.price))}</span>` : ''}</li>`).join('')
    : `<li class="comanda-row">${esc(t('boteco.noMenu'))}</li>`;
  el['btn-boteco-load'].textContent = t('boteco.loadNew');
  el['btn-boteco-load'].hidden = !hasMenu;
  el['btn-boteco-load'].dataset.place = vm.name || '';
  el['btn-boteco-del'].hidden = !hasMenu; // só há o que apagar se existe cardápio salvo
  el['boteco-rename-box'].hidden = true;   // renomear abre fechado (progressive disclosure)
  el['boteco-rename'].value = vm.name || '';
  el['overlay-boteco'].hidden = false;
}

// 🗄️ Meus dados: painel de TRANSPARÊNCIA (contagem + tamanho por categoria) + deleção GRANULAR.
// Cada linha é uma categoria com um botão de ação (Limpar / → anônimo / Rever). A honestidade P2P
// ("só deste aparelho") mora no topo do sheet (markup). Reusa .btn-ghost — nada de CSS de botão novo.
export function openData(vm) {
  const kb = (b) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`);
  const row = (cat, emoji, name, sub, act) => `<li class="data-row">
    <span class="data-emoji" aria-hidden="true">${emoji}</span>
    <div class="data-main"><span class="data-name">${esc(name)}</span><span class="data-sub">${esc(sub)}</span></div>
    <button class="btn btn-ghost data-clear" data-cat="${cat}">${esc(act)}</button></li>`;
  const rows = [
    row('perfil', '👤', t('data.perfil'), vm.perfil.set ? (vm.perfil.name || t('data.perfilSet')) : t('data.perfilNone'), t('data.toAnon')),
    row('mesas', '🍺', t('data.mesas'), `${vm.mesas.count} · ${kb(vm.mesas.bytes)}`, t('data.clear')),
    row('passaporte', '🗺️', t('data.pass'), `${vm.passaporte.count} · ${kb(vm.passaporte.bytes)}`, t('data.clear')),
    row('cardapios', '📓', t('data.menus'), `${vm.cardapios.count} · ${kb(vm.cardapios.bytes)}`, t('data.clear')),
  ];
  if (vm.dev.show) rows.push(row('dev', '🐛', t('data.dev'), `${vm.dev.count} · ${kb(vm.dev.bytes)}`, t('data.clear')));
  rows.push(row('tour', '🎓', t('data.tour'), t('data.tourSub'), t('data.tourDo')));
  el['data-list'].innerHTML = rows.join('');
  el['data-list'].querySelectorAll('.data-clear').forEach((b) => b.addEventListener('click', () => H.onDataClear(b.dataset.cat)));
  el['overlay-data'].hidden = false;
}

// ---------- Guia de boas-vindas (primeira vez) ----------
export function openWelcome() { el['overlay-welcome'].hidden = false; }

// Índice do "🎓 Tour do Botequei": uma linha por trilha, ✓ nas já concluídas (roda quantas quiser)
export function openTour(vm) {
  el['tour-trails'].innerHTML = (vm.trails || []).map((tr) =>
    `<button class="menu-item" data-trail="${esc(tr.id)}">${esc(tr.emoji)} ${esc(tr.label)}${tr.done ? ' <span class="trail-done">✓</span>' : ''}</button>`).join('');
  el['tour-trails'].querySelectorAll('[data-trail]').forEach((b) => b.addEventListener('click', () => H.onTourTrail(b.dataset.trail)));
  el['overlay-tour'].hidden = false;
}

// ---------- Overlays / toast ----------
export function closeOverlays() {
  if (activeScan) { activeScan.stop(); activeScan = null; }
  if (camStream) stopCam(); // webcam do perfil aberta? desliga a stream (fechou por ✕/ESC/voltar/arrastar)
  // Fecha TUDO de uma vez (ESC / tour / arrastar-pra-fechar): captura a origem do 1º overlay da
  // pilha, ESVAZIA a pilha ANTES de esconder (assim os observers viram no-op e não brigam pelo
  // foco) e devolve o foco à origem. ⚠️ NÃO chamamos syncOverlayHistory aqui: os menus fazem
  // `closeOverlays(); abreOutro()` (troca síncrona), e um sync AQUI veria "nada aberto" (o novo
  // overlay ainda não abriu) e dispararia um history.back() cujo popstate atrasado fecharia o
  // overlay recém-aberto (era a regressão que o e2e-a11y/features pegou). Deixa o OBSERVER de
  // cada overlay fechado chamar o sync: aí o próximo já abriu → ele vê "ainda tem overlay" e o
  // ÚNICO estado atravessa a troca intacto; num fechamento de verdade (sem troca) o observer vê
  // "nada aberto" e desfaz o estado (back() guardado). Idêntico ao mecanismo original comprovado.
  const origin = overlayStack.length ? overlayStack[0].focus : null;
  overlayStack.length = 0;
  document.querySelectorAll('.overlay').forEach((o) => { o.hidden = true; });
  if (origin) { try { origin.focus({ preventScroll: true }); } catch { /* ignore */ } }
}
let toastTimer = null;
let pendingAction = null; // actionToast em andamento (tem AÇÃO clicável — ex.: "desfazer")
let queuedToast = null;   // toast comum represado enquanto a ação está aberta (não a engole)
export function toast(msg) {
  // Toast comum (cutucada, presença, garçom) que chega durante a janela de um actionToast
  // ENGOLIA a ação: zerava o `onclick` e o timer, e o "desfazer" sumia. Agora espera a ação
  // fechar (clique ou timeout) e sai logo em seguida — o undo sobrevive.
  if (pendingAction) { queuedToast = msg; return; }
  showToast(msg);
}
function showToast(msg) {
  if (devHook) devHook('toast', { m: String(msg).slice(0, 80) }); // o que o app DISSE ao usuário
  const t = el['toast']; t.onclick = null; t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}
// Toast com uma acao (ex.: "desfazer", "chamar carro").
export function actionToast(msg, label, cb, ms = 5000) {
  if (devHook) devHook('toast', { m: String(msg).slice(0, 80), acao: String(label).slice(0, 24) });
  const t = el['toast'];
  t.innerHTML = `${esc(msg)} · <span class="toast-action">${esc(label)}</span>`;
  t.hidden = false;
  const done = () => {
    clearTimeout(toastTimer); t.hidden = true; t.onclick = null; pendingAction = null;
    const q = queuedToast; queuedToast = null; if (q) showToast(q); // solta o toast represado
  };
  pendingAction = { done };
  t.onclick = () => { done(); if (cb) cb(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(done, ms);
}
