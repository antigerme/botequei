// E2E da MESA VERIFICADA do dominó (2 navegadores reais, WebRTC): o host liga "mesa verificada"
// e o jogo passa por um handshake (seeds commit-reveal → corte coletivo; o dono lacra o baralho),
// distribui as mãos com lacre, joga a partida inteira e, no fim, TODOS AUDITAM o embaralho e veem
// "🔒✅ embaralho auditado, limpo". Prova o protocolo commit-to-deck + corte coletivo ponta-a-ponta.
//
//   php -S 127.0.0.1:8000 &
//   node tests/e2e-domino-verified.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 25000;

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  const mkCtx = async (name) => {
    const c = await browser.newContext();
    await c.addInitScript((n) => { localStorage.setItem('botequei.name', n); }, name);
    return c;
  };
  const vis = (page, id) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const over = (page) => page.evaluate(() => { const e = document.getElementById('dom-result'); return !!e && !e.hidden; });
  const turnText = (page) => page.evaluate(() => (document.getElementById('dom-turn')?.textContent || '').trim());
  const act = async (page) => {
    const tile = await page.$('.dom-htile.can:not([disabled])');
    if (tile) { await tile.click(); if (await page.$('#dom-side-pick:not([hidden])')) await page.click('#btn-dom-L'); return true; }
    const pass = await page.$('#btn-dom-pass:not([hidden])');
    if (pass) { await pass.click(); return true; }
    return false;
  };
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };

  const A = await mkCtx('Andre'); const pageA = await A.newPage();
  await pageA.goto(BASE);
  await pageA.waitForSelector('#screen-home.is-active', { timeout: T });
  await pageA.click('#btn-create');
  await pageA.waitForSelector('#screen-table.is-active', { timeout: T });
  const code = (await pageA.textContent('#mesa-code')).trim();
  await pageA.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
  const B = await mkCtx('Bia'); const pageB = await B.newPage();
  await pageB.goto(BASE + '#/join?room=' + code);
  await pageB.waitForSelector('#screen-table.is-active', { timeout: T });
  const pages = [pageA, pageB];
  await Promise.all(pages.map((p) => p.waitForFunction(() => document.getElementById('peer-count')?.textContent === '2', null, { timeout: T })));

  await step('handshake da mesa verificada (seeds+corte) → jogo começa nos dois', async () => {
    await pageA.click('#btn-menu'); await pageA.click('#menu-domino'); // dominó é SEMPRE mesa verificada
    // dom-game só aparece DEPOIS do handshake (seed commit-reveal + deal com lacre)
    await Promise.all(pages.map((p) => vis(p, 'dom-game')));
    await Promise.all(pages.map((p) => p.waitForFunction(() => document.querySelectorAll('#dom-board .dom-tile').length >= 1, null, { timeout: T })));
  });

  await step('badge "🔒 mesa verificada" visível durante a partida', async () => {
    const txt = await pageA.textContent('#dom-verified');
    if (!/verificada/i.test(txt)) throw new Error('sem badge de mesa verificada: ' + txt);
  });

  await step('partida inteira até bater/trancar', async () => {
    let done = false;
    for (let i = 0; i < 220 && !done; i++) {
      if ((await Promise.all(pages.map(over))).every(Boolean)) { done = true; break; }
      for (const p of pages) { if (/Sua vez/.test(await turnText(p))) { await act(p); break; } }
      await pageA.waitForTimeout(180);
    }
    if (!done) { await pageA.waitForTimeout(700); done = (await Promise.all(pages.map(over))).every(Boolean); }
    if (!done) throw new Error('a partida não terminou');
  });

  await step('auditoria no fim: TODOS veem "🔒✅ embaralho auditado, limpo"', async () => {
    await Promise.all(pages.map((p) => p.waitForFunction(() => {
      const e = document.getElementById('dom-verified');
      return e && !e.hidden && e.className.includes('ok');
    }, null, { timeout: 15000 })));
    for (const p of pages) {
      const cls = await p.getAttribute('#dom-verified', 'class');
      if (!cls.includes('ok') || cls.includes('bad')) throw new Error('auditoria não passou: ' + cls);
    }
  });

  await browser.close();
  console.log(`\n${results.length} verificações da mesa verificada passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-domino-verified falhou:', e.message); process.exit(1); });
