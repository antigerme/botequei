// Cards compartilhaveis (imagem via canvas) + Web Share. Gerado no cliente: recap da noite,
// conta pra dividir e cerimônia de troféus.

import { tableTotal, summary, tableInfo } from './events.js';

const BG0 = '#241d12', BG1 = '#12100b', GOLD = '#ffb92e', CREAM = '#f6ecd8', DIM = '#b3a488';

export function recapText(state, resolveItem) {
  const t = tableInfo(state);
  const title = (t.emoji || '🍺') + ' ' + (t.title || 'Mesa do Botequei');
  const rows = summary(state, resolveItem).filter((r) => r.total > 0).slice(0, 8);
  const lines = rows.map((r) => `${r.emoji || '🍺'} ${r.name || 'anônimo'}: ${r.total}`);
  return `${title}\nTotal da mesa: ${tableTotal(state, resolveItem)} 🍺\n${lines.join('\n')}\n\nfeito no Botequei`;
}

async function renderCard(state, resolveItem) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#241d12'); bg.addColorStop(1, '#12100b');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);

  g.textAlign = 'center';
  g.fillStyle = '#ffb92e';
  g.font = 'bold 130px system-ui, sans-serif';
  g.fillText('🍺', W / 2, 200);

  const t = tableInfo(state);
  g.fillStyle = '#f6ecd8';
  g.font = 'bold 64px system-ui, sans-serif';
  g.fillText(((t.emoji ? t.emoji + ' ' : '') + (t.title || 'Mesa do Botequei')).slice(0, 24), W / 2, 320);

  g.fillStyle = '#ffb92e';
  g.font = 'bold 220px system-ui, sans-serif';
  g.fillText(String(tableTotal(state, resolveItem)), W / 2, 560);
  g.fillStyle = '#b3a488';
  g.font = '48px system-ui, sans-serif';
  g.fillText('rodadas na mesa', W / 2, 630);

  const rows = summary(state, resolveItem).filter((r) => r.total > 0).slice(0, 7);
  const avatars = await loadAvatars(rows);
  const medals = ['🥇', '🥈', '🥉'];
  let y = 760;
  g.textAlign = 'left';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    g.fillStyle = '#241f16';
    roundRect(g, 90, y - 55, W - 180, 92, 20); g.fill();
    g.font = '52px system-ui, sans-serif';
    g.fillStyle = '#f6ecd8';
    if (drawAvatar(g, avatars.get(r.user), 214, y - 9, 66)) {
      g.fillText(`${medals[i] || '　'}`, 130, y + 8);
      g.fillText(`${(r.name || 'anônimo').slice(0, 14)}`, 302, y + 8);
    } else {
      g.fillText(`${medals[i] || '　'} ${r.emoji || '🍺'} ${(r.name || 'anônimo').slice(0, 14)}`, 130, y + 8);
    }
    g.textAlign = 'right';
    g.fillStyle = '#ffb92e';
    g.font = 'bold 60px system-ui, sans-serif';
    g.fillText(String(r.total), W - 130, y + 10);
    g.textAlign = 'left';
    y += 108;
  }

  g.textAlign = 'center';
  g.fillStyle = '#8a7d63';
  g.font = '40px system-ui, sans-serif';
  g.fillText('feito no Botequei · P2P, sem servidor', W / 2, H - 70);
  return c;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Pré-carrega as miniaturas de foto (dataURL do PROFILE) como Image, chaveadas por user.
// Sem foto ou carga falhou → null (o card cai pro emoji, como sempre foi).
function loadAvatars(rows) {
  return Promise.all((rows || []).map((r) => new Promise((res) => {
    const ph = typeof r.photo === 'string' && r.photo.startsWith('data:image/') ? r.photo : '';
    if (!ph) return res([r.user, null]);
    const i = new Image();
    i.onload = () => res([r.user, i]);
    i.onerror = () => res([r.user, null]);
    i.src = ph;
  }))).then((pairs) => new Map(pairs));
}
// Fotinho REDONDA no canvas (clip circular). Devolve false quando não há foto (usa emoji).
function drawAvatar(g, img, x, cy, size) {
  if (!img) return false;
  g.save();
  g.beginPath(); g.arc(x + size / 2, cy, size / 2, 0, Math.PI * 2); g.clip();
  g.drawImage(img, x, cy - size / 2, size, size);
  g.restore();
  return true;
}

