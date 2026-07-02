// E2E do dominó (navegadores reais, WebRTC): joga partidas INTEIRAS de 2 E 4 jogadores. O dono
// distribui as mãos privadas (canal direto — oponente nunca vê), e todos jogam adaptativo (lêem
// as pedras que encaixam no DOM) até bater/trancar. Prova o loop P2P completo com 2 e 4 pessoas:
// deal privado + jogadas públicas + fim de jogo coerente em todos os aparelhos.
//
//   php -S 127.0.0.1:8000 &
//   node tests/e2e-domino.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 25000;
const NAMES = ['Andre', 'Bia', 'Caio', 'Duda'];

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  const mkCtx = async (name) => {
    const c = await browser.newContext();
    await c.addInitScript((n) => localStorage.setItem('botequei.name', n), name);
    return c;
  };
  const vis = (page, id) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const isOver = (page) => page.evaluate(() => { const e = document.getElementById('dom-result'); return !!e && !e.hidden; });
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

  async function playGame(N) {
    const ctxs = [], pages = [];
    for (let i = 0; i < N; i++) { const c = await mkCtx(NAMES[i]); ctxs.push(c); pages.push(await c.newPage()); }
    const host = pages[0];
    await host.goto(BASE);
    await host.waitForSelector('#screen-home.is-active', { timeout: T });
    await host.click('#btn-create');
    await host.waitForSelector('#screen-table.is-active', { timeout: T });
    const code = (await host.textContent('#mesa-code')).trim();
    await host.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
    for (let i = 1; i < N; i++) { await pages[i].goto(BASE + '#/join?room=' + code); await pages[i].waitForSelector('#screen-table.is-active', { timeout: T }); }
    // espera a malha ficar completa em TODOS os nós (cada um enxerga N na mesa)
    await Promise.all(pages.map((p) => p.waitForFunction((n) => document.getElementById('peer-count')?.textContent === String(n), N, { timeout: T })));

    await step(`${N}p: dominó abre em todos e o tabuleiro começa (abertura forçada)`, async () => {
      await host.click('#btn-menu'); await host.click('#menu-domino');
      await vis(host, 'dom-setup'); await host.click('#btn-dom-start'); // quem inicia escolhe o modo (partida normal)
      await Promise.all(pages.map((p) => vis(p, 'overlay-domino')));
      await Promise.all(pages.map((p) => p.waitForFunction(() => document.querySelectorAll('#dom-board .dom-tile').length >= 1, null, { timeout: T })));
    });

    await step(`${N}p: mãos privadas — o host só vê a CONTAGEM dos oponentes`, async () => {
      const counts = await host.$$eval('#dom-opps .dom-ocount', (els) => els.map((e) => e.textContent));
      if (counts.length !== N - 1) throw new Error(`esperava ${N - 1} oponentes, vi ${counts.length}`);
      if (!counts.every((c) => /\d/.test(c))) throw new Error('oponente sem contagem de pedras');
    });

    await step(`${N}p: partida inteira até bater/trancar (converge em todos)`, async () => {
      let over = false;
      for (let i = 0; i < 240 && !over; i++) {
        if ((await Promise.all(pages.map(isOver))).every(Boolean)) { over = true; break; }
        let acted = false;
        for (const p of pages) { if (/Sua vez/.test(await turnText(p))) { acted = await act(p); break; } }
        await host.waitForTimeout(180);
        if (!acted) await host.waitForTimeout(120);
      }
      if (!over) { await host.waitForTimeout(800); over = (await Promise.all(pages.map(isOver))).every(Boolean); }
      if (!over) throw new Error('a partida não terminou em todos os aparelhos');
    });

    await step(`${N}p: fim coerente — mesmo motivo e exatamente um vencedor ("Você")`, async () => {
      const res = await Promise.all(pages.map((p) => p.textContent('#dom-result').then((s) => s.trim())));
      const reason = (s) => (/bateu/.test(s) ? 'batida' : (/[Tt]rancou/.test(s) ? 'trancou' : '?'));
      const reasons = res.map(reason);
      if (reasons.some((r) => r === '?') || new Set(reasons).size !== 1) throw new Error(`motivo divergente: ${JSON.stringify(res)}`);
      const winners = res.filter((s) => /Você/.test(s)).length;
      if (winners !== 1) throw new Error(`esperava exatamente 1 vencedor, vi ${winners}: ${JSON.stringify(res)}`);
    });

    for (const c of ctxs) await c.close();
  }

  await playGame(2);
  await playGame(4);

  await browser.close();
  console.log(`\n${results.length} verificações do dominó (2p + 4p) passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-domino falhou:', e.message); process.exit(1); });
