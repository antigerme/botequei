// E2E do truco (navegadores reais, WebRTC): 1v1 paulista com TRUCO corrido (+1 na hora) e
// TRUCO aceito (vale 3) com a mão jogada até o fim; placar CONVERGE nos dois aparelhos por
// várias mãos; 2v2 mineira com o PARCEIRO respondendo o truco (mergeResponses na prática).
//
//   node server/node.mjs &
//   node tests/e2e-truco.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

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
  const scoreOf = (p) => p.evaluate(() => {
    const bs = document.querySelectorAll('#tru-score b');
    return bs.length === 2 ? bs[0].textContent + 'x' + bs[1].textContent : '?';
  });
  const stakeOf = (p) => p.evaluate(() => (document.querySelector('#tru-score .tru-stake')?.textContent || '').trim());
  const findBtn = async (pages, sel, ms = 10000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      for (const p of pages) if (await p.$(sel)) return p;
      await pages[0].waitForTimeout(220);
    }
    return null;
  };
  const tryPlay = async (p) => {
    const b = await p.$('.tru-hcard:not([disabled])');
    if (b) { await b.click().catch(() => {}); return true; }
    return false;
  };

  const mkTable = async (names) => {
    const ctxs = [], pages = [];
    for (const n of names) { const c = await mkCtx(n); ctxs.push(c); pages.push(await c.newPage()); }
    const host = pages[0];
    await host.goto(BASE);
    await host.waitForSelector('#screen-home.is-active', { timeout: T });
    await host.click('#btn-create');
    await host.waitForSelector('#screen-table.is-active', { timeout: T });
    const code = (await host.textContent('#mesa-code')).trim();
    await host.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
    for (let i = 1; i < pages.length; i++) {
      await pages[i].goto(BASE + '#/join?room=' + code);
      await pages[i].waitForSelector('#screen-table.is-active', { timeout: T });
    }
    await Promise.all(pages.map((p) => p.waitForFunction((n) => document.getElementById('peer-count')?.textContent === String(n), names.length, { timeout: T })));
    return { ctxs, pages, host };
  };

  // ---------- 1v1 paulista ----------
  {
    const { ctxs, pages, host } = await mkTable(['Andre', 'Bia']);

    await step('1v1: truco paulista abre nos dois (handshake + deal lacrado)', async () => {
      await host.click('#btn-games');
      await host.waitForFunction(() => !document.getElementById('overlay-games').hidden, null, { timeout: T });
      await host.evaluate(() => { [...document.querySelectorAll('#games-grid .game-pick')].find((b) => /Truco/.test(b.textContent)).click(); });
      await vis(host, 'tru-setup');
      await host.click('#btn-tru-pta');
      await Promise.all(pages.map((p) => vis(p, 'tru-game')));
      await Promise.all(pages.map((p) => p.waitForFunction(() => document.querySelectorAll('#tru-hand .tru-hcard').length === 3, null, { timeout: T })));
    });

    await step('TRUCO! → correr: quem trucou leva o valor anterior (+1) nos dois placares', async () => {
      // quem tem a vez tem o botão de truco liberado
      const raiser = await findBtn(pages, '#btn-tru-raise');
      if (!raiser) throw new Error('ninguém pode trucar?');
      const other = pages[raiser === host ? 1 : 0];
      await raiser.click('#btn-tru-raise');
      await other.waitForFunction(() => !!document.querySelector('#btn-tru-run'), null, { timeout: T });
      await other.click('#btn-tru-run');
      await Promise.all(pages.map((p) => p.waitForFunction(() => {
        const bs = document.querySelectorAll('#tru-score b');
        return bs.length === 2 && (bs[0].textContent === '1' || bs[1].textContent === '1');
      }, null, { timeout: T })));
      const [sa, sb] = await Promise.all(pages.map(scoreOf));
      if (sa !== sb) throw new Error(`placar divergente: ${sa} vs ${sb}`);
    });

    await step('mão seguinte: TRUCO aceito vale 3 e o chip mostra', async () => {
      // espera a próxima mão dar as cartas
      await Promise.all(pages.map((p) => p.waitForFunction(() => document.querySelectorAll('#tru-hand .tru-hcard').length === 3, null, { timeout: T })));
      const raiser = await findBtn(pages, '#btn-tru-raise');
      if (!raiser) throw new Error('ninguém pode trucar na 2ª mão?');
      const other = pages[raiser === host ? 1 : 0];
      await raiser.click('#btn-tru-raise');
      await other.waitForFunction(() => !!document.querySelector('#btn-tru-acc'), null, { timeout: T });
      await other.click('#btn-tru-acc');
      await Promise.all(pages.map((p) => p.waitForFunction(() => /3/.test(document.querySelector('#tru-score .tru-stake')?.textContent || ''), null, { timeout: T })));
      const [ka, kb] = await Promise.all(pages.map(stakeOf));
      if (ka !== kb) throw new Error(`valor divergente: ${ka} vs ${kb}`);
    });

    await step('mão inteira valendo 3: joga adaptativo até o placar andar (converge)', async () => {
      const before = await scoreOf(host);
      let done = false;
      for (let i = 0; i < 60 && !done; i++) {
        for (const p of pages) await tryPlay(p);
        await host.waitForTimeout(280);
        const now = await scoreOf(host);
        if (now !== before) done = true;
      }
      if (!done) throw new Error('a mão não fechou');
      await host.waitForTimeout(600); // gossip assenta
      const [sa, sb] = await Promise.all(pages.map(scoreOf));
      if (sa !== sb) throw new Error(`placar divergente pós-mão: ${sa} vs ${sb}`);
    });

    await step('mais uma mão flui sozinha (dealer gira; placares seguem iguais)', async () => {
      await Promise.all(pages.map((p) => p.waitForFunction(() => document.querySelectorAll('#tru-hand .tru-hcard').length === 3, null, { timeout: T })));
      const before = await scoreOf(host);
      for (let i = 0; i < 60; i++) {
        for (const p of pages) await tryPlay(p);
        await host.waitForTimeout(280);
        if ((await scoreOf(host)) !== before) break;
      }
      await host.waitForTimeout(600);
      const [sa, sb] = await Promise.all(pages.map(scoreOf));
      if (sa !== sb) throw new Error(`divergiu na 3ª mão: ${sa} vs ${sb}`);
    });

    for (const c of ctxs) await c.close();
  }

  // ---------- 2v2 mineira: o PARCEIRO responde ----------
  {
    const { ctxs, pages, host } = await mkTable(['Andre', 'Bia', 'Caio', 'Duda']);

    await step('2v2: mineira abre pros quatro com mãos privadas (pelo menu "…" — consistência com o grid)', async () => {
      await host.click('#btn-menu');
      await host.click('#menu-truco');
      await vis(host, 'tru-setup');
      await host.click('#btn-tru-min');
      await Promise.all(pages.map((p) => vis(p, 'tru-game')));
      await Promise.all(pages.map((p) => p.waitForFunction(() => document.querySelectorAll('#tru-hand .tru-hcard').length === 3, null, { timeout: T })));
      const stakes = await Promise.all(pages.map(stakeOf));
      if (!stakes.every((s) => /2/.test(s))) throw new Error('mineira não começou valendo 2: ' + stakes.join(','));
    });

    await step('TRUCO da dupla A: QUALQUER um da dupla B pode responder — e o aceite fecha valendo 4', async () => {
      const raiser = await findBtn(pages, '#btn-tru-raise');
      if (!raiser) throw new Error('ninguém pode trucar no 2v2?');
      await raiser.click('#btn-tru-raise');
      // acha DOIS aparelhos com botões de resposta (a dupla adversária inteira vê)
      const responders = [];
      for (const p of pages) {
        const has = await p.waitForFunction(() => !!document.querySelector('#btn-tru-acc'), null, { timeout: 4000 }).then(() => true).catch(() => false);
        if (has) responders.push(p);
      }
      if (responders.length !== 2) throw new Error(`esperava a dupla inteira respondendo, vi ${responders.length}`);
      await responders[1].click('#btn-tru-acc'); // o PARCEIRO (segundo) responde
      await Promise.all(pages.map((p) => p.waitForFunction(() => /4/.test(document.querySelector('#tru-score .tru-stake')?.textContent || ''), null, { timeout: T })));
    });

    await step('encerrar (via ✕ da pill) fecha pra mesa toda com atribuição', async () => {
      await pages[2].click('#btn-tru-close'); // ✕ minimiza → a pill "jogo rolando" aparece
      await pages[2].waitForFunction(() => { const p = document.getElementById('game-pill'); return p && !p.hidden; }, null, { timeout: T });
      await pages[2].click('#game-pill .game-chip-end[data-kind="truco"]'); // ✕ vermelho = encerrar pra mesa toda
      await pages[2].waitForFunction(() => !document.getElementById('toast').hidden, null, { timeout: 5000 });
      await pages[2].click('#toast');
      await Promise.all(pages.map((p) => p.waitForFunction(() => document.getElementById('overlay-truco').hidden, null, { timeout: T })));
    });

    for (const c of ctxs) await c.close();
  }

  await browser.close();
  console.log(`\n${results.length} verificações do truco (1v1 paulista + 2v2 mineira) passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-truco falhou:', e.message); process.exit(1); });
