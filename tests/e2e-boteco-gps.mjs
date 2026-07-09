// E2E da SUGESTÃO POR GPS (opt-in): ao criar a mesa, se você está PERTO de um boteco onde já fez
// check-in (com GPS) e que tem cardápio salvo, o CTA "📓 Carregar cardápio do {nome}" aparece
// sozinho. Semeia um check-in ANTIGO (>6h, pra NÃO valer como "fresco" — só o GPS pode sugerir)
// com coordenadas + cardápio, concede a localização e posiciona o navegador em cima do boteco.
//
//   node server/node.mjs &
//   node tests/e2e-boteco-gps.mjs
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
  const LAT = -23.55, LNG = -46.63;
  // permissão de localização JÁ concedida (opt-in) + posição em cima do Bar do Zé
  const ctx = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: LAT, longitude: LNG } });
  await ctx.addInitScript((geo) => {
    localStorage.setItem('botequei.name', 'André');
    localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 }));
    localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' }));
    // check-in ANTIGO (>6h): não conta como "fresco" → só o GPS pode sugerir. Com coords + cardápio.
    localStorage.setItem('botequei.passport', JSON.stringify([{ name: 'Bar do Zé', at: Date.now() - 10 * 3600e3, lat: geo.lat, lng: geo.lng }]));
    localStorage.setItem('botequei.botecomenu', JSON.stringify({ 'bar do ze': { name: 'Bar do Zé', at: Date.now(), defs: [
      { id: 'x-chopp', emoji: '🍺', name: 'Chopp', price: 8, cat: 'cerveja' },
      { id: 'x-porcao', emoji: '🍟', name: 'Porção', price: 30, cat: 'comida' },
    ] } }));
  }, { lat: LAT, lng: LNG });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.waitForSelector('#screen-home.is-active', { timeout: T });

  await page.click('#btn-create');
  await page.waitForSelector('#screen-table.is-active', { timeout: T });
  await page.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true))); // fecha o convite

  // o GPS (permissão já dada) detecta o Bar do Zé por perto → o CTA aparece SOZINHO
  await page.waitForFunction(() => {
    const b = document.getElementById('btn-empty-boteco');
    return b && !b.hidden && /Bar do Z/.test(b.textContent) && /\(2\)/.test(b.textContent);
  }, null, { timeout: T });
  console.log('  ✓ perto do boteco conhecido → o CTA por GPS aparece sozinho ao criar a mesa');

  // 1 toque carrega e nomeia a mesa
  await page.click('#btn-empty-boteco');
  await page.waitForFunction(() => document.querySelectorAll('.item-card').length === 2, null, { timeout: T });
  await page.waitForFunction(() => document.getElementById('table-title')?.textContent.trim() === 'Bar do Zé', null, { timeout: T });
  console.log('  ✓ carregar pelo CTA do GPS traz o cardápio e nomeia a mesa');

  await browser.close();
  console.log('\n2 verificacoes E2E (sugestão por GPS) passaram ✅');
}

main().catch((e) => { console.error('\n✗ E2E gps FALHOU:', e.message); process.exit(1); });