// Header padrão dos cards (logo + título) — devolve o y de onde seguir desenhando.
function header(g, W, title) {
  g.textAlign = 'center';
  g.fillStyle = GOLD; g.font = 'bold 130px system-ui, sans-serif';
  g.fillText('🍺', W / 2, 200);
  g.fillStyle = CREAM; g.font = 'bold 60px system-ui, sans-serif';
  g.fillText(String(title || 'Botequei').slice(0, 24), W / 2, 310);
  return 380;
}
function newCanvas(W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, BG0); bg.addColorStop(1, BG1);
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  return { c, g };
}

// Card da conta: quanto cada um paga + total. billVM = { rows:[{name,emoji,color,amount}], total }.
async function renderBillCard(billVM, title) {
  const W = 1080, H = 1350;
  const { c, g } = newCanvas(W, H);
  let y = header(g, W, title || 'A conta');
  g.textAlign = 'center'; g.fillStyle = DIM; g.font = '46px system-ui, sans-serif';
  g.fillText('quanto cada um paga', W / 2, y); y += 90;
  const rows = (billVM.rows || []).filter((r) => r.amount > 0.005).slice(0, 8);
  const avatars = await loadAvatars(rows);
  g.textAlign = 'left';
  for (const r of rows) {
    g.fillStyle = '#241f16'; roundRect(g, 90, y - 55, W - 180, 92, 20); g.fill();
    g.font = '50px system-ui, sans-serif'; g.fillStyle = CREAM;
    if (drawAvatar(g, avatars.get(r.user), 126, y - 9, 62)) g.fillText(`${(r.name || 'anônimo').slice(0, 16)}`, 210, y + 8);
    else g.fillText(`${r.emoji || '🍺'} ${(r.name || 'anônimo').slice(0, 16)}`, 130, y + 8);
    g.textAlign = 'right'; g.fillStyle = GOLD; g.font = 'bold 54px system-ui, sans-serif';
    g.fillText('R$ ' + Number(r.amount).toFixed(2), W - 130, y + 10);
    g.textAlign = 'left'; y += 108;
  }
  g.textAlign = 'center'; g.fillStyle = GOLD; g.font = 'bold 64px system-ui, sans-serif';
  g.fillText('Total: R$ ' + Number(billVM.total || 0).toFixed(2), W / 2, y + 60);
  g.fillStyle = '#8a7d63'; g.font = '40px system-ui, sans-serif';
  g.fillText('feito no Botequei · P2P, sem servidor', W / 2, H - 70);
  return c;
}

// Card da cerimônia: troféus da noite. awards = [{emoji,title,name,detail}].
function renderCeremonyCard(awards, title) {
  const W = 1080, H = 1350;
  const { c, g } = newCanvas(W, H);
  let y = header(g, W, title || 'Cerimônia');
  g.textAlign = 'center'; g.fillStyle = DIM; g.font = '46px system-ui, sans-serif';
  g.fillText('os troféus da noite 🏆', W / 2, y); y += 100;
  const list = (awards || []).slice(0, 6);
  g.textAlign = 'left';
  for (const a of list) {
    g.fillStyle = '#241f16'; roundRect(g, 90, y - 60, W - 180, 130, 22); g.fill();
    g.font = '70px system-ui, sans-serif'; g.textAlign = 'left';
    g.fillText(a.emoji || '🏅', 130, y + 25);
    g.fillStyle = GOLD; g.font = 'bold 44px system-ui, sans-serif';
    g.fillText(String(a.title || '').slice(0, 22), 240, y - 4);
    g.fillStyle = CREAM; g.font = '46px system-ui, sans-serif';
    g.fillText(`${(a.name || 'anônimo').slice(0, 16)}${a.detail ? ' · ' + a.detail : ''}`.slice(0, 30), 240, y + 46);
    y += 156;
  }
  g.textAlign = 'center'; g.fillStyle = '#8a7d63'; g.font = '40px system-ui, sans-serif';
  g.fillText('feito no Botequei · P2P, sem servidor', W / 2, H - 70);
  return c;
}

