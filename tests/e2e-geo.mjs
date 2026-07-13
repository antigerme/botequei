// E2E da localização & check-in: o atalho 📍 de check-in na home, o switch nas Configurações
// (LIGADO de fábrica) e o ciclo honesto "recusou a permissão → o switch volta pra OFF sozinho".
//
// O headless do Playwright NEGA a geolocalização por padrão (nenhuma permissão concedida no
// contexto), então o getCurrentPosition cai no erro PERMISSION_DENIED — perfeito pra exercitar o
// recusou→off de verdade, sem mock.
//
//   node server/node.mjs &
//   node tests/e2e-geo.mjs
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
    // O headless não tem diálogo de permissão (getCurrentPosition ficaria pendurado), então
    // simulamos a RECUSA do usuário: erro PERMISSION_DENIED (code 1) — é o que o geoDeny espera.
    try {
      const g = navigator.geolocation;
      const deny = (ok, err) => { if (err) err({ code: 1, message: 'denied (test)' }); };
      try { g.getCurrentPosition = deny; } catch { Object.defineProperty(g, 'getCurrentPosition', { value: deny, configurable: true }); }
    } catch { /* sem geolocation: o app já cai no caminho off */ }
  });
  const A = await ctx.newPage();
  A.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  const vis = (id) => A.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const geoChecked = () => A.evaluate(() => document.getElementById('set-geo').checked);
  const setGeoSwitch = (on) => A.evaluate((v) => { const s = document.getElementById('set-geo'); s.checked = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, on);

  await A.goto(BASE);
  await A.waitForSelector('#screen-home.is-active', { timeout: T });

  await step('B1+: a home NÃO tem check-in à mão; o passaporte é LEITURA no hub 👤 → 🗺️', async () => {
    const gone = await A.evaluate(() => !document.getElementById('btn-home-checkin'));
    if (!gone) throw new Error('o botão de check-in à mão devia ter saído da home (boteco = nome da mesa)');
    await A.click('#btn-me'); await vis('overlay-me');
    await A.click('#me-passport'); await vis('overlay-passport');
    // passaporte é só LEITURA agora: sem input de nome / botão de check-in
    const hasInput = await A.evaluate(() => !!document.getElementById('passport-name') || !!document.getElementById('btn-passport-checkin'));
    if (hasInput) throw new Error('o passaporte devia ser só leitura (sem input/botão de check-in)');
    await A.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
  });

  await step('switch de localização vem LIGADO de fábrica (Configurações)', async () => {
    await A.click('#btn-me'); await vis('overlay-me');
    await A.click('#me-settings'); await vis('overlay-settings');
    if (!(await geoChecked())) throw new Error('o switch de localização devia vir LIGADO por padrão');
  });

  await step('recusar a permissão volta o switch pra DESLIGADO sozinho (+ persiste geo:false)', async () => {
    await setGeoSwitch(false); // desliga: não pede nada
    await A.waitForFunction(() => document.getElementById('set-geo').checked === false, null, { timeout: T });
    await setGeoSwitch(true);  // religa: pede o GPS → o headless NEGA (code 1) → geoDeny volta pra off
    await A.waitForFunction(() => document.getElementById('set-geo').checked === false, null, { timeout: T });
    const saved = await A.evaluate(() => localStorage.getItem('botequei.settings') || '');
    if (!/"geo":\s*false/.test(saved)) throw new Error('settings.geo devia persistir false após a recusa: ' + saved);
  });

  await step('BUG FIX: nomear a mesa com GPS PENDURADO registra a visita NA HORA (passaporte)', async () => {
    const ctx2 = await browser.newContext();
    await ctx2.addInitScript(() => {
      localStorage.setItem('botequei.name', 'André');
      localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 }));
      localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' })); // geo LIGADO de fábrica
      try { navigator.geolocation.getCurrentPosition = () => {}; } catch { /* PENDURA: nunca chama callback */ }
    });
    const p2 = await ctx2.newPage();
    await p2.goto(BASE);
    await p2.waitForSelector('#screen-home.is-active', { timeout: T });
    await p2.click('#btn-create');
    await p2.waitForSelector('#screen-table.is-active', { timeout: T });
    // B1+: nomear a mesa = o bar (o convite abre no create; o campo table-name-input está lá) →
    // dispara a visita no passaporte via maybeAutoCheckin.
    await p2.fill('#table-name-input', 'Minha Casa');
    await p2.dispatchEvent('#table-name-input', 'change');
    // teto de 4s: o GPS aqui NUNCA volta; se a visita dependesse do callback (bug antigo), estouraria.
    // Agora GRAVA na hora (só enriquece a coordenada depois) → passa em milissegundos.
    await p2.waitForFunction(() => {
      const v = JSON.parse(localStorage.getItem('botequei.passport') || '[]');
      return v.some((c) => c.name === 'Minha Casa');
    }, null, { timeout: 4000 });
    await ctx2.close();
  });

  await ctx.close();
  await browser.close();
  console.log(`\n${results.length} verificações de localização & check-in passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-geo falhou:', e.message); process.exit(1); });
