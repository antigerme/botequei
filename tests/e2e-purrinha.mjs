// E2E da Purrinha (2 navegadores reais, WebRTC): jogo honesto por commit-reveal.
// A abre a purrinha; B recebe o convite e abre junto; cada um lacra a mão + palpite; quando os
// dois lacram, abre junto e OS DOIS chegam no MESMO resultado (total, vidente, quem paga) — e o
// reveal expõe as mãos que estavam escondidas. Prova convergência + honestidade sem servidor.
//
//   php -S 127.0.0.1:8000 &
//   node tests/e2e-purrinha.mjs
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
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };
  const seal = async (page, hand, guess) => {
    await page.click(`#purr-hands .purr-opt[data-hand="${hand}"]`);
    await page.click(`#purr-guesses .purr-opt[data-guess="${guess}"]`);
    await page.click('#btn-purr-seal');
  };

  const A = await mkCtx('Andre'); const pageA = await A.newPage();
  await pageA.goto(BASE);
  await pageA.waitForSelector('#screen-home.is-active', { timeout: T });
  await pageA.click('#btn-create');
  await pageA.waitForSelector('#screen-table.is-active', { timeout: T });
  const code = (await pageA.textContent('#mesa-code')).trim();
  await pageA.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));

  const B = await mkCtx('Bia'); const pageB = await B.newPage();
  await pageB.goto(BASE + '#/join?room=' + code);
  await pageB.waitForSelector('#screen-table.is-active', { timeout: T });

  await step('A e B conectam (peer-count = 2)', async () => {
    await Promise.all([peers(pageA, 2), peers(pageB, 2)]);
  });

  await step('A abre a purrinha e B recebe o convite (abre junto)', async () => {
    await pageA.click('#btn-menu');
    await pageA.click('#menu-purrinha');
    await Promise.all([visible(pageA, 'purr-pick'), visible(pageB, 'purr-pick')]);
  });

  await step('cada um lacra a mão + palpite (nada exposto ainda)', async () => {
    // A: mão 2, palpite 3 ; B: mão 1, palpite 5  -> total = 3 (A crava, B chuta 5 e paga)
    await seal(pageA, 2, 3);
    await visible(pageA, 'purr-wait'); // A foi pra "aguardando"
    await seal(pageB, 1, 5);
  });

  await step('abre junto: os dois chegam no MESMO total (3)', async () => {
    await Promise.all([visible(pageA, 'purr-result'), visible(pageB, 'purr-result')]);
    const tA = (await pageA.textContent('#purr-total')).trim();
    const tB = (await pageB.textContent('#purr-total')).trim();
    if (tA !== tB) throw new Error(`total divergente: A="${tA}" B="${tB}"`);
    if (!/\b3\b/.test(tA)) throw new Error(`total errado: "${tA}" (esperado 3)`);
  });

  await step('reveal honesto: cada um vê a mão que estava escondida do outro', async () => {
    const revA = await pageA.textContent('#purr-reveals'); // A deve ver a mão da Bia (1)
    const revB = await pageB.textContent('#purr-reveals'); // B deve ver a mão do Andre (2)
    if (!revA.includes('✋1')) throw new Error(`A não viu a mão da Bia: ${revA}`);
    if (!revB.includes('✋2')) throw new Error(`B não viu a mão do Andre: ${revB}`);
  });

  await step('veredito coerente nos dois: A vidente, B paga', async () => {
    const vA = (await pageA.textContent('#purr-verdict')).toLowerCase();
    const vB = (await pageB.textContent('#purr-verdict')).toLowerCase();
    if (!vA.includes('vidente')) throw new Error(`A devia ser vidente: "${vA}"`);
    if (!vB.includes('paga')) throw new Error(`B devia pagar: "${vB}"`);
  });

  await browser.close();
  console.log(`\n${results.length} verificações da purrinha passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-purrinha falhou:', e.message); process.exit(1); });
