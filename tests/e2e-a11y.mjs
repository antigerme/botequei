// E2E de ACESSIBILIDADE & plataforma (leva M3+HIG):
//  1) Dynamic Type: com a fonte da raiz a 200%, nada estoura na horizontal (home e mesa)
//     e a barra de ações continua na tela — o texto é todo rem, então acompanha o sistema.
//  2) Toast é ANUNCIADO por leitor de tela (role=status + aria-live).
//  3) Trocar o tema pinta a PLATAFORMA: meta theme-color + color-scheme acompanham.
//  4) "Fonte grande" escala a raiz (html.bigfont) → o corpo cresce de verdade.
//  5) Alvos de toque ≥ 44px (✕ do sheet, botões da topbar) e touch-action: manipulation.
//
//   node server/node.mjs &
//   node tests/e2e-a11y.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

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
  const C = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await C.addInitScript(() => {
    localStorage.setItem('botequei.name', 'André');
    localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 }));
    localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt', theme: 'dark' }));
  });
  const p = await C.newPage();
  const noHScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const visible = (id) => p.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });

  await p.goto(BASE);
  await p.waitForSelector('#screen-home.is-active', { timeout: T });

  await step('toast tem role=status + aria-live (leitor de tela anuncia)', async () => {
    const okAttrs = await p.evaluate(() => {
      const t = document.getElementById('toast');
      return t && t.getAttribute('role') === 'status' && t.getAttribute('aria-live') === 'polite';
    });
    if (!okAttrs) throw new Error('#toast sem role=status/aria-live');
  });

  await step('Dynamic Type 200%: home sem estouro horizontal', async () => {
    await p.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await p.waitForTimeout(250);
    if (!(await noHScroll())) throw new Error('home estourou na horizontal a 200%');
  });

  await step('Dynamic Type 200%: mesa com cards + dock visíveis, sem estouro', async () => {
    await p.click('#btn-create');
    await p.waitForSelector('#screen-table.is-active', { timeout: T });
    await p.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
    // monta um item pra mesa ter card
    await p.click('#btn-empty-custom');
    await p.fill('#add-name', 'Chopp');
    await p.selectOption('#add-cat', 'cerveja');
    await p.click('#btn-additem-confirm');
    await p.waitForFunction(() => document.getElementById('overlay-additem').hidden, null, { timeout: T });
    await p.waitForTimeout(250);
    if (!(await noHScroll())) throw new Error('mesa estourou na horizontal a 200%');
    const dockOk = await p.evaluate(() => {
      const r = document.getElementById('btn-rodada').getBoundingClientRect();
      return r.width > 0 && r.height >= 44; // alvo de toque digno mesmo com fonte gigante
    });
    if (!dockOk) throw new Error('dock sumiu ou ficou raso a 200%');
    await p.evaluate(() => document.querySelector('style:last-of-type')?.remove()); // volta a 100%
  });

  await step('alvos de toque ≥ 48px (fecha HIG 44pt E M3 48dp): topbar + ✕ do sheet', async () => {
    const menu = await p.evaluate(() => { const r = document.getElementById('btn-menu').getBoundingClientRect(); return Math.min(r.width, r.height); });
    if (menu < 48) throw new Error('btn-menu < 48px: ' + menu);
    await p.click('#btn-menu'); await visible('overlay-menu');
    const close = await p.evaluate(() => { const b = document.querySelector('#overlay-menu .sheet-close'); const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); });
    if (close < 48) throw new Error('sheet-close < 48px: ' + close);
    await p.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
  });

  await step('touch-action: manipulation nos alvos (sem double-tap-zoom no spam de +1)', async () => {
    const ta = await p.evaluate(() => getComputedStyle(document.getElementById('btn-rodada')).touchAction);
    if (ta !== 'manipulation') throw new Error('btn-rodada touch-action=' + ta);
  });

  await step('tema claro pinta a plataforma: meta theme-color + color-scheme acompanham', async () => {
    await p.click('#btn-menu'); await visible('overlay-menu');
    await p.click('#menu-settings'); await visible('overlay-settings');
    await p.selectOption('#set-theme', 'light');
    await p.waitForFunction(() => document.body.classList.contains('light'), null, { timeout: T });
    const chrome = await p.evaluate(() => ({
      meta: document.querySelector('meta[name="theme-color"]').getAttribute('content'),
      scheme: document.documentElement.style.colorScheme,
    }));
    if (chrome.meta !== '#ece0c7') throw new Error('theme-color não acompanhou o claro: ' + chrome.meta);
    if (chrome.scheme !== 'light') throw new Error('color-scheme não acompanhou: ' + chrome.scheme);
  });

  await step('"Fonte grande" escala a RAIZ: tudo cresce junto (html.bigfont)', async () => {
    const before = await p.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    await p.check('#set-bigfont');
    await p.waitForFunction(() => document.documentElement.classList.contains('bigfont'), null, { timeout: T });
    const after = await p.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    if (!(after > before * 1.15)) throw new Error(`corpo não cresceu: ${before} → ${after}`);
  });

  await C.close();
  await browser.close();
  console.log(`\n${results.length} verificacoes E2E (acessibilidade M3+HIG) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E a11y FALHOU:', e.message); process.exit(1); });
