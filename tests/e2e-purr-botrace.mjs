// Regressão: na purrinha SOLO, se o BOT lacra antes de você, a tela de ESCOLHER a mão
// (purr-pick) NÃO pode sumir — senão você não consegue escolher os palitos e lacrar.
// (Bug relatado pelo André: "assim que o bot joga e eu ainda não lacrei, a tela some".)
//
//   node server/node.mjs &
//   node tests/e2e-purr-botrace.mjs
//
// Variáveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 25000;

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };

  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem('botequei.name', 'André');
    localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 }));
    localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' }));
  });
  const A = await ctx.newPage();
  A.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await A.goto(BASE);
  await A.waitForSelector('#screen-home.is-active', { timeout: T });
  await A.click('#btn-create');
  await A.waitForSelector('#screen-table.is-active', { timeout: T });
  await A.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));

  // helper: abre a purrinha no modo pedido (solo já vem com 1 bot) e espera a tela de escolher a mão
  const openMode = async (btn) => {
    await A.click('#btn-menu'); await A.click('#menu-purrinha');
    await A.waitForFunction(() => !document.getElementById('overlay-purrinha').hidden, null, { timeout: T });
    await A.waitForFunction(() => document.getElementById('purr-setup') && !document.getElementById('purr-setup').hidden, null, { timeout: T });
    await A.click(btn);
    await A.waitForFunction(() => document.getElementById('purr-pick') && !document.getElementById('purr-pick').hidden, null, { timeout: T });
  };
  // o bot pensa 0,9–2,6s: dá tempo dele lacrar SEM eu ter lacrado
  const waitBotSeals = () => A.waitForTimeout(3800);
  const pickStillThere = () => A.evaluate(() => {
    const pick = document.getElementById('purr-pick'), wait = document.getElementById('purr-wait');
    const hands = document.querySelectorAll('#purr-hands .purr-hand:not([disabled]), #purr-pick .purr-hand:not([disabled])').length;
    return { pickVisible: pick && !pick.hidden, waitVisible: wait && !wait.hidden, hands };
  });

  // ---------- 3-2-1 (palitos): o cenário EXATO do relato ----------
  await openMode('#btn-purr-sticks');
  await step('3-2-1: o bot lacra primeiro e a tela de escolher os palitos CONTINUA de pé', async () => {
    await waitBotSeals();
    const st = await pickStillThere();
    if (!st.pickVisible || st.waitVisible) throw new Error('a tela de escolher sumiu quando o bot lacrou (pick=' + st.pickVisible + ', wait=' + st.waitVisible + ')');
    if (!st.hands) throw new Error('sem palitos pra escolher na tela de pick');
  });
  await step('3-2-1: agora EU escolho os palitos e lacro → a rodada anda (vai pro palpite)', async () => {
    const hand = await A.evaluate(() => document.querySelector('#purr-hands .purr-hand:not([disabled]), #purr-pick .purr-hand:not([disabled])')?.dataset.hand);
    await A.click(`.purr-hand[data-hand="${hand}"]`);
    await A.click('#btn-purr-seal');
    // os dois lacrados → fase de palpite aparece (prova que o bot tinha lacrado mesmo)
    await A.waitForFunction(() => {
      const g = document.getElementById('purr-guessing'); const r = document.getElementById('purr-result');
      return (g && !g.hidden) || (r && !r.hidden);
    }, null, { timeout: 12000 });
  });

  // fecha e reabre no modo RÁPIDO pra provar que lá também não some
  await A.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));

  // ---------- rápida: mesma garantia ----------
  await openMode('#btn-purr-fast');
  await step('rápida: o bot lacra primeiro e a tela de escolher CONTINUA de pé', async () => {
    await waitBotSeals();
    const st = await pickStillThere();
    if (!st.pickVisible || st.waitVisible) throw new Error('a tela de escolher sumiu quando o bot lacrou (pick=' + st.pickVisible + ', wait=' + st.waitVisible + ')');
    if (!st.hands) throw new Error('sem mão pra escolher na tela de pick');
  });
  await step('rápida: EU escolho mão + palpite e lacro → o resultado apura', async () => {
    await A.click('.purr-hand[data-hand="2"]');
    await A.click('.purr-opt[data-guess="3"]');
    await A.click('#btn-purr-seal');
    await A.waitForFunction(() => { const r = document.getElementById('purr-result'); return r && !r.hidden; }, null, { timeout: 15000 });
  });

  await ctx.close();
  await browser.close();
  console.log(`\n${results.length} verificações do bot-race da purrinha passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-purr-botrace falhou:', e.message); process.exit(1); });
