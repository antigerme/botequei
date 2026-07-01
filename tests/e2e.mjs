// Teste ponta-a-ponta: sobe 2 (e depois 3) navegadores reais, cria mesa, entra e valida
// a sincronizacao P2P via WebRTC — +1, -1 (toque longo) e anti-entropy (quem entra depois
// recebe o historico). Opcional; requer `playwright-core` e o Chromium do ambiente.
//
//   php -S 127.0.0.1:8000 &
//   npm i playwright-core
//   node tests/e2e.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME (caminho do chrome).

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 25000;

const qty = (item) => `document.querySelector('.item-card[data-item="${item}"] .item-qty')?.textContent`;

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });

  const mkCtx = async (name) => {
    const c = await browser.newContext();
    await c.addInitScript((n) => localStorage.setItem('botequei.name', n), name);
    return c;
  };
  const peers = (page, n) =>
    page.waitForFunction((v) => document.getElementById('peer-count')?.textContent === v, String(n), { timeout: T });
  const tableTotal = (page, v) =>
    page.waitForFunction((x) => document.getElementById('table-total')?.textContent === x, String(v), { timeout: T });
  const itemQty = (page, item, v) =>
    page.waitForFunction((a) => {
      const el = document.querySelector(`.item-card[data-item="${a.item}"] .item-qty`);
      return el && el.textContent === a.v;
    }, { item, v: String(v) }, { timeout: T });

  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };

  // ---- A cria a mesa ----
  const A = await mkCtx('Andre'); const pageA = await A.newPage();
  await pageA.goto(BASE);
  await pageA.waitForSelector('#screen-home.is-active', { timeout: T });
  await pageA.click('#btn-create');
  await pageA.waitForSelector('#screen-table.is-active', { timeout: T });
  const code = (await pageA.textContent('#mesa-code')).trim();
  console.log('  · mesa criada:', code);
  await pageA.click('#overlay-invite .sheet-close').catch(() => {});

  // ---- B entra pelo link ----
  const B = await mkCtx('Bia'); const pageB = await B.newPage();
  await pageB.goto(BASE + '#/join?room=' + code);
  await pageB.waitForSelector('#screen-table.is-active', { timeout: T });

  await step('A e B se conectam via WebRTC (peer-count = 2)', async () => {
    await Promise.all([peers(pageA, 2), peers(pageB, 2)]);
  });

  await step('+1 em A aparece em B em tempo real', async () => {
    await pageA.click('.item-card[data-item="cerveja"]');
    await itemQty(pageB, 'cerveja', 1);
    await tableTotal(pageB, 1);
  });

  await step('+1 em B aparece em A (bidirecional)', async () => {
    await pageB.click('.item-card[data-item="chopp"]');
    await itemQty(pageA, 'chopp', 1);
    await tableTotal(pageA, 2);
  });

  await step('toque longo em A faz -1 e propaga', async () => {
    const box = await (await pageA.$('.item-card[data-item="cerveja"]')).boundingBox();
    await pageA.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await pageA.mouse.down();
    await pageA.waitForTimeout(650); // segura > 480ms
    await pageA.mouse.up();
    await itemQty(pageB, 'cerveja', 0);
    await tableTotal(pageB, 1);
  });

  await step('anti-entropy: C entra depois e recebe o historico', async () => {
    const C = await mkCtx('Caio'); const pageC = await C.newPage();
    await pageC.goto(BASE + '#/join?room=' + code);
    await pageC.waitForSelector('#screen-table.is-active', { timeout: T });
    await tableTotal(pageC, 1);       // recebeu o estado via sync
    await itemQty(pageC, 'chopp', 1); // sem ter presenciado o evento ao vivo
  });

  await browser.close();
  console.log(`\n${results.length} verificacoes E2E passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E FALHOU:', e.message); process.exit(1); });
