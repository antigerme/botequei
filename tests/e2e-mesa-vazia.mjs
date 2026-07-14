// E2E: mesa VAZIA não entope as "recentes". O app só LEMBRA a mesa (pushHistory no leaveTable) se
// rolou consumo de verdade (tableTotal > 0). Mesa aberta e fechada sem beber nada é ruído — não
// vira linha "0 · mesa 0" na home nem "noite" fantasma nos Meus Números.
//   1) criar mesa → sair SEM consumir → NÃO entra no histórico;
//   2) criar mesa → +1 numa bebida → sair → ENTRA no histórico (rolê real é preservado).
//
//   node server/node.mjs &
//   node tests/e2e-mesa-vazia.mjs
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
  const ctx = await browser.newContext();
  await ctx.addInitScript(SEED);
  const p = await ctx.newPage();
  const hist = () => p.evaluate(() => JSON.parse(localStorage.getItem('botequei.history') || '[]'));
  const leave = async () => { // botão sair pede confirmação (actionToast); o toast inteiro confirma
    await p.click('#btn-leave');
    await p.waitForFunction(() => { const t = document.getElementById('toast'); return t && !t.hidden && t.querySelector('.toast-action'); }, null, { timeout: T });
    await p.click('#toast');
    await p.waitForSelector('#screen-home.is-active', { timeout: T });
  };

  await p.goto(BASE);
  await p.waitForSelector('#screen-home.is-active', { timeout: T });

  await step('mesa VAZIA (criar → sair sem consumir) NÃO entra nas recentes', async () => {
    await p.click('#btn-create');
    await p.waitForSelector('#screen-table.is-active', { timeout: T });
    await p.click('#overlay-invite .sheet-close').catch(() => {});
    await leave();
    const h = await hist();
    if (h.length !== 0) throw new Error('mesa vazia NÃO devia ser salva, histórico tem ' + h.length);
  });

  await step('mesa COM consumo (criar → +1 → sair) ENTRA nas recentes (rolê real preservado)', async () => {
    await p.click('#btn-create');
    await p.waitForSelector('#screen-table.is-active', { timeout: T });
    const code = (await p.textContent('#mesa-code')).trim();
    await p.click('#overlay-invite .sheet-close').catch(() => {});
    // mesa nasce limpa → monta 1 item pelo ➕ e toca nele (+1) pra ter tableTotal > 0
    await p.waitForFunction(() => !document.getElementById('menu-empty').hidden, null, { timeout: T });
    await p.click('#btn-empty-custom');
    await p.fill('#add-name', 'Chopp');
    await p.click('#btn-additem-confirm');
    await p.waitForFunction(() => document.getElementById('overlay-additem').hidden, null, { timeout: T });
    await p.click('.item-card[data-item="x-chopp"]');
    await p.waitForFunction(() => Number(document.getElementById('table-total').textContent) >= 1, null, { timeout: T });
    await leave();
    const h = await hist();
    if (h.length !== 1 || h[0].room !== code) throw new Error('mesa com consumo devia estar nas recentes: ' + JSON.stringify(h));
    if (!(h[0].tableTotal > 0)) throw new Error('a mesa salva devia ter tableTotal > 0: ' + JSON.stringify(h[0]));
  });

  await ctx.close();
  await browser.close();
  console.log(`\n${results.length} verificacoes E2E (mesa vazia não entope as recentes) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E mesa-vazia FALHOU:', e.message); process.exit(1); });
