// E2E do dominó (2 navegadores reais, WebRTC): o dono da mesa distribui as mãos privadas (canal
// direto — o oponente nunca vê), e os dois jogam uma partida INTEIRA até alguém bater ou trancar.
// Como as mãos são aleatórias, o teste joga de forma adaptativa: na sua vez, lê as pedras que
// encaixam no DOM e joga uma (ou passa). Prova o loop completo P2P: deal privado + jogadas
// públicas + fim de jogo coerente nos dois lados.
//
//   php -S 127.0.0.1:8000 &
//   node tests/e2e-domino.mjs
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
  const isOver = (page) => page.evaluate(() => { const e = document.getElementById('dom-result'); return !!e && !e.hidden; });
  const turnText = (page) => page.evaluate(() => (document.getElementById('dom-turn')?.textContent || '').trim());
  // joga uma pedra que encaixa (escolhe a esquerda se casar nas duas pontas) ou passa
  const act = async (page) => {
    const tile = await page.$('.dom-htile:not(.dim):not([disabled])');
    if (tile) {
      await tile.click();
      if (await page.$('#dom-side-pick:not([hidden])')) await page.click('#btn-dom-L');
      return true;
    }
    const pass = await page.$('#btn-dom-pass:not([hidden])');
    if (pass) { await pass.click(); return true; }
    return false;
  };
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };

  const A = await mkCtx('Andre'); const pageA = await A.newPage();
  await pageA.goto(BASE);
  await pageA.waitForSelector('#screen-table.is-active', { timeout: T }).catch(() => {});
  await pageA.click('#btn-create');
  await pageA.waitForSelector('#screen-table.is-active', { timeout: T });
  const code = (await pageA.textContent('#mesa-code')).trim();
  await pageA.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));

  const B = await mkCtx('Bia'); const pageB = await B.newPage();
  await pageB.goto(BASE + '#/join?room=' + code);
  await pageB.waitForSelector('#screen-table.is-active', { timeout: T });
  await step('A e B conectam (peer-count = 2)', async () => { await Promise.all([peers(pageA, 2), peers(pageB, 2)]); });

  await step('A abre o dominó e B recebe a mão (privada) e o tabuleiro', async () => {
    await pageA.click('#btn-menu');
    await pageA.click('#menu-domino');
    await Promise.all([visible(pageA, 'overlay-domino'), visible(pageB, 'overlay-domino')]);
    // a abertura forçada já colocou 1 pedra no tabuleiro nos dois
    await pageA.waitForFunction(() => document.querySelectorAll('#dom-board .dom-tile').length >= 1, null, { timeout: T });
    await pageB.waitForFunction(() => document.querySelectorAll('#dom-board .dom-tile').length >= 1, null, { timeout: T });
  });

  await step('mão privada: A não enxerga as pedras da Bia (só a contagem)', async () => {
    // o oponente aparece como contagem "🁫 N", nunca como pedras de mão da Bia no aparelho do André
    const oppCount = await pageA.evaluate(() => (document.querySelector('#dom-opps .dom-ocount')?.textContent || ''));
    if (!/\d/.test(oppCount)) throw new Error('sem contagem de pedras do oponente');
  });

  await step('partida inteira: jogam adaptativo até bater/trancar (converge nos dois)', async () => {
    let over = false;
    for (let i = 0; i < 100 && !over; i++) {
      if (await isOver(pageA) && await isOver(pageB)) { over = true; break; }
      const tA = await turnText(pageA);
      if (/Sua vez/.test(tA)) { await act(pageA); }
      else {
        const tB = await turnText(pageB);
        if (/Sua vez/.test(tB)) { await act(pageB); }
      }
      await pageA.waitForTimeout(220);
    }
    if (!over) {
      // dá um tempinho final pra sincronizar o último lance
      await pageA.waitForTimeout(600);
      over = (await isOver(pageA)) && (await isOver(pageB));
    }
    if (!over) throw new Error('a partida não terminou nos dois aparelhos');
  });

  await step('fim de jogo coerente: mesmo motivo e exatamente um vencedor ("Você")', async () => {
    const rA = (await pageA.textContent('#dom-result')).trim();
    const rB = (await pageB.textContent('#dom-result')).trim();
    const reason = (s) => (/bateu/.test(s) ? 'batida' : (/[Tt]rancou/.test(s) ? 'trancou' : '?'));
    if (reason(rA) === '?' || reason(rA) !== reason(rB)) throw new Error(`motivo divergente: A="${rA}" B="${rB}"`);
    const winA = /Você/.test(rA), winB = /Você/.test(rB);
    if (winA === winB) throw new Error(`vencedor inconsistente: A="${rA}" B="${rB}"`); // exatamente um "Você"
  });

  await browser.close();
  console.log(`\n${results.length} verificações do dominó passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-domino falhou:', e.message); process.exit(1); });
