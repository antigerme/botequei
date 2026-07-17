// E2E responsive: percorre a jornada REAL do app (boas-vindas → mesa → item → consumo → rodada/
// reagir/placar → jogos/setups → menu/cardápio/conta → hub/perfil/passaporte/config/sobre/dados)
// e, em cada superfície, varre TAMANHOS DE TELA travando os invariantes de GEOMETRIA (camada que
// máquina pega sozinha — o "scroll fantasma" do feltro era desta família):
//   ✗ a página rola de lado (documentElement.scrollWidth > viewport)
//   ✗ elemento visível vaza a viewport na horizontal FORA de área rolável
//   ✗ alvo interativo com lado útil < 40px (a régua M3 da casa é 48; 40 = tolerância anti-flake;
//     input dentro de <label> mede o LABEL — o alvo real; arte de carta de jogo fica fora)
// Estética (desalinhado/feio/espremido) máquina NÃO pega — segue no olho + screenshot.
//
// CI (default): 5 tamanhos SENTINELA — 344 é o preset mais estreito do device toolbar do Chrome;
// entre 344 e 430 o layout é fluido (sem breakpoint), então o estreito + os marcos cobrem o meio;
// 1280 cobre o único breakpoint real (900px desktop). FULL=1 liga os 21 presets do toolbar +
// relatório dos alvos < 48 (a auditoria profunda, sob demanda).
//
//   node server/node.mjs &
//   node tests/e2e-responsive.mjs           (CI, sentinelas)
//   FULL=1 node tests/e2e-responsive.mjs    (auditoria: 21 presets + relatório <48)
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FULL = process.env.FULL === '1';
const T = 20000;

const SENTINELA = [
  ['Z Fold 5', 344, 882], ['iPhone 12 Pro', 390, 844], ['14 Pro Max', 430, 932],
  ['12 paisagem', 844, 390], ['desktop 1280', 1280, 800],
];
const TOOLBAR = [
  ['Z Fold 5', 344, 882], ['S8+', 360, 740], ['iPhone SE', 375, 667], ['iPhone 12 Pro', 390, 844],
  ['Pixel 7', 412, 915], ['iPhone XR', 414, 896], ['14 Pro Max', 430, 932], ['Surface Duo', 540, 720],
  ['iPad Mini', 768, 1024], ['iPad Air', 820, 1180], ['Zenbook Fold', 853, 1280],
  ['Surface Pro 7', 912, 1368], ['iPad Pro', 1024, 1366], ['Nest Hub', 1024, 600], ['Nest Hub Max', 1280, 800],
  ['SE paisagem', 667, 375], ['12 paisagem', 844, 390], ['Pixel paisagem', 915, 412],
  ['desktop 1280', 1280, 800], ['desktop 1440', 1440, 900], ['desktop FHD', 1920, 1080],
];
const SIZES = FULL ? TOOLBAR : SENTINELA;

