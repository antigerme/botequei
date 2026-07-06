// Regressão: com a mesa cheia de itens, abrir "+ item personalizado" não pode deixar o
// topo do overlay (título + ✕ fechar) fora da tela. O .sheet precisa caber e rolar.
// (Bug do André: "a tela fica presa, como se tivesse algo em cima, até o fechar some".)
//
//   node server/node.mjs &
//   node tests/e2e-additem-scroll.mjs
//
// Variáveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 25000;

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };

  // celular alto e estreito: é onde o overlay estoura (igual aos prints do André)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => {
    localStorage.setItem('botequei.name', 'André');
    localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 }));
    localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' }));
  });
  const A = await ctx.newPage();
  A.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await A.goto(BASE);
  await A.waitForSelector('#screen-home.is-active', { timeout: T });
  await A.click('#btn-create');
  await A.waitForSelector('#screen-table.is-active', { timeout: T });
  await A.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));

  // monta a mesa: adiciona uns itens do catálogo e consome 1 (sai do modo montagem → aparece o "+ item")
  await A.waitForFunction(() => !document.getElementById('menu-empty').hidden, null, { timeout: T });
  await step('mesa montada com alguns itens (some o empty, aparece o "+ item personalizado")', async () => {
    for (const id of ['chopp', 'lata', 'dose']) {
      await A.click(`#empty-suggest [data-id="${id}"]`).catch(() => {});
      await A.waitForTimeout(120);
    }
    await A.click('.item-card[data-item="chopp"]'); // 1 gole → tableTotal > 0
    await A.waitForFunction(() => !document.getElementById('btn-additem').hidden, null, { timeout: T });
  });

  await step('abrir "+ item": o overlay traz o catálogo de sugestões no topo', async () => {
    await A.click('#btn-additem');
    await A.waitForFunction(() => !document.getElementById('overlay-additem').hidden, null, { timeout: T });
    await A.waitForTimeout(500); // deixa a animação 'rise' assentar antes de medir a geometria
    const suggestShown = await A.evaluate(() => !document.getElementById('add-suggest-wrap').hidden);
    if (!suggestShown) throw new Error('no "+ item" o catálogo devia aparecer');
  });

  await step('o ✕ fechar e o título ficam DENTRO da tela (topo não corta)', async () => {
    const m = await A.evaluate(() => {
      const vh = window.innerHeight;
      const close = document.querySelector('#overlay-additem .sheet-close').getBoundingClientRect();
      const sheet = document.querySelector('#overlay-additem .sheet').getBoundingClientRect();
      const title = document.querySelector('#overlay-additem h2').getBoundingClientRect();
      return { vh, closeTop: close.top, closeBottom: close.bottom, sheetTop: sheet.top, titleTop: title.top };
    });
    // o topo do sheet não pode estar acima da tela (era esse o corte); ✕ precisa estar visível
    if (m.sheetTop < -1) throw new Error(`o topo do overlay ficou cortado (sheetTop=${Math.round(m.sheetTop)} < 0)`);
    if (m.closeTop < 0 || m.closeBottom > m.vh) throw new Error(`o ✕ fechar ficou fora da tela (top=${Math.round(m.closeTop)}, bottom=${Math.round(m.closeBottom)}, vh=${m.vh})`);
    if (m.titleTop < 0) throw new Error(`o título "Novo item" ficou cortado (top=${Math.round(m.titleTop)})`);
  });

  await step('o ✕ fecha o overlay de verdade (dá pra sair)', async () => {
    await A.click('#overlay-additem .sheet-close');
    await A.waitForFunction(() => document.getElementById('overlay-additem').hidden, null, { timeout: T });
  });

  await ctx.close();
  await browser.close();
  console.log(`\n${results.length} verificações da rolagem do "+ item" passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-additem-scroll falhou:', e.message); process.exit(1); });
