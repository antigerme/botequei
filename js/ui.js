// Camada de apresentacao: telas, cards, gestos, efeitos sociais, placar, conta, configs.
// Nao guarda estado do dominio — renderiza o "view model" do app.js e dispara handlers.

import { EMOJIS, COLORS, AVATARS } from './catalog.js';
import { scanQR, scanSupported } from './scan.js';

const $ = (id) => document.getElementById(id);
let H = {};
const el = {};

const IDS = [
  'screen-home', 'screen-table', 'input-name', 'input-code', 'btn-create', 'btn-join-code',
  'home-history', 'history-list', 'btn-install', 'btn-settings',
  'table-title', 'mesa-code', 'my-total', 'table-total', 'money-block', 'my-money', 'peer-count',
  'conn-banner', 'items-grid', 'btn-additem', 'btn-invite', 'btn-leave', 'btn-peers', 'btn-menu',
  'btn-brinde', 'btn-react', 'btn-rodada',
  'overlay-invite', 'qr-wrap', 'big-code', 'table-name-input', 'table-emoji-btn', 'table-emoji-row', 'invite-pin',
  'btn-copy-link', 'btn-share-invite', 'btn-nfc',
  'overlay-join', 'join-code-label', 'join-name', 'join-pin-field', 'join-pin', 'btn-join-confirm',
  'overlay-peers', 'mvp-banner', 'peers-list', 'my-badges',
  'overlay-menu', 'menu-profile', 'menu-board', 'menu-bill', 'menu-prices', 'menu-share', 'menu-bebedeira', 'menu-settings',
  'overlay-prices', 'price-list',
  'overlay-profile', 'profile-name', 'profile-colors', 'profile-avatars', 'profile-driver', 'btn-profile-save',
  'overlay-additem', 'emoji-row', 'add-name', 'add-price', 'btn-additem-confirm',
  'overlay-bill', 'bill-note', 'bill-service', 'bill-couvert', 'bill-equal', 'bill-list', 'bill-total',
  'overlay-pix', 'pix-title', 'pix-qr', 'pix-code', 'btn-pix-copy',
  'overlay-settings', 'set-theme', 'set-bigfont', 'set-sound', 'set-limit', 'set-water', 'set-pixkey', 'set-pixcity', 'btn-clear-data',
  'overlay-react', 'react-row',
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
function fmtMoney(v) { return 'R$' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

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

  $('btn-leave').addEventListener('click', () => H.onLeave());
  $('btn-invite').addEventListener('click', () => H.onInvite());
  $('btn-peers').addEventListener('click', () => H.onPeers());
  $('btn-menu').addEventListener('click', () => { el['overlay-menu'].hidden = false; });
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
  $('menu-bill').addEventListener('click', () => { closeOverlays(); H.onBill(); });
  $('menu-prices').addEventListener('click', () => { closeOverlays(); H.onPrices(); });
  $('menu-share').addEventListener('click', () => { closeOverlays(); H.onShareNight(); });
  $('menu-bebedeira').addEventListener('click', () => { closeOverlays(); H.onBebedeira(); });
  $('menu-settings').addEventListener('click', () => { closeOverlays(); openSettings(); });

  $('btn-profile-save').addEventListener('click', () => submitProfile());
  $('btn-pix-copy').addEventListener('click', () => H.onPixCopy());

  // conta: recalcular ao mudar opcoes
  ['bill-service', 'bill-couvert', 'bill-equal'].forEach((id) => {
    el[id].addEventListener('change', () => H.onBillChange());
    el[id].addEventListener('input', () => H.onBillChange());
  });

  // configuracoes: aplicar ao mudar
  el['set-theme'].addEventListener('change', () => H.onSetting({ theme: el['set-theme'].checked ? 'light' : 'dark' }));
  el['set-bigfont'].addEventListener('change', () => H.onSetting({ bigFont: el['set-bigfont'].checked }));
  el['set-sound'].addEventListener('change', () => H.onSetting({ sound: el['set-sound'].checked }));
  el['set-limit'].addEventListener('change', () => H.onSetting({ limit: Math.max(0, parseInt(el['set-limit'].value, 10) || 0) }));
  el['set-water'].addEventListener('change', () => H.onSetting({ waterEvery: Math.max(0, parseInt(el['set-water'].value, 10) || 0) }));
  el['set-pixkey'].addEventListener('change', () => H.onSetting({ pixKey: el['set-pixkey'].value.trim() }));
  el['set-pixcity'].addEventListener('change', () => H.onSetting({ pixCity: el['set-pixcity'].value.trim() }));
  $('btn-clear-data').addEventListener('click', () => H.onClearData());

  // offline (pareamento por QR/código, sem servidor)
  el['btn-offline-join'].addEventListener('click', () => H.onOfflineJoin());
  el['btn-offline-host'].addEventListener('click', () => { closeOverlays(); H.onOfflineHost(); });
  el['btn-off-copy-offer'].addEventListener('click', () => copyBox('off-offer-code', 'Convite copiado! 📋'));
  el['btn-off-copy-answer'].addEventListener('click', () => copyBox('off-answer-code', 'Resposta copiada! 📋'));
  el['btn-off-connect'].addEventListener('click', () => H.onOfflineConnect(el['off-answer-in'].value));
  el['btn-off-genanswer'].addEventListener('click', () => H.onOfflineGenAnswer(el['off-offer-in'].value));
  el['btn-off-scan-answer'].addEventListener('click', () => openScanner('Escanear resposta', (txt) => { el['off-answer-in'].value = txt; H.onOfflineConnect(txt); }));
  el['btn-off-scan-offer'].addEventListener('click', () => openScanner('Escanear convite', (txt) => { el['off-offer-in'].value = txt; H.onOfflineGenAnswer(txt); }));
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
}

export function showScreen(name) {
  el['screen-home'].classList.toggle('is-active', name === 'home');
  el['screen-table'].classList.toggle('is-active', name === 'table');
}

// ---------- Home ----------
export function setNameInput(v) { el['input-name'].value = v || ''; }
export function showInstall(v) { el['btn-install'].hidden = !v; }

export function renderHome(history) {
  const box = el['home-history'], ul = el['history-list'];
  if (!history || !history.length) { box.hidden = true; ul.innerHTML = ''; return; }
  box.hidden = false;
  ul.innerHTML = history.map((h) => {
    const d = new Date(h.at);
    const when = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return `<li class="hist-item" data-room="${esc(h.room)}">
      <span><strong>${esc(h.room)}</strong> <small>· ${when}</small></span>
      <small>você ${h.myTotal || 0} · mesa ${h.tableTotal || 0}</small></li>`;
  }).join('');
  ul.querySelectorAll('.hist-item').forEach((li) => li.addEventListener('click', () => H.onOpenHistory(li.dataset.room)));
}

// ---------- Mesa ----------
let lastIds = '';
export function renderTable(vm) {
  el['table-title'].textContent = vm.title || 'MESA';
  el['mesa-code'].textContent = vm.code;
  el['my-total'].textContent = vm.myTotal;
  el['table-total'].textContent = vm.tableTotal;
  el['peer-count'].textContent = vm.peerCount;
  el['money-block'].hidden = !vm.showMoney;
  if (vm.showMoney) el['my-money'].textContent = fmtMoney(vm.myMoney);

  const ids = vm.items.map((i) => i.id).join(',');
  if (ids !== lastIds) {
    el['items-grid'].innerHTML = vm.items.map(cardHTML).join('');
    el['items-grid'].querySelectorAll('.item-card').forEach((card) => {
      const id = card.dataset.item;
      attachGesture(card, () => H.onAdd(id), () => H.onRemove(id));
    });
    lastIds = ids;
  }
  for (const it of vm.items) {
    const card = el['items-grid'].querySelector(`[data-item="${cssq(it.id)}"]`);
    if (!card) continue;
    card.querySelector('.item-emoji').textContent = it.emoji;
    card.querySelector('.item-name').textContent = it.name;
    card.querySelector('.item-qty').textContent = it.qty;
    card.querySelector('.item-sub').textContent = it.sub;
  }
}
function cardHTML(it) {
  return `<div class="item-card" data-item="${esc(it.id)}">
    <div class="item-qty">${it.qty}</div>
    <div class="item-emoji">${esc(it.emoji)}</div>
    <div class="item-name">${esc(it.name)}</div>
    <div class="item-sub">${esc(it.sub)}</div>
    <div class="item-plus">+1</div></div>`;
}
export function pulse(itemId, kind) {
  const card = el['items-grid'].querySelector(`[data-item="${cssq(itemId)}"]`);
  if (card) { const cls = kind === 'remove' ? 'pop-remove' : 'pop'; card.classList.remove(cls); void card.offsetWidth; card.classList.add(cls); }
  if (!el['bebedeira'].hidden && itemId === bebedeiraItem) { const n = el['bebedeira-count']; n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop'); }
}
export function setConn(msg) { const b = el['conn-banner']; if (!msg) { b.hidden = true; return; } b.hidden = false; b.textContent = msg; }

// ---------- Placar / participantes ----------
export function renderPeers({ rows, selfId, mvp, myBadges }) {
  el['mvp-banner'].hidden = !mvp;
  if (mvp) el['mvp-banner'].innerHTML = `🏆 MVP da noite: <strong>${esc(mvp.name || 'anônimo')}</strong> · ${mvp.total} 🍺`;
  const medals = ['🥇', '🥈', '🥉'];
  let rank = 0;
  el['peers-list'].innerHTML = rows.map((r) => {
    const medal = (!r.driver && r.total > 0) ? (medals[rank++] || '') : '';
    const badges = (r.badges || []).map((b) => b.emoji).join('');
    return `<li class="peer-row">
      <span class="peer-medal">${medal}</span>
      <span class="peer-avatar" style="background:${safeColor(r.color)}">${esc(r.emoji || '🍺')}</span>
      <div class="peer-main">
        <span class="peer-name">${esc(r.name || 'anônimo')} ${r.user === selfId ? '<span class="peer-you">(você)</span>' : ''} ${r.driver ? '🚗' : ''}</span>
        <span class="peer-badges">${badges}${r.money ? ' · ' + fmtMoney(r.money) : ''}</span>
      </div>
      <span class="peer-total">${r.total}</span></li>`;
  }).join('') || '<li class="peer-row">Ninguém ainda 🥲</li>';
  el['my-badges'].innerHTML = (myBadges || []).map((b) => `<span class="badge">${b.emoji} ${esc(b.name)}</span>`).join('');
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
let profileSel = { color: COLORS[0], emoji: AVATARS[0] };
export function openProfile(cur) {
  profileSel = { color: cur.color || COLORS[0], emoji: cur.emoji || AVATARS[0] };
  el['profile-name'].value = cur.name || '';
  el['profile-driver'].checked = !!cur.driver;
  el['profile-colors'].innerHTML = COLORS.map((c) => `<button class="swatch ${c === profileSel.color ? 'sel' : ''}" style="background:${c}" data-c="${c}"></button>`).join('');
  el['profile-colors'].querySelectorAll('.swatch').forEach((b) => b.addEventListener('click', () => {
    profileSel.color = b.dataset.c; el['profile-colors'].querySelectorAll('.swatch').forEach((x) => x.classList.remove('sel')); b.classList.add('sel');
  }));
  el['profile-avatars'].innerHTML = AVATARS.map((e) => `<button class="emoji-pick ${e === profileSel.emoji ? 'sel' : ''}" data-e="${e}">${e}</button>`).join('');
  el['profile-avatars'].querySelectorAll('.emoji-pick').forEach((b) => b.addEventListener('click', () => {
    profileSel.emoji = b.dataset.e; el['profile-avatars'].querySelectorAll('.emoji-pick').forEach((x) => x.classList.remove('sel')); b.classList.add('sel');
  }));
  el['overlay-profile'].hidden = false;
}
function submitProfile() {
  H.onProfileSave({ name: el['profile-name'].value.trim(), color: profileSel.color, emoji: profileSel.emoji, driver: el['profile-driver'].checked });
  closeOverlays();
}

// ---------- Novo item ----------
let pickedEmoji = EMOJIS[0];
function openAddItem() {
  pickedEmoji = EMOJIS[0];
  el['emoji-row'].innerHTML = EMOJIS.map((e, i) => `<button class="emoji-pick ${i === 0 ? 'sel' : ''}" data-e="${e}">${e}</button>`).join('');
  el['emoji-row'].querySelectorAll('.emoji-pick').forEach((b) => b.addEventListener('click', () => {
    pickedEmoji = b.dataset.e; el['emoji-row'].querySelectorAll('.emoji-pick').forEach((x) => x.classList.remove('sel')); b.classList.add('sel');
  }));
  el['add-name'].value = ''; el['add-price'].value = '';
  el['overlay-additem'].hidden = false;
}
function submitAddItem() {
  const name = el['add-name'].value.trim();
  if (!name) { toast('Dá um nome pro item 🙂'); return; }
  const price = parseFloat(String(el['add-price'].value).replace(',', '.')) || 0;
  H.onAddItemConfirm({ emoji: pickedEmoji, name, price });
  closeOverlays();
}

// ---------- Preços ----------
export function openPrices(items) {
  el['price-list'].innerHTML = items.map((it) => `<li class="price-row">
    <span>${esc(it.emoji)} ${esc(it.name)}</span>
    <input type="number" inputmode="decimal" min="0" step="0.5" value="${it.price || ''}" data-id="${esc(it.id)}" placeholder="0,00" /></li>`).join('');
  el['price-list'].querySelectorAll('input').forEach((inp) => inp.addEventListener('change', () => H.onPriceChange(inp.dataset.id, inp.value)));
  el['overlay-prices'].hidden = false;
}

// ---------- Conta ----------
export function openBill() { el['overlay-bill'].hidden = false; }
export function billOptions() {
  return {
    service: el['bill-service'].checked,
    couvert: Math.max(0, parseFloat(String(el['bill-couvert'].value).replace(',', '.')) || 0),
    equal: el['bill-equal'].checked,
  };
}
export function renderBill(vm) {
  el['bill-note'].textContent = vm.note || '';
  el['bill-list'].innerHTML = vm.rows.map((r) => `<li class="bill-row" data-user="${esc(r.user)}">
    <span class="peer-avatar" style="background:${safeColor(r.color)}">${esc(r.emoji || '🍺')}</span>
    <span class="b-name">${esc(r.name || 'anônimo')}</span>
    <span class="b-amt">${fmtMoney(r.amount)}</span>
    ${vm.canPix && r.amount > 0 && r.user !== vm.selfId ? '<button class="b-pix">PIX</button>' : ''}</li>`).join('');
  el['bill-list'].querySelectorAll('.bill-row').forEach((li) => {
    const btn = li.querySelector('.b-pix');
    if (btn) btn.addEventListener('click', () => H.onPix(li.dataset.user));
  });
  el['bill-total'].textContent = 'Total: ' + fmtMoney(vm.total);
}

// ---------- PIX ----------
export function openPix(vm) {
  el['pix-title'].textContent = vm.title || 'Cobrar no PIX';
  el['pix-qr'].innerHTML = ''; if (vm.qrNode) el['pix-qr'].appendChild(vm.qrNode);
  el['pix-code'].value = vm.code || '';
  el['overlay-pix'].hidden = false;
}
export function pixCode() { return el['pix-code'].value; }

// ---------- Configuracoes ----------
function openSettings() { H.onOpenSettings(); el['overlay-settings'].hidden = false; }
export function fillSettings(s) {
  el['set-theme'].checked = s.theme === 'light';
  el['set-bigfont'].checked = !!s.bigFont;
  el['set-sound'].checked = !!s.sound;
  el['set-limit'].value = s.limit || '';
  el['set-water'].value = s.waterEvery || '';
  el['set-pixkey'].value = s.pixKey || '';
  el['set-pixcity'].value = s.pixCity || '';
}
export function applyTheme(s) {
  document.body.classList.toggle('light', s.theme === 'light');
  document.body.classList.toggle('bigfont', !!s.bigFont);
}

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
  cnt.textContent = n; word.textContent = 'Preparar…';
  vibrate(30);
  const iv = setInterval(() => {
    n -= 1;
    if (n > 0) { cnt.textContent = n; vibrate(30); }
    else {
      clearInterval(iv);
      cnt.textContent = '🥂'; word.textContent = 'Brinde!'; b.classList.add('go');
      vibrate([60, 40, 120]);
      if (H.onBrindeGo) H.onBrindeGo();
      setTimeout(() => { b.hidden = true; brindeRunning = false; }, 1400);
    }
  }, 800);
}

// ---------- Bebedeira ----------
let bebedeiraItem = 'cerveja';
export function openBebedeira(vm) {
  bebedeiraItem = vm.item;
  el['bebedeira-item'].textContent = vm.emoji;
  el['bebedeira-count'].textContent = vm.count;
  el['bebedeira'].hidden = false;
}
export function updateBebedeira(count) { if (!el['bebedeira'].hidden) el['bebedeira-count'].textContent = count; }
export function closeBebedeira() { el['bebedeira'].hidden = true; if (H.onBebedeiraClose) H.onBebedeiraClose(); }
export function isBebedeira() { return !el['bebedeira'].hidden; }
export function currentBebedeiraItem() { return bebedeiraItem; }

// ---------- Offline (pareamento por QR/código, sem servidor) ----------
async function copyBox(id, okMsg) {
  const v = el[id].value;
  try { await navigator.clipboard.writeText(v); toast(okMsg || 'Copiado! 📋'); }
  catch { el[id].focus(); el[id].select(); toast('Selecione e copie o código'); }
}
export function openOfflineHost() {
  el['off-host'].hidden = false; el['off-guest'].hidden = true;
  el['off-offer-qr'].innerHTML = ''; el['off-offer-code'].value = 'gerando…'; el['off-answer-in'].value = '';
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
  if (!scanSupported()) { toast('Sem câmera aqui — use o copia-e-cola 🙂'); return; }
  el['scan-title'].textContent = title || 'Escanear QR';
  el['scan-hint'].textContent = 'Aponte a câmera pro QR…';
  el['overlay-scan'].hidden = false;
  const h = scanQR(el['scan-video']);
  activeScan = h;
  h.promise.then((txt) => {
    activeScan = null; el['overlay-scan'].hidden = true; vibrate(30);
    if (onResult) onResult(txt);
  }).catch((e) => {
    activeScan = null; el['overlay-scan'].hidden = true;
    if (e && e.name === 'NotAllowedError') toast('Precisa permitir a câmera 📷');
    else if (e && e.message === 'sem-camera') toast('Sem câmera — use o copia-e-cola 🙂');
    // cancelamento manual (fechar overlay): silencioso
  });
}

// ---------- Overlays / toast ----------
export function closeOverlays() {
  if (activeScan) { activeScan.stop(); activeScan = null; }
  document.querySelectorAll('.overlay').forEach((o) => { o.hidden = true; });
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
