// E2E das features novas em rede (2 navegadores reais, WebRTC): roleta sincronizada
// ("quem paga"), cutucada entregue ao alvo, "eu pago pra fulano" (PAYFOR) convergindo entre
// os peers, e as estatísticas de vida após sair da mesa.
//
//   php -S 127.0.0.1:8000 &
//   node tests/e2e-features.mjs
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
    await c.addInitScript((n) => localStorage.setItem('botequei.name', n), name);
    return c;
  };
  const peers = (page, n) => page.waitForFunction((v) => document.getElementById('peer-count')?.textContent === v, String(n), { timeout: T });
  const visible = (page, id) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const closeAll = (page) => page.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };

  const A = await mkCtx('Andre'); const pageA = await A.newPage();
  await pageA.goto(BASE);
  await pageA.waitForSelector('#screen-home.is-active', { timeout: T });
  await pageA.click('#btn-create');
  await pageA.waitForSelector('#screen-table.is-active', { timeout: T });
  const code = (await pageA.textContent('#mesa-code')).trim();
  await closeAll(pageA);

  const B = await mkCtx('Bia'); const pageB = await B.newPage();
  await pageB.goto(BASE + '#/join?room=' + code);
  await pageB.waitForSelector('#screen-table.is-active', { timeout: T });

  await step('A e B conectam (peer-count = 2)', async () => {
    await Promise.all([peers(pageA, 2), peers(pageB, 2)]);
  });

  await step('presença: A mostra os avatares da mesa (self + Bia)', async () => {
    await pageA.waitForFunction(() => {
      const b = document.getElementById('presence-bar');
      return b && !b.hidden && b.querySelectorAll('.pres-av').length >= 2;
    }, null, { timeout: T });
  });

  await step('placar mostra indicador de conexão da Bia', async () => {
    await pageA.click('#btn-peers'); await visible(pageA, 'overlay-peers');
    const hasNet = await pageA.evaluate(() => [...document.querySelectorAll('#peers-list .peer-row')]
      .some((r) => !r.querySelector('.peer-you') && (r.querySelector('.peer-net')?.textContent || '').trim().length > 0));
    if (!hasNet) throw new Error('sem indicador de conexão no placar');
    await closeAll(pageA);
  });

  // consumo p/ dar substância à conta/estatísticas
  await pageA.click('.item-card[data-item="cerveja"]');
  await pageB.click('.item-card[data-item="cerveja"]');
  await pageA.waitForTimeout(400);

  await step('roleta: mesmo vencedor nos dois aparelhos', async () => {
    await pageA.click('#btn-menu'); await pageA.click('#menu-roulette');
    await visible(pageA, 'overlay-roulette');
    await pageA.click('#btn-roulette-spin');
    await Promise.all([visible(pageA, 'roulette-result'), visible(pageB, 'roulette-result')]);
    const rA = (await pageA.textContent('#roulette-result')).trim();
    const rB = (await pageB.textContent('#roulette-result')).trim();
    if (!rA || rA !== rB) throw new Error(`resultado divergente: A="${rA}" B="${rB}"`);
  });

  await step('cutucada chega no alvo (B)', async () => {
    await closeAll(pageA);
    await pageA.click('#btn-peers'); await visible(pageA, 'overlay-peers');
    await pageA.click('.peer-poke');                 // único não-eu na lista = Bia
    await visible(pageA, 'overlay-poke');
    await pageA.click('.poke-btn[data-kind="poke"]');
    await pageB.waitForFunction(() => {
      const t = document.getElementById('toast');
      return t && !t.hidden && /cutucou/i.test(t.textContent);
    }, null, { timeout: T });
  });

  await step('"eu pago pra fulano" (PAYFOR) converge em B', async () => {
    await closeAll(pageA);
    await pageA.click('#btn-menu'); await pageA.click('#menu-bill');
    await visible(pageA, 'overlay-bill');
    await pageA.click('.bill-row .b-pay');           // A passa a cobrir a Bia
    // No aparelho da Bia, a linha dela mostra "🙌 Andre" (coberta), via CRDT
    await closeAll(pageB);
    await pageB.click('#btn-menu'); await pageB.click('#menu-bill');
    await visible(pageB, 'overlay-bill');
    await pageB.waitForFunction(() => {
      const cov = [...document.querySelectorAll('#bill-list .b-covered')];
      return cov.some((c) => /Andre/i.test(c.textContent));
    }, null, { timeout: T });
  });

  await step('estatísticas: B sai e vê 1 noite', async () => {
    await closeAll(pageB);
    await pageB.click('#btn-leave');
    await pageB.click('#toast .toast-action'); // sair pede confirmação (um toque errado não derruba da mesa)
    await pageB.waitForSelector('#screen-home.is-active', { timeout: T });
    await pageB.click('#btn-stats');
    await visible(pageB, 'overlay-stats');
    const nights = await pageB.evaluate(() => {
      const cells = [...document.querySelectorAll('#stats-grid .stat-cell')];
      const c = cells.find((x) => (x.querySelector('.stat-l')?.textContent || '').includes('noites'));
      return c ? c.querySelector('.stat-v').textContent : null;
    });
    if (nights !== '1') throw new Error('esperava 1 noite, veio ' + nights);
  });

  await browser.close();
  console.log(`\n${results.length} verificacoes E2E (features) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E features FALHOU:', e.message); process.exit(1); });
