// Teste de reconexao: dois navegadores conectam e sincronizam; um "sai e volta"
// (reload — simula tela travar / app em segundo plano) e a sincronizacao AO VIVO
// tem que voltar sozinha. Opcional; requer playwright-core + Chromium do ambiente.
//
//   node server/node.mjs &
//   node tests/e2e-reconnect.mjs

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 30000;

async function main() {
  const b = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  const mk = async (name) => {
    const c = await b.newContext();
    await c.addInitScript((n) => { localStorage.setItem('botequei.name', n); localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 })); localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' })); }, name); // testes não são 1º uso (sem welcome/tour) e asseveram textos pt
    return c.newPage();
  };
  const peers = (p, n) =>
    p.waitForFunction((v) => document.getElementById('peer-count')?.textContent === v, String(n), { timeout: T });
  const itemQty = (p, item, v) =>
    p.waitForFunction((a) => {
      const el = document.querySelector(`.item-card[data-item="${a.item}"] .item-qty`);
      return el && el.textContent === a.v;
    }, { item, v: String(v) }, { timeout: T });

  const done = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); done.push(name); };

  const A = await mk('Andre');
  await A.goto(BASE);
  await A.waitForSelector('#screen-home.is-active', { timeout: T });
  await A.click('#btn-create');
  await A.waitForSelector('#screen-table.is-active', { timeout: T });
  await A.click('#overlay-invite .sheet-close').catch(() => {});
  const code = (await A.textContent('#mesa-code')).trim();

  const B = await mk('Bia');
  await B.goto(BASE + '#/join?room=' + code);
  await B.waitForSelector('#screen-table.is-active', { timeout: T });

  await step('A e B conectam', async () => { await Promise.all([peers(A, 2), peers(B, 2)]); });
  await step('+1 em A sincroniza em B', async () => {
    await A.click('.item-card[data-item="cerveja"]');
    await itemQty(B, 'cerveja', 1);
  });

  await step('B "sai e volta" (reload) e recupera o estado', async () => {
    await B.reload({ waitUntil: 'domcontentloaded' });
    await B.waitForSelector('#screen-table.is-active', { timeout: T });
    await itemQty(B, 'cerveja', 1); // cache local + anti-entropy
  });

  await step('reconecta sozinho e o sync AO VIVO volta', async () => {
    await Promise.all([peers(A, 2), peers(B, 2)]);       // voltaram a se ver
    await A.click('.item-card[data-item="cerveja"]');     // evento novo pos-reconexao
    await itemQty(B, 'cerveja', 2);
    await B.click('.item-card[data-item="chopp"]');       // e no sentido contrario
    await itemQty(A, 'chopp', 1);
  });

  await b.close();
  console.log(`\n${done.length} verificacoes de reconexao passaram ✅`);
}

main().catch((e) => { console.error('\n✗ RECONEXAO FALHOU:', e.message); process.exit(1); });
