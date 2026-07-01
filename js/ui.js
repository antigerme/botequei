// Camada de apresentacao: telas, cards, gestos (toque = +1, toque longo = -1),
// vibracao, animacoes e modo bebedeira. Nao guarda estado do dominio — so renderiza
// o "view model" que o app.js entrega e dispara os handlers de volta.

import { EMOJIS } from './catalog.js';

const $ = (id) => document.getElementById(id);
let H = {};           // handlers do controlador
let pickedEmoji = EMOJIS[0];

const el = {};
function cache() {
  [
    'screen-home', 'screen-table', 'input-name', 'input-code', 'btn-create', 'btn-join-code',
    'home-history', 'history-list', 'mesa-code', 'my-total', 'table-total', 'money-block', 'my-money',
    'items-grid', 'peer-count', 'conn-banner', 'toast',
    'overlay-invite', 'overlay-join', 'overlay-peers', 'overlay-additem',
    'qr-wrap', 'big-code', 'join-code-label', 'join-name', 'peers-list', 'emoji-row',
    'add-name', 'add-price', 'bebedeira', 'bebedeira-item', 'bebedeira-count', 'bebedeira-plus',
  ].forEach((id) => { el[id] = $(id); });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* ignore */ }
}

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
  node.addEventListener('pointerup', (e) => {
    if (active && !longFired) { onTap(); }
    cancel();
    e.preventDefault();
  });
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('contextmenu', (e) => e.preventDefault());
}

// ---------- Init / binding estatico ----------
export function init(handlers) {
  H = handlers;
  cache();

  el['btn-create'].addEventListener('click', () => H.onCreate());
  el['btn-join-code'].addEventListener('click', () => H.onJoinCode(el['input-code'].value));
  el['input-name'].addEventListener('change', () => H.onName(el['input-name'].value));

  $('btn-leave').addEventListener('click', () => H.onLeave());
  $('btn-invite').addEventListener('click', () => H.onInvite());
  $('btn-peers').addEventListener('click', () => H.onPeers());
  $('btn-bebedeira').addEventListener('click', () => H.onBebedeira());
  $('btn-additem').addEventListener('click', () => openAddItem());
  $('btn-additem-confirm').addEventListener('click', () => submitAddItem());
  $('btn-join-confirm').addEventListener('click', () => H.onJoinConfirm(el['join-name'].value));
  $('btn-copy-link').addEventListener('click', () => H.onCopyLink());
  const share = $('btn-share');
  if (share) share.addEventListener('click', () => H.onShare());

  // fechar overlays (botao ✕ ou clicar no fundo)
  document.querySelectorAll('.overlay').forEach((ov) => {
    ov.addEventListener('click', (e) => {
      if (e.target === ov || e.target.hasAttribute('data-close')) closeOverlays();
    });
  });

  // modo bebedeira
  $('btn-bebedeira-exit').addEventListener('click', () => closeBebedeira());
  attachGesture(el['bebedeira-plus'],
    () => { H.onAdd(bebedeiraItem); vibrate(15); popNode(el['bebedeira-plus']); },
    () => { H.onRemove(bebedeiraItem); vibrate([25, 40, 25]); });
}

export function showScreen(name) {
  el['screen-home'].classList.toggle('is-active', name === 'home');
  el['screen-table'].classList.toggle('is-active', name === 'table');
}

// ---------- Home ----------
export function setNameInput(v) { el['input-name'].value = v || ''; }

export function renderHome(history) {
  const box = el['home-history'];
  const ul = el['history-list'];
  if (!history || !history.length) { box.hidden = true; ul.innerHTML = ''; return; }
  box.hidden = false;
  ul.innerHTML = history.map((h) => {
    const d = new Date(h.at);
    const when = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return `<li class="hist-item" data-room="${esc(h.room)}">
      <span><strong>${esc(h.room)}</strong> <small>· ${when}</small></span>
      <small>você ${h.myTotal || 0} · mesa ${h.tableTotal || 0}</small>
    </li>`;
  }).join('');
  ul.querySelectorAll('.hist-item').forEach((li) => {
    li.addEventListener('click', () => H.onOpenHistory(li.dataset.room));
  });
}

// ---------- Mesa ----------
let lastIds = '';
export function renderTable(vm) {
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
      attachGesture(card,
        () => { H.onAdd(id); vibrate(15); },
        () => { H.onRemove(id); vibrate([25, 40, 25]); });
    });
    lastIds = ids;
  }
  for (const it of vm.items) {
    const card = el['items-grid'].querySelector(`[data-item="${cssq(it.id)}"]`);
    if (!card) continue;
    card.querySelector('.item-qty').textContent = it.qty;
    card.querySelector('.item-sub').textContent = it.sub;
  }
}