// roda DENTRO da página; devolve { issues (falham), report (só FULL, alvos < 48) }
const CHECK = () => {
  const vw = window.innerWidth;
  const issues = [], report = [];
  const de = document.documentElement;
  if (de.scrollWidth > vw + 1) issues.push(`página rola de lado (${de.scrollWidth}>${vw})`);
  const label = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    return s;
  };
  const inScroller = (el) => {
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (/(auto|scroll)/.test(s.overflowX + ' ' + s.overflowY)) return true;
    }
    return false;
  };
  const seen = new Set(), seenT = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('[hidden]') || el.closest('[aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
    if ((r.right > vw + 2 || r.left < -2) && !inScroller(el)) {
      const k = label(el);
      if (!seen.has(k)) { seen.add(k); issues.push(`${k} vaza horizontal (${Math.round(r.left)}→${Math.round(r.right)} em ${vw}px)`); }
    }
    if (!el.matches('button, a[href], [role="button"], input, select, textarea')) continue;
    if (el.closest('.dom-hand, .dom-board, .tru-hand, .tru-table')) continue; // arte de carta/pedra: fora da régua (regra da casa)
    const box = (el.closest('label') || el).getBoundingClientRect();      // input dentro de label: o LABEL é o alvo
    const side = Math.min(box.width, box.height);
    const k = label(el);
    if (seenT.has(k)) continue;
    seenT.add(k);
    if (side < 40) issues.push(`${k} alvo de toque ${Math.round(box.width)}×${Math.round(box.height)} (<40)`);
    else if (side < 48) report.push(`${k} ${Math.round(box.width)}×${Math.round(box.height)}`);
  }
  return { issues, report };
};

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const fails = [];            // { stop, size, issue }
  const reportAgg = new Map(); // alvo <48 → Set(stop)  (só FULL imprime)
  let stops = 0, checks = 0;

  const sweep = async (page, stop) => {
    stops++;
    for (const [nm, w, h] of SIZES) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(280);
      checks++;
      const { issues, report } = await page.evaluate(CHECK);
      for (const i of issues) fails.push({ stop, size: `${nm} ${w}×${h}`, issue: i });
      for (const r of report) { if (!reportAgg.has(r)) reportAgg.set(r, new Set()); reportAgg.get(r).add(stop); }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(220);
    console.log(`  ✓ ${stop} (${SIZES.length} tamanhos)`);
  };
  const esc = (page) => page.keyboard.press('Escape').then(() => page.waitForTimeout(250));

  // ---- 1º uso (boas-vindas) — contexto zerado
  {
    const c = await browser.newContext();
    await c.addInitScript(() => localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' })));
    const p = await c.newPage();
    await p.setViewportSize({ width: 390, height: 844 });
    await p.goto(BASE);
    await p.waitForSelector('#overlay-welcome:not([hidden])', { timeout: T });
    await sweep(p, 'boas-vindas (1º uso)');
    await c.close();
  }

  // ---- jornada principal — usuário de casa (sem welcome/tour; asserts em pt)
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem('botequei.name', 'Andre');
    localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 }));
    localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' }));
  });
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE);
  await page.waitForSelector('#screen-home.is-active', { timeout: T });
  await sweep(page, 'home');

  await page.click('#btn-create');
  await page.waitForSelector('#screen-table.is-active', { timeout: T });
  await page.waitForSelector('#overlay-invite:not([hidden])', { timeout: T });
  await sweep(page, 'convite (QR)');
  await esc(page);
  await sweep(page, 'mesa vazia (empty-state)');

  await page.click('#btn-empty-custom');
  await page.waitForSelector('#overlay-additem:not([hidden])', { timeout: T });
  await sweep(page, 'novo item (➕)');
  await page.fill('#add-name', 'Chopp');
  await page.fill('#add-price', '10');
  await page.click('#btn-additem-confirm');
  await page.waitForSelector('.item-card', { timeout: T });
  for (let i = 0; i < 3; i++) { await page.click('.item-card'); await page.waitForTimeout(320); }
  await sweep(page, 'mesa com consumo');

  await page.click('#btn-rodada'); await page.waitForSelector('#overlay-payround:not([hidden])', { timeout: T });
  await sweep(page, 'rodada (💸)'); await esc(page);
  await page.click('#btn-react'); await page.waitForSelector('#overlay-react:not([hidden])', { timeout: T });
  await sweep(page, 'reagir'); await esc(page);
  await page.click('#btn-peers'); await page.waitForSelector('#overlay-peers:not([hidden])', { timeout: T });
  await sweep(page, 'placar'); await esc(page);

  await page.click('#btn-games'); await page.waitForSelector('#overlay-games:not([hidden])', { timeout: T });
  await sweep(page, 'jogos (grid)');
  await page.evaluate(() => { [...document.querySelectorAll('#games-grid .game-pick')].find((b) => /Purrinha/.test(b.textContent))?.click(); });
  await page.waitForTimeout(450); await sweep(page, 'purrinha (setup)'); await esc(page);
  await page.click('#btn-games'); await page.waitForTimeout(350);
  await page.evaluate(() => { [...document.querySelectorAll('#games-grid .game-pick')].find((b) => /Truco/.test(b.textContent))?.click(); });
  await page.waitForTimeout(450); await sweep(page, 'truco (setup)'); await esc(page);
  // A moldura de tela cheia dos jogos (overlay-game) EM JOGO é geometria de partida viva — o
  // e2e-domino já a cobre (retrato/paisagem, 2p+4p). Abrir uma partida solo de truco AQUI, com
  // bots agindo por timer enquanto a viewport redimensiona 5×, deixava o job pesado/instável no
  // runner — fora do escopo da varredura estática de superfícies. Fica de sonda só o SETUP.

  await page.click('#btn-menu'); await page.waitForSelector('#overlay-menu:not([hidden])', { timeout: T });
  await sweep(page, 'menu …');
  await page.click('#menu-prices'); await page.waitForSelector('#overlay-prices:not([hidden])', { timeout: T });
  await sweep(page, 'cardápio da mesa'); await esc(page);
  await page.click('#btn-menu'); await page.waitForTimeout(300);
  await page.click('#menu-bill'); await page.waitForSelector('#overlay-bill:not([hidden])', { timeout: T });
  await sweep(page, 'fechar a conta'); await esc(page);

  // hub pessoal: na MESA a porta é o SEU rosto na barra de presença (.pres-me)
  await page.click('.pres-me'); await page.waitForSelector('#overlay-me:not([hidden])', { timeout: T });
  await sweep(page, 'hub você');
  await page.click('#me-profile'); await page.waitForSelector('#overlay-profile:not([hidden])', { timeout: T });
  await sweep(page, 'perfil'); await esc(page);
  await page.click('.pres-me'); await page.waitForTimeout(300);
  await page.click('#me-passport'); await page.waitForSelector('#overlay-passport:not([hidden])', { timeout: T });
  await sweep(page, 'passaporte'); await esc(page);
  await page.click('.pres-me'); await page.waitForTimeout(300);
  await page.click('#me-settings'); await page.waitForSelector('#overlay-settings:not([hidden])', { timeout: T });
  await sweep(page, 'configurações');
  await page.click('#btn-open-sobre'); await page.waitForSelector('#overlay-sobre:not([hidden])', { timeout: T });
  await sweep(page, 'sobre o botequei'); await esc(page);
  await page.click('.pres-me'); await page.waitForTimeout(300);
  await page.click('#me-settings'); await page.waitForTimeout(300);
  await page.click('#btn-open-data'); await page.waitForSelector('#overlay-data:not([hidden])', { timeout: T });
  await sweep(page, 'meus dados'); await esc(page);

  await browser.close();

  if (FULL && reportAgg.size) {
    console.log('\n📋 Alvos entre 40 e 48px (abaixo da régua M3 de 48 — polimento, não falha):');
    for (const [r, st] of reportAgg) console.log(`   · ${r}  [${[...st].slice(0, 3).join(', ')}${st.size > 3 ? ` +${st.size - 3}` : ''}]`);
  }
  if (fails.length) {
    console.error(`\n❌ ${fails.length} falha(s) de geometria/alvo em ${stops} superfícies × ${SIZES.length} tamanhos:`);
    const uniq = new Map();
    for (const f of fails) { const k = `${f.stop} · ${f.issue}`; if (!uniq.has(k)) uniq.set(k, []); uniq.get(k).push(f.size); }
    for (const [k, sizes] of uniq) console.error(`   ✗ ${k}  [${sizes.slice(0, 3).join(', ')}${sizes.length > 3 ? ` +${sizes.length - 3}` : ''}]`);
    process.exit(1);
  }
  console.log(`\n${stops} superfícies × ${SIZES.length} tamanhos = ${checks} medições, tudo dentro ✅`);
}

main().catch((e) => { console.error(e); process.exit(1); });
