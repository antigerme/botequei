// Card compartilhavel da noite (imagem via canvas) + Web Share. Gerado no cliente.

import { tableTotal, summary, tableInfo } from './events.js';

export function recapText(state, resolveItem) {
  const t = tableInfo(state);
  const title = (t.emoji || '🍺') + ' ' + (t.title || 'Mesa do Botequei');
  const rows = summary(state, resolveItem).filter((r) => r.total > 0).slice(0, 8);
  const lines = rows.map((r) => `${r.emoji || '🍺'} ${r.name || 'anônimo'}: ${r.total}`);
  return `${title}\nTotal da mesa: ${tableTotal(state)} 🍺\n${lines.join('\n')}\n\nfeito no Botequei`;
}

function renderCard(state, resolveItem) {
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
  g.fillText(String(tableTotal(state)), W / 2, 560);
  g.fillStyle = '#b3a488';
  g.font = '48px system-ui, sans-serif';
  g.fillText('rodadas na mesa', W / 2, 630);

  const rows = summary(state, resolveItem).filter((r) => r.total > 0).slice(0, 7);
  const medals = ['🥇', '🥈', '🥉'];
  let y = 760;
  g.textAlign = 'left';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    g.fillStyle = '#241f16';
    roundRect(g, 90, y - 55, W - 180, 92, 20); g.fill();
    g.font = '52px system-ui, sans-serif';
    g.fillStyle = '#f6ecd8';
    g.fillText(`${medals[i] || '　'} ${r.emoji || '🍺'} ${(r.name || 'anônimo').slice(0, 14)}`, 130, y + 8);
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

// Gera o card e tenta compartilhar (Web Share); senao, baixa a imagem.
export async function shareRecap(state, resolveItem) {
  const canvas = renderCard(state, resolveItem);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) return 'error';
  const file = new File([blob], 'botequei.png', { type: 'image/png' });
  const text = recapText(state, resolveItem);
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text, title: 'Botequei' });
      return 'shared';
    }
  } catch { return 'cancel'; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'botequei.png';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
  return 'download';
}
