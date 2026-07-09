// E2E do "polish de plataforma" (convenções de Android/iOS num PWA):
//  1) VOLTAR do sistema (Android) / swipe de voltar (iOS) fecha o overlay aberto em vez de sair —
//     testado com page.goBack() (= popstate).
//  2) iOS não dispara beforeinstallprompt → num navegador iOS o botão "📲 Instalar" aparece mesmo
//     assim (testado com User-Agent de iPhone).
//
//   node server/node.mjs &
//   node tests/e2e-plataforma.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 25000;
const SEED = () => {
  localStorage.setItem('botequei.name', 'André');
  localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 }));
  localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' }));
};

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };

  // ---- 1) VOLTAR fecha o overlay ----
  const A = await browser.newContext();
  await A.addInitScript(SEED);
  const page = await A.newPage();
  const visible = (id) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const hidden = (id) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && e.hidden; }, id, { timeout: T });
  const onTable = () => page.evaluate(() => document.getElementById('screen-table').classList.contains('is-active'));

  await page.goto(BASE);
  await page.waitForSelector('#screen-home.is-active', { timeout: T });
  await page.click('#btn-create');
  await page.waitForSelector('#screen-table.is-active', { timeout: T });
  await page.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true))); // fecha o convite

  await step('menu "…": voltar do sistema fecha o overlay (sem sair da mesa)', async () => {
    await page.click('#btn-menu');
    await visible('overlay-menu');
    await page.goBack(); // = botão voltar (Android) / swipe de voltar (iOS)
    await hidden('overlay-menu');
    if (!(await onTable())) throw new Error('voltar saiu da mesa em vez de fechar o overlay');
  });

  await step('placar: mesmo com outro overlay, voltar fecha e a mesa continua', async () => {
    await page.click('#btn-peers');
    await visible('overlay-peers');
    await page.goBack();
    await hidden('overlay-peers');
    if (!(await onTable())) throw new Error('voltar saiu da mesa');
  });

  await A.close();

  // ---- 2) botão "Instalar" aparece no iOS (sem beforeinstallprompt) ----
  const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const B = await browser.newContext({ userAgent: IOS_UA });
  await B.addInitScript(SEED);
  const pageB = await B.newPage();
  await pageB.goto(BASE);
  await pageB.waitForSelector('#screen-home.is-active', { timeout: T });
  await step('iOS (sem beforeinstallprompt): o botão "📲 Instalar" aparece assim mesmo', async () => {
    await pageB.waitForFunction(() => { const b = document.getElementById('btn-install'); return b && !b.hidden; }, null, { timeout: T });
  });
  await B.close();

  await browser.close();
  console.log(`\n${results.length} verificacoes E2E (polish de plataforma) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E plataforma FALHOU:', e.message); process.exit(1); });
