// E2E do truco GAÚCHO (navegadores reais): baralho espanhol na mesa, ENVIDO aceito com
// auto-declaração (+2 convergente nos dois placares) e a escada TRUCO→RETRUCO→VALE QUATRO
// fechando em "vale 4" nos dois aparelhos. (Flor fica no unit: não dá pra roteirizar sem
// arranjar a mão.)
//
//   php -S 127.0.0.1:8000 &
//   node tests/e2e-truco-gaucha.mjs

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 30000;

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  const mkCtx = async (name) => {
    const c = await browser.newContext();
    await c.addInitScript((n) => { localStorage.setItem('botequei.name', n); localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 })); localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' })); }, name);
    return c;
  };
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };
  const vis = (p, id) => p.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const scoreOf = (p) => p.evaluate(() => { const bs = document.querySelectorAll('#tru-score b'); return bs.length === 2 ? bs[0].textContent + 'x' + bs[1].textContent : '?'; });
  const findBtn = async (pages, sel, ms = 10000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      for (const p of pages) if (await p.$(sel)) return p;
      await pages[0].waitForTimeout(220);
    }
    return null;
  };

  const ctxs = [], pages = [];
  for (const n of ['Andre', 'Bia']) { const c = await mkCtx(n); ctxs.push(c); pages.push(await c.newPage()); }
  const host = pages[0];
  await host.goto(BASE);
  await host.waitForSelector('#screen-home.is-active', { timeout: T });
  await host.click('#btn-create');
  await host.waitForSelector('#screen-table.is-active', { timeout: T });
  const code = (await host.textContent('#mesa-code')).trim();
  await host.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
  await pages[1].goto(BASE + '#/join?room=' + code);
  await pages[1].waitForSelector('#screen-table.is-active', { timeout: T });
  await Promise.all(pages.map((p) => p.waitForFunction(() => document.getElementById('peer-count')?.textContent === '2', null, { timeout: T })));

  await step('gaúcha abre com baralho espanhol e botão de ENVIDO na 1ª vaza', async () => {
    await host.click('#btn-games');
    await host.waitForFunction(() => !document.getElementById('overlay-games').hidden, null, { timeout: T });
    await host.evaluate(() => { [...document.querySelectorAll('#games-grid .game-pick')].find((b) => /Truco/.test(b.textContent)).click(); });
    await vis(host, 'tru-setup');
    await host.click('#btn-tru-gau');
    await Promise.all(pages.map((p) => vis(p, 'tru-game')));
    await Promise.all(pages.map((p) => p.waitForFunction(() => document.querySelectorAll('#tru-hand .tru-hcard').length === 3, null, { timeout: T })));
    const env = await findBtn(pages, '#btn-tru-env');
    if (!env) throw new Error('sem botão de envido na 1ª vaza');
  });

  await step('ENVIDO aceito: auto-declara os pontos e o vencedor leva +2 nos DOIS placares', async () => {
    const caller = await findBtn(pages, '#btn-tru-env');
    await caller.click('#btn-tru-env');
    const other = pages[caller === host ? 1 : 0];
    await other.waitForFunction(() => !!document.querySelector('#btn-tru-envacc'), null, { timeout: T });
    await other.click('#btn-tru-envacc');
    await Promise.all(pages.map((p) => p.waitForFunction(() => {
      const bs = document.querySelectorAll('#tru-score b');
      return bs.length === 2 && (Number(bs[0].textContent) + Number(bs[1].textContent)) === 2;
    }, null, { timeout: T })));
    const [sa, sb] = await Promise.all(pages.map(scoreOf));
    if (sa !== sb) throw new Error(`placar do envido divergente: ${sa} vs ${sb}`);
  });

  await step('escada completa: TRUCO → RETRUCO (raise na resposta) → VALE QUATRO aceito = "vale 4"', async () => {
    const raiser = await findBtn(pages, '#btn-tru-raise');
    if (!raiser) throw new Error('sem TRUCO disponível');
    const other = pages[raiser === host ? 1 : 0];
    await raiser.click('#btn-tru-raise');            // TRUCO (2)
    await other.waitForFunction(() => !!document.querySelector('#btn-tru-reraise'), null, { timeout: T });
    await other.click('#btn-tru-reraise');           // RETRUCO (3) devolvido
    await raiser.waitForFunction(() => !!document.querySelector('#btn-tru-reraise'), null, { timeout: T });
    await raiser.click('#btn-tru-reraise');          // VALE QUATRO (4) devolvido
    await other.waitForFunction(() => !!document.querySelector('#btn-tru-acc'), null, { timeout: T });
    await other.click('#btn-tru-acc');               // aceito: vale 4
    await Promise.all(pages.map((p) => p.waitForFunction(() => /4/.test(document.querySelector('#tru-score .tru-stake')?.textContent || ''), null, { timeout: T })));
  });

  await step('mão joga até o fim valendo 4 e os placares seguem idênticos', async () => {
    const before = await scoreOf(host);
    for (let i = 0; i < 60; i++) {
      for (const p of pages) { const b = await p.$('.tru-hcard:not([disabled])'); if (b) await b.click().catch(() => {}); }
      await host.waitForTimeout(280);
      if ((await scoreOf(host)) !== before) break;
    }
    await host.waitForTimeout(700);
    const [sa, sb] = await Promise.all(pages.map(scoreOf));
    if (sa !== sb) throw new Error(`divergente pós-mão: ${sa} vs ${sb}`);
  });

  for (const c of ctxs) await c.close();
  await browser.close();
  console.log(`\n${results.length} verificações do truco gaúcho passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-truco-gaucha falhou:', e.message); process.exit(1); });
