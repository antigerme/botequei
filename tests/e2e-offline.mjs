// Teste do fallback OFFLINE: dois navegadores pareiam por QR/código com a sinalização
// COMPLETAMENTE indisponível (requisições abortadas). Prova que dá pra montar a mesa e
// sincronizar em tempo real sem internet e sem servidor — só WebRTC P2P out-of-band.
//
//   node server/node.mjs &
//   node tests/e2e-offline.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME (caminho do chrome).

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 30000;

const qtyOf = (item) => `document.querySelector('.item-card[data-item="${item}"] .item-qty')?.textContent`;

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });

  // Contexto com signaling MORTO: qualquer chamada ao endpoint /signaling é abortada.
  // page.route NÃO intercepta WebSocket — sem o stub abaixo, o upgrade furaria a simulação
  // e o pareamento sairia pelo socket em vez do QR/código que este teste cobre.
  const mk = async (name) => {
    const c = await browser.newContext();
    await c.addInitScript((n) => { localStorage.setItem('botequei.name', n); localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 })); localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' })); }, name); // testes não são 1º uso (sem welcome/tour) e asseveram textos pt
    await c.addInitScript(() => { try { Object.defineProperty(window, 'WebSocket', { value: undefined, configurable: true }); } catch { /* ignore */ } });
    await c.route('**/signaling?*', (r) => r.abort());
    return c.newPage();
  };
  const peers = (page, n) =>
    page.waitForFunction((v) => document.getElementById('peer-count')?.textContent === v, String(n), { timeout: T });
  const waitVal = async (page, sel) => {
    await page.waitForFunction((s) => { const e = document.querySelector(s); return !!(e && e.value && e.value.startsWith('BQ')); }, sel, { timeout: T });
    return page.$eval(sel, (e) => e.value);
  };

  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };

  // ---- A cria a mesa e já registra consumo ANTES de parear (testa anti-entropy) ----
  const A = await mk('Ana');
  await A.goto(BASE);
  await A.waitForSelector('#screen-home.is-active', { timeout: T });
  await A.click('#btn-create');
  await A.waitForSelector('#screen-table.is-active', { timeout: T });
  await A.click('#overlay-invite [data-close]').catch(() => {});
  await A.click('.item-card[data-item="cerveja"]');
  await A.click('.item-card[data-item="cerveja"]');

  // ---- A gera o convite offline (offer) ----
  await A.click('#btn-invite');
  await A.waitForSelector('#overlay-invite:not([hidden])', { timeout: T });
  await A.click('#btn-offline-host');
  await A.waitForSelector('#overlay-offline:not([hidden])', { timeout: T });
  const offer = await waitVal(A, '#off-offer-code');

  // ---- B entra sem internet, cola o convite e gera a resposta (answer) ----
  const B = await mk('Bia');
  await B.goto(BASE);
  await B.waitForSelector('#screen-home.is-active', { timeout: T });
  await B.click('#btn-offline-join');
  await B.waitForSelector('#overlay-offline:not([hidden])', { timeout: T });
  await B.fill('#off-offer-in', offer);
  await B.click('#btn-off-genanswer');
  const answer = await waitVal(B, '#off-answer-code');

  // ---- A lê a resposta e conecta ----
  await A.fill('#off-answer-in', answer);
  await A.click('#btn-off-connect');

  await step('A e B pareiam por código com signaling ABORTADO', async () => {
    await Promise.all([peers(A, 2), peers(B, 2)]);
  });

  await step('anti-entropy: B recebe o histórico da mesa (2 rodadas)', async () => {
    await B.waitForFunction(() => document.getElementById('table-total')?.textContent === '2', null, { timeout: T });
  });

  await step('+1 em A aparece em B ao vivo (P2P puro, sem servidor)', async () => {
    await A.click('.item-card[data-item="cerveja"]');
    await B.waitForFunction((js) => eval(js) === '3', qtyOf('cerveja'), { timeout: T });
  });

  await step('+1 em B aparece em A (bidirecional)', async () => {
    await B.click('.item-card[data-item="chopp"]');
    await A.waitForFunction((js) => eval(js) === '1', qtyOf('chopp'), { timeout: T });
  });

  await browser.close();
  console.log(`\n${results.length} verificações do fallback offline passaram ✅`);
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
