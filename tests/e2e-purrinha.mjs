// E2E da Purrinha (navegadores reais, WebRTC): jogo honesto por commit-reveal, com 2 E 4 pessoas.
// Cada um lacra mão+palpite; quando todos lacram, abre junto e TODOS chegam no mesmo total, com
// o reveal expondo as mãos que estavam escondidas. Prova convergência + honestidade sem servidor.
//
//   php -S 127.0.0.1:8000 &
//   node tests/e2e-purrinha.mjs
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
  const peersAll = (pages, n) => Promise.all(pages.map((p) => p.waitForFunction((v) => document.getElementById('peer-count')?.textContent === v, String(n), { timeout: T })));
  const vis = (page, id) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const seal = async (page, hand, guess) => {
    await page.click(`#purr-hands .purr-hand[data-hand="${hand}"]`);
    await page.click(`#purr-guesses .purr-opt[data-guess="${guess}"]`);
    await page.click('#btn-purr-seal');
  };
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };

  async function play(N, picks, label, extra) {
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
    await peersAll(pages, N);

    await step(`${label}: abre a purrinha em todos`, async () => {
      await host.click('#btn-menu'); await host.click('#menu-purrinha');
      await Promise.all(pages.map((p) => vis(p, 'purr-pick')));
    });
    await step(`${label}: cada um lacra a mão + palpite`, async () => {
      await seal(pages[0], picks[0].hand, picks[0].guess);
      await vis(pages[0], 'purr-wait');
      for (let i = 1; i < N; i++) await seal(pages[i], picks[i].hand, picks[i].guess);
    });
    await step(`${label}: abre junto e TODOS batem no mesmo total (${extra.total})`, async () => {
      await Promise.all(pages.map((p) => vis(p, 'purr-result')));
      const totals = await Promise.all(pages.map((p) => p.textContent('#purr-total').then((s) => s.replace(/\D+/g, ''))));
      if (new Set(totals).size !== 1) throw new Error(`total divergente: ${JSON.stringify(totals)}`);
      if (Number(totals[0]) !== extra.total) throw new Error(`total ${totals[0]} ≠ esperado ${extra.total}`);
      const rows = await pages[0].$$eval('#purr-reveals .purr-rev', (els) => els.length);
      if (rows !== N) throw new Error(`reveal mostrou ${rows} mãos, esperava ${N}`);
    });
    await step(`${label}: exatamente um "Você paga"`, async () => {
      const verds = await Promise.all(pages.map((p) => p.textContent('#purr-verdict')));
      const pays = verds.filter((v) => /Você paga/.test(v)).length;
      if (pays !== 1) throw new Error(`esperava 1 "Você paga", vi ${pays}: ${JSON.stringify(verds)}`);
    });
    for (const c of ctxs) await c.close();
  }

  // 2p: mãos 2 e 1 -> total 3; A crava 3 (vidente), B chuta 5 e paga
  await play(2, [{ hand: 2, guess: 3 }, { hand: 1, guess: 5 }], '2p', { total: 3 });
  // 4p: todos escondem 1 -> total 4; A/B/D cravam 4 (videntes), C chuta 0 e paga
  await play(4, [{ hand: 1, guess: 4 }, { hand: 1, guess: 4 }, { hand: 1, guess: 0 }, { hand: 1, guess: 4 }], '4p', { total: 4 });

  await browser.close();
  console.log(`\n${results.length} verificações da purrinha (2p + 4p) passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-purrinha falhou:', e.message); process.exit(1); });