function cardHTML(it) {
  return `<div class="item-card" data-item="${esc(it.id)}">
    <div class="item-qty">${it.qty}</div>
    <div class="item-emoji">${it.emoji}</div>
    <div class="item-name">${esc(it.name)}</div>
    <div class="item-sub">${esc(it.sub)}</div>
    <div class="item-plus">+1</div>
  </div>`;
}

// Anima um card especifico (feedback imediato local ou de outro peer).
export function pulse(itemId, kind) {
  const card = el['items-grid'].querySelector(`[data-item="${cssq(itemId)}"]`);
  if (!card) return;
  const cls = kind === 'remove' ? 'pop-remove' : 'pop';
  card.classList.remove(cls); void card.offsetWidth; card.classList.add(cls);
  if (!el['bebedeira'].hidden && itemId === bebedeiraItem) popNode(el['bebedeira-count']);
}
function popNode(n) { n.classList.remove('pop'); void n.offsetWidth; n.classList.add('pop'); }

export function setConn(msg) {
  const b = el['conn-banner'];
  if (!msg) { b.hidden = true; return; }
  b.hidden = false; b.textContent = msg;
}

// ---------- Participantes ----------
const CONN = {
  host:  { cls: 'c-host',  txt: '🟢 direto' },
  srflx: { cls: 'c-stun',  txt: '🟡 via STUN' },
  relay: { cls: 'c-relay', txt: '🟠 via relay' },
};
function connBadge(r, selfId) {
  if (r.user === selfId) return '';
  const c = CONN[r.conn];
  return c ? `<span class="peer-conn ${c.cls}">${c.txt}</span>` : '';
}

export function renderPeers(rows, selfId) {
  el['peers-list'].innerHTML = rows.map((r) => `
    <li class="peer-row">
      <span class="peer-dot ${r.online ? 'on' : ''}"></span>
      <div class="peer-main">
        <span class="peer-name">${esc(r.name || 'anônimo')} ${r.user === selfId ? '<span class="peer-you">(você)</span>' : ''}</span>
        ${connBadge(r, selfId)}
      </div>
      <span class="peer-total">${r.total}${r.money ? ' · ' + fmtMoney(r.money) : ''}</span>
    </li>`).join('') || '<li class="peer-row">Ninguém ainda 🥲</li>';
}

// ---------- Overlays ----------
export function openInvite(vm) {
  el['big-code'].textContent = vm.code;
  el['qr-wrap'].innerHTML = '';
  el['qr-wrap'].appendChild(vm.qrNode);
  const share = $('btn-share');
  if (share) share.hidden = !navigator.share;
  el['overlay-invite'].hidden = false;
}
export function openJoin(code) {
  el['join-code-label'].textContent = code;
  el['join-name'].value = el['input-name'].value || '';
  el['overlay-join'].hidden = false;
  setTimeout(() => el['join-name'].focus(), 60);
}
export function openPeers() { el['overlay-peers'].hidden = false; }
export function closeOverlays() {
  document.querySelectorAll('.overlay').forEach((o) => { o.hidden = true; });
}

function openAddItem() {
  pickedEmoji = EMOJIS[0];
  el['emoji-row'].innerHTML = EMOJIS.map((e, i) =>
    `<button class="emoji-pick ${i === 0 ? 'sel' : ''}" data-e="${e}">${e}</button>`).join('');
  el['emoji-row'].querySelectorAll('.emoji-pick').forEach((b) => {
    b.addEventListener('click', () => {
      pickedEmoji = b.dataset.e;
      el['emoji-row'].querySelectorAll('.emoji-pick').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
    });
  });
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

// ---------- Bebedeira ----------
let bebedeiraItem = 'cerveja';
export function openBebedeira(vm) {
  bebedeiraItem = vm.item;
  el['bebedeira-item'].textContent = vm.emoji;
  el['bebedeira-count'].textContent = vm.count;
  el['bebedeira'].hidden = false;
}
export function updateBebedeira(count) {
  if (!el['bebedeira'].hidden) el['bebedeira-count'].textContent = count;
}
export function closeBebedeira() { el['bebedeira'].hidden = true; H.onBebedeiraClose && H.onBebedeiraClose(); }
export function isBebedeira() { return !el['bebedeira'].hidden; }

// ---------- Toast ----------
let toastTimer = null;
export function toast(msg) {
  const t = el['toast'];
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}

// ---------- utils ----------
function fmtMoney(v) {
  return 'R$' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function cssq(s) { return String(s).replace(/["\\]/g, '\\$&'); }
