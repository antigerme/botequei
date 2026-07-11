// E2E do "catch-up na volta": esconder o app / bloquear a tela CONGELA o WebRTC (regra do SO —
// não dá pra receber em tempo real). Na volta, o app resume o que rolou na mesa enquanto você
// esteve fora, lido do PRÓPRIO estado (CRDT, 100% local, sem servidor). Só aparece se houve
// novidade (delta > 0) — presença serena, não cutuca à toa.
//
// O headless não congela a aba de verdade, então forjamos document.hidden (getter mutável) e
// disparamos o visibilitychange: o snapshot sai no "esconder", o resumo no "voltar". As jogadas
// "enquanto fora" são simuladas tocando o card no próprio aparelho — o código do resumo só olha o
// delta do total da mesa (tableTotal), então a fonte do +N (peer ou toque) não muda o que se testa.
//
//   node server/node.mjs &
//   node tests/e2e-catchup.mjs
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
    // forja a visibilidade (o headless nunca esconde a aba): getter mutável + evento manual
    let _h = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => _h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (_h ? 'hidden' : 'visible') });
    window.__setHidden = (v) => { _h = !!v; document.dispatchEvent(new Event('visibilitychange')); };
  });
  const A = await ctx.newPage();
  A.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await A.goto(BASE);
  await A.waitForSelector('#screen-home.is-active', { timeout: T });
  await A.click('#btn-create');
  await A.waitForSelector('#screen-table.is-active', { timeout: T });
  await A.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));

  // grava TODOS os toasts (o toast some em ~2,4s — polling perderia a janela)
  await A.evaluate(() => {
    window.__toasts = [];
    const t = document.getElementById('toast');
    new MutationObserver(() => { if (!t.hidden && t.textContent) window.__toasts.push(t.textContent); })
      .observe(t, { childList: true, characterData: true, subtree: true, attributes: true });
  });

  // monta um item e faz uma base de consumo (mesa = 2)
  await A.waitForFunction(() => !document.getElementById('menu-empty').hidden, null, { timeout: T });
  await A.click('#btn-empty-custom');
  await A.waitForFunction(() => !document.getElementById('overlay-additem').hidden, null, { timeout: T });
  await A.fill('#add-name', 'Chopp');
  await A.click('#btn-additem-confirm');
  await A.waitForFunction(() => !!document.querySelector('.item-card[data-item="x-chopp"]'), null, { timeout: T });
  const tap = () => A.click('.item-card[data-item="x-chopp"]');
  const qtyIs = (n) => A.waitForFunction((v) => document.querySelector('.item-card[data-item="x-chopp"] .item-qty')?.textContent.trim() === v, String(n), { timeout: T });
  await tap(); await tap(); await qtyIs(2);

  await step('esconde (tira a foto) → mesa anda +3 → volta e resume "+3 na mesa"', async () => {
    await A.evaluate(() => { window.__toasts = []; window.__setHidden(true); }); // sumiu → snapshot (total 2)
    await tap(); await tap(); await tap(); await qtyIs(5);                        // a mesa andou "enquanto fora"
    await A.evaluate(() => window.__setHidden(false));                            // voltou → arma o resumo (debounce)
    await A.waitForFunction(() => (window.__toasts || []).some((t) => /esteve fora/.test(t) && /\+3/.test(t)), null, { timeout: T });
  });

  await step('volta SEM novidade fica em silêncio (delta 0 não cutuca — presença serena)', async () => {
    await A.evaluate(() => { window.__toasts = []; window.__setHidden(true); }); // esconde de novo (snapshot total 5)
    await A.evaluate(() => window.__setHidden(false));                            // volta na hora, nada mudou
    await A.waitForTimeout(3000);                                                 // passa o teto do debounce (1,8s) com folga
    const cutucou = await A.evaluate(() => (window.__toasts || []).some((t) => /esteve fora/.test(t)));
    if (cutucou) throw new Error('mostrou resumo sem novidade — deveria ficar em silêncio');
  });

  await ctx.close();
  await browser.close();
  console.log(`\n${results.length} verificações do catch-up na volta passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-catchup falhou:', e.message); process.exit(1); });
