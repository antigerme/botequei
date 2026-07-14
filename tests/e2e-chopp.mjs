// E2E do cutucão "🍺 me paga um chopp" no fechar a conta: aparece SÓ pra ASSÍDUO (Liga prata OU
// 8+ noites), "já paguei" desliga PRA SEMPRE, e novato NUNCA vê. É pull raro, não empurra — o gate
// mora no app.js (Liga + 1×/temporada). Zero rede: é UI local + histórico semeado.
//
//   node server/node.mjs &
//   node tests/e2e-chopp.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 30000;

// semeia o aparelho: nome + sem 1º uso (welcome/tour) + pt; e `nights` "noites" no histórico
// (a régua do assíduo do cutucão — 8+ noites já destrava, sem depender do nível da Liga).
const SEED = (nights) => {
  localStorage.setItem('botequei.name', 'André');
  localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 }));
  localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' }));
  const hist = [];
  for (let i = 0; i < nights; i++) {
    hist.push({ room: 'r' + i, at: Date.now() - i * 86400000, myTotal: 20, tableTotal: 40, myMoney: 30, title: 'Bar do Zé', items: { chopp: 4 }, mates: [] });
  }
  localStorage.setItem('botequei.history', JSON.stringify(hist));
};

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  let n = 0;
  const ok = (cond, msg) => { if (!cond) throw new Error('✗ ' + msg); console.log('  ✓ ' + msg); n++; };
  const closeOverlays = (page) => page.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
  const shown = (page) => page.evaluate(() => { const e = document.getElementById('bill-chopp'); return !!(e && !e.hidden); });
  const stg = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('botequei.settings') || '{}'));

  // cria a mesa, monta 1 item pelo ➕ e marca +1 (tableTotal>0 é pré-requisito do cutucão).
  async function tableWithNight(page) {
    await page.goto(BASE);
    await page.waitForSelector('#screen-home.is-active', { timeout: T });
    await page.click('#btn-create');
    await page.waitForSelector('#screen-table.is-active', { timeout: T });
    await closeOverlays(page); // a mesa auto-abre o convite (tourSeen) — fecha antes de mexer
    const vazio = await page.evaluate(() => !document.getElementById('menu-empty').hidden);
    await page.click(vazio ? '#btn-empty-custom' : '#btn-additem');
    await page.fill('#add-name', 'Chopp');
    await page.click('#btn-additem-confirm');
    await page.waitForFunction(() => document.getElementById('overlay-additem').hidden, null, { timeout: T });
    await page.click('.item-card[data-item="x-chopp"]');
    await page.waitForFunction(() => document.querySelector('.item-card[data-item="x-chopp"] .item-qty')?.textContent.trim() === '1', null, { timeout: T });
  }
  async function openBill(page) {
    await page.click('#btn-menu'); await page.click('#menu-bill');
    await page.waitForFunction(() => { const e = document.getElementById('overlay-bill'); return e && !e.hidden; }, null, { timeout: T });
  }

  // ---- ASSÍDUO (8 noites): vê o cutucão; "já paguei" desliga pra sempre ----
  const A = await browser.newContext();
  await A.addInitScript(SEED, 8);
  const pa = await A.newPage();
  await tableWithNight(pa);
  await openBill(pa);
  ok(await shown(pa), 'assíduo (8 noites): o cutucão do chopp aparece ao fechar a conta');
  const txt = await pa.textContent('#bill-chopp');
  ok(/rolês/.test(txt), 'a mensagem é gratidão-primeiro ("já foram N rolês…")');
  ok(await pa.$('#btn-chopp-copy') !== null, 'copiar o PIX é a ação principal (copiar-primeiro)');
  ok(await pa.$('#btn-chopp-off') !== null, 'tem o "já paguei" (kill-switch)');
  ok(typeof (await stg(pa)).choppSeason === 'number', 'marca a temporada ao abrir (teto de 1×/mês)');
  await pa.click('#btn-chopp-off');
  await pa.waitForFunction(() => document.getElementById('bill-chopp').hidden, null, { timeout: T });
  ok(!!(await stg(pa)).choppOff, '"já paguei" grava o desligar-pra-sempre (choppOff)');
  await closeOverlays(pa);
  await openBill(pa);
  ok(!(await shown(pa)), 'depois de "já paguei", o cutucão NÃO volta (permanente)');

  // ---- NOVATO (0 noites): nunca vê, nem marca a temporada ----
  const C = await browser.newContext();
  await C.addInitScript(SEED, 0);
  const pc = await C.newPage();
  await tableWithNight(pc);
  await openBill(pc);
  ok(!(await shown(pc)), 'novato (0 noites): o cutucão NÃO aparece (gate na Liga)');
  ok(typeof (await stg(pc)).choppSeason === 'undefined', 'novato nem marca a temporada (o gate curto-circuita antes)');

  await A.close(); await C.close();
  await browser.close();
  console.log(`\n${n} verificacoes E2E (cutucão do chopp) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E CHOPP FALHOU:', e.message); process.exit(1); });
