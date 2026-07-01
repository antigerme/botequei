// Gera um QR Code (SVG vetorial) para o link de convite da mesa.
// Usa a lib local qrcode-generator (MIT) — nenhuma dependencia de rede em runtime.

import qrcode from './vendor/qrcode.js';

// Retorna um <svg> pronto para inserir no DOM.
export function makeQR(text, margin = 2) {
  let qr = null;
  for (const type of [0, 4, 6, 8, 10, 13, 16, 20]) {
    try {
      qr = qrcode(type, 'M');
      qr.addData(text);
      qr.make();
      break;
    } catch {
      qr = null;
    }
  }
  if (!qr) throw new Error('Conteúdo grande demais para o QR');

  const n = qr.getModuleCount();
  const dim = n + margin * 2;
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    }
  }
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">` +
    `<rect width="${dim}" height="${dim}" fill="#ffffff"/>` +
    `<path d="${d}" fill="#12100b"/></svg>`;

  const box = document.createElement('div');
  box.innerHTML = svg;
  return box.firstElementChild;
}
