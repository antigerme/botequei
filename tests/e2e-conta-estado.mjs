// E2E do "adivinha o estado, some com a bobagem": o "…" só mostra tile que FAZ algo (conta/compartilhar
// pedem consumo; preços pedem cardápio) e a conta SOLO vira recibo (sem "rachar igual"). Com uma 2ª
// pessoa, o racha volta. Precisa de 2 navegadores só pro fim (a transição solo→dupla via WebRTC real).
//
//   node server/node.mjs &
//   node tests/e2e-conta-estado.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 45000;

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  const mkCtx = async (name) => {
    const c = await browser.newContext();
    await c.addInitScript((n) => {
      localStorage.setItem('botequei.name', n);
      localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 }));
      localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' }));
    }, name);
    return c;
  };

  let n = 0;
  const ok = (cond, msg) => { if (!cond) throw new Error('✗ ' + msg); console.log('  ✓ ' + msg); n++; };
  const closeAll = (page) => page.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
  const shown = (page, id) => page.evaluate((i) => { const e = document.getElementById(i); return !!(e && !e.hidden); }, id);
  const openMenu = async (page) => {
    await page.click('#btn-menu');
    await page.waitForFunction(() => { const e = document.getElementById('overlay-menu'); return e && !e.hidden; }, null, { timeout: T });
  };
  const addItem = async (page, name) => {
    const vazio = await page.evaluate(() => !document.getElementById('menu-empty').hidden);
    await page.click(vazio ? '#btn-empty-custom' : '#btn-additem');
    await page.fill('#add-name', name);
    await page.click('#btn-additem-confirm');
    await page.waitForFunction(() => document.getElementById('overlay-additem').hidden, null, { timeout: T });
  };

  const A = await mkCtx('André'); const pageA = await A.newPage();
  await pageA.goto(BASE);
  await pageA.waitForSelector('#screen-home.is-active', { timeout: T });
  await pageA.click('#btn-create');
  await pageA.waitForSelector('#screen-table.is-active', { timeout: T });
  const code = (await pageA.textContent('#mesa-code')).trim();
  await closeAll(pageA); // fecha o convite (auto-aberto pra quem já tem tourSeen)

  // ① mesa VAZIA: o "…" esconde conta/compartilhar/preços (não oferece beco sem saída)
  await openMenu(pageA);
  ok(!(await shown(pageA, 'menu-bill')), 'mesa vazia: "💸 Fechar a conta" NÃO aparece no "…"');
  ok(!(await shown(pageA, 'menu-share')), 'mesa vazia: "📸 Compartilhar a noite" NÃO aparece');
  ok(!(await shown(pageA, 'menu-prices')), 'mesa vazia: "💲 Preços do cardápio" NÃO aparece (sem itens)');
  ok(await shown(pageA, 'menu-waiter'), '"🔔 Chamar o garçom" aparece sempre (vale a qualquer hora)');
  await closeAll(pageA);

  // com 1 item no cardápio (sem consumo ainda): "Preços" aparece; conta/compartilhar seguem escondidos
  await addItem(pageA, 'Chopp');
  await openMenu(pageA);
  ok(await shown(pageA, 'menu-prices'), 'com cardápio: "💲 Preços" aparece');
  ok(!(await shown(pageA, 'menu-bill')), 'sem consumo ainda: "💸 Fechar a conta" segue escondido');
  await closeAll(pageA);

  // 1º gole (tableTotal>0): conta e compartilhar aparecem
  await pageA.click('.item-card[data-item="x-chopp"]');
  await pageA.waitForFunction(() => document.querySelector('.item-card[data-item="x-chopp"] .item-qty')?.textContent.trim() === '1', null, { timeout: T });
  await openMenu(pageA);
  ok(await shown(pageA, 'menu-bill'), 'com consumo: "💸 Fechar a conta" aparece');
  ok(await shown(pageA, 'menu-share'), 'com consumo: "📸 Compartilhar a noite" aparece');

  // ② conta SOLO = recibo: sem "rachar igual"
  await pageA.click('#menu-bill');
  await pageA.waitForFunction(() => { const e = document.getElementById('overlay-bill'); return e && !e.hidden; }, null, { timeout: T });
  ok(!(await shown(pageA, 'bill-equal-wrap')), 'sozinho na mesa: a conta é RECIBO (sem "rachar igual")');
  await closeAll(pageA);

  // uma 2ª pessoa entra → o racha VOLTA
  const B = await mkCtx('Bia'); const pageB = await B.newPage();
  await pageB.goto(BASE + '#/join?room=' + code);
  await pageB.waitForSelector('#screen-table.is-active', { timeout: T });
  await pageA.waitForFunction(() => document.getElementById('peer-count')?.textContent === '2', null, { timeout: T });
  await pageB.click('.item-card[data-item="x-chopp"]'); // Bia bebe → o evento dela chega no André
  await pageA.waitForFunction(() => document.getElementById('table-total')?.textContent.trim() === '2', null, { timeout: T }); // prova que o estado do André já tem a Bia
  await openMenu(pageA);
  await pageA.click('#menu-bill');
  await pageA.waitForFunction(() => { const e = document.getElementById('overlay-bill'); return e && !e.hidden; }, null, { timeout: T });
  ok(await shown(pageA, 'bill-equal-wrap'), 'com 2 pessoas: o "rachar igual" VOLTA');

  await A.close(); await B.close();
  await browser.close();
  console.log(`\n${n} verificacoes E2E (adivinha estado: "…" contextual + conta solo) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E CONTA-ESTADO FALHOU:', e.message); process.exit(1); });