// Compartilha (Web Share) um canvas; senao baixa a imagem. Retorna o desfecho.
async function shareCanvas(canvas, text) {
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) return 'error';
  const file = new File([blob], 'botequei.png', { type: 'image/png' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text, title: 'Botequei' });
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return 'cancel'; // usuario cancelou
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'botequei.png';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  return 'download';
}

// Gera o card e tenta compartilhar (Web Share); senao, baixa a imagem.
export async function shareRecap(state, resolveItem) {
  return shareCanvas(await renderCard(state, resolveItem), recapText(state, resolveItem));
}
export async function shareBill(billVM, title) {
  const lines = (billVM.rows || []).filter((r) => r.amount > 0.005).map((r) => `${r.emoji || '🍺'} ${r.name || 'anônimo'}: R$ ${Number(r.amount).toFixed(2)}`);
  const text = `A conta 🧾\nTotal: R$ ${Number(billVM.total || 0).toFixed(2)}\n${lines.join('\n')}\n\nfeito no Botequei`;
  return shareCanvas(await renderBillCard(billVM, title), text);
}
export async function shareCeremony(awards, title) {
  const lines = (awards || []).map((a) => `${a.emoji} ${a.title}: ${a.name}${a.detail ? ' (' + a.detail + ')' : ''}`);
  const text = `🏆 Cerimônia do Botequei\n${lines.join('\n')}\n\nfeito no Botequei`;
  return shareCanvas(renderCeremonyCard(awards, title), text);
}

// Card da Retrospectiva "Seu rolê" (estilo Wrapped). d = objeto do lifestats.retro + favEmoji/favName.
function renderRetroCard(d) {
  const W = 1080, H = 1350;
  const { c, g } = newCanvas(W, H);
  let y = header(g, W, 'Seu rolê');
  g.textAlign = 'center'; g.fillStyle = DIM; g.font = '46px system-ui, sans-serif';
  g.fillText('sua retrospectiva 🎞️', W / 2, y); y += 96;
  const line = (emoji, big, sub) => {
    g.fillStyle = '#241f16'; roundRect(g, 90, y - 56, W - 180, 112, 20); g.fill();
    g.textAlign = 'left'; g.font = '58px system-ui, sans-serif'; g.fillStyle = CREAM; g.fillText(emoji, 128, y + 16);
    g.fillStyle = GOLD; g.font = 'bold 52px system-ui, sans-serif'; g.fillText(String(big).slice(0, 16), 232, y - 4);
    g.fillStyle = DIM; g.font = '30px system-ui, sans-serif'; g.fillText(sub, 232, y + 38);
    y += 128;
  };
  line('🍺', d.totalDrinks || 0, 'rodadas na vida');
  line('📅', d.nights || 0, 'noites de boteco');
  if (d.record) line('👑', d.record.total, 'recorde numa noite');
  line('🔥', d.streakWeeks || 0, 'semanas seguidas');
  if (d.favName) line(d.favEmoji || '🍺', d.favName, 'sua favorita');
  if (d.topMate) line('🤝', d.topMate.name, 'parceiro de rolê');
  g.textAlign = 'center'; g.fillStyle = '#8a7d63'; g.font = '40px system-ui, sans-serif';
  g.fillText('feito no Botequei · P2P, sem servidor', W / 2, H - 60);
  return c;
}
export async function shareRetro(d) {
  const parts = [`🍺 ${d.totalDrinks || 0} rodadas`, `📅 ${d.nights || 0} noites`, `🔥 ${d.streakWeeks || 0} semanas`];
  if (d.favName) parts.push(`favorita: ${d.favName}`);
  if (d.topMate) parts.push(`parça: ${d.topMate.name}`);
  const text = `🎞️ Meu rolê no Botequei\n${parts.join(' · ')}\n\nfeito no Botequei`;
  return shareCanvas(renderRetroCard(d), text);
}
