// E2E do transporte de sinalizacao (navegadores reais, WebRTC real):
//   modo padrao  — o cliente PROMOVE o polling para WebSocket (window.__sigTransport==='ws'),
//                  a mesa forma, consumo sincroniza; um 3º peer SEM WebSocket (proxy
//                  corporativo da vida) entra pela caixa-postal HTTP e conversa numa boa com
//                  quem esta de socket — interop socket↔polling na MESMA sala;
//   EXPECT_POLL=1 — servidor com NO_WS=1 (upgrade recusado): todo mundo fica no polling
//                  ('poll') e a mesa forma DO MESMO JEITO. E o teste do fallback.
//
//   node server/node.mjs &              # padrao (asserta 'ws')
//   node tests/e2e-ws.mjs
//   NO_WS=1 node server/node.mjs &      # fallback (asserta 'poll')
//   EXPECT_POLL=1 node tests/e2e-ws.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME, EXPECT_POLL.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 25000;
const WANT = process.env.EXPECT_POLL === '1' ? 'poll' : 'ws';

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };
  const mk = async (name, { noWS = false } = {}) => {
    const c = await browser.newContext();
    await c.addInitScript((n) => { localStorage.setItem('botequei.name', n); localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 })); localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' })); }, name);
    // simula o navegador atras de proxy que corta WebSocket (page.route nao intercepta WS)
    if (noWS) await c.addInitScript(() => { try { Object.defineProperty(window, 'WebSocket', { value: undefined, configurable: true }); } catch { /* ignore */ } });
    return { ctx: c, page: await c.newPage() };
  };
  const transport = (page) => page.evaluate(() => window.__sigTransport || '(sem hook)');
  const waitTransport = (page, want) =>
    page.waitForFunction((w) => window.__sigTransport === w, want, { timeout: T });
  const peers = (page, n) =>
    page.waitForFunction((v) => document.getElementById('peer-count')?.textContent === v, String(n), { timeout: T });
  const total = (page, v) =>
    page.waitForFunction((x) => document.getElementById('table-total')?.textContent.trim() === x, String(v), { timeout: T });

  const A = await mk('Andre'), B = await mk('Bia');

  await A.page.goto(BASE);
  await A.page.waitForSelector('#screen-home.is-active', { timeout: T });
  await A.page.click('#btn-create');
  await A.page.waitForSelector('#screen-table.is-active', { timeout: T });
  const code = (await A.page.textContent('#mesa-code')).trim();
  await A.page.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));

  await step(`quem cria a mesa fica no transporte '${WANT}'`, async () => {
    await waitTransport(A.page, WANT);
  });

  await step('mesa forma entre dois peers e o consumo sincroniza', async () => {
    await B.page.goto(BASE + '#/join?room=' + code);
    await B.page.waitForSelector('#screen-table.is-active', { timeout: T });
    await Promise.all([peers(A.page, 2), peers(B.page, 2)]);
    await waitTransport(B.page, WANT);
    await A.page.click('.item-card[data-item="cerveja"]');
    await Promise.all([total(A.page, 1), total(B.page, 1)]);
  });

  await step(`3º peer entra DEPOIS da mesa formada (transporte '${WANT}')`, async () => {
    const C = await mk('Caio');
    await C.page.goto(BASE + '#/join?room=' + code);
    await C.page.waitForSelector('#screen-table.is-active', { timeout: T });
    await Promise.all([peers(A.page, 3), peers(B.page, 3), peers(C.page, 3)]);
    await waitTransport(C.page, WANT);
    await total(C.page, 1); // anti-entropy: chegou depois e ve o historico
    await C.ctx.close();
    await Promise.all([peers(A.page, 2), peers(B.page, 2)]);
  });

  if (WANT === 'ws') {
    await step("peer SEM WebSocket entra pelo polling e conversa com quem esta de socket", async () => {
      const D = await mk('Dani', { noWS: true });
      await D.page.goto(BASE + '#/join?room=' + code);
      await D.page.waitForSelector('#screen-table.is-active', { timeout: T });
      await Promise.all([peers(A.page, 3), peers(B.page, 3), peers(D.page, 3)]);
      if ((await transport(D.page)) !== 'poll') throw new Error('Dani sem WebSocket deveria estar em poll, vi ' + await transport(D.page));
      if ((await transport(A.page)) !== 'ws') throw new Error('Andre deveria seguir em ws');
      await D.page.click('.item-card[data-item="cerveja"]');
      await Promise.all([total(A.page, 2), total(B.page, 2), total(D.page, 2)]);
      await D.ctx.close();
    });
  }

  await A.ctx.close(); await B.ctx.close();
  await browser.close();
  console.log(`\n${results.length} verificações do transporte (${WANT}) passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-ws falhou:', e.message); process.exit(1); });
