// E2E do "hub do Você" (avatar): junta perfil/números/retrô/passaporte/configurações num lugar só.
//  1) o avatar no canto da home abre o hub;
//  2) usuário NOVO (sem histórico): Perfil/Passaporte/Config sempre aparecem; Números/Retrô ficam
//     escondidos (espelha o antigo gate do #home-extras);
//  3) dentro do hub, cada item abre o overlay certo (perfil/config/passaporte);
//  4) na MESA, tocar no SEU rosto na barra de presença abre o MESMO hub (a barra sempre mostra você);
//  5) faxina: o "…" da mesa NÃO tem mais Perfil/Números/Configurações (regra da casa: não duplica).
//
//   node server/node.mjs &
//   node tests/e2e-me.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 25000;
const SEED = () => {
  localStorage.setItem('botequei.name', 'André'); // testes não são 1º uso (sem welcome/tour) e asseveram pt
  localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 }));
  localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' }));
};

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };
  const A = await browser.newContext();
  await A.addInitScript(SEED);
  const p = await A.newPage();
  const vis = (id) => p.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const closeAll = () => p.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));

  await p.goto(BASE);
  await p.waitForSelector('#screen-home.is-active', { timeout: T });

  await step('home: o avatar no canto (#btn-me) abre o hub', async () => {
    await p.waitForSelector('#btn-me', { timeout: T });
    await p.click('#btn-me');
    await vis('overlay-me');
  });

  await step('usuário NOVO (sem histórico): Perfil/Passaporte/Config aparecem; Números/Retrô escondidos', async () => {
    const st = await p.evaluate(() => ({
      profile: !document.getElementById('me-profile').hidden,
      passport: !document.getElementById('me-passport').hidden,
      settings: !document.getElementById('me-settings').hidden,
      stats: !document.getElementById('me-stats').hidden,
      retro: !document.getElementById('me-retro').hidden,
    }));
    if (!(st.profile && st.passport && st.settings)) throw new Error('Perfil/Passaporte/Config deviam sempre aparecer: ' + JSON.stringify(st));
    if (st.stats || st.retro) throw new Error('Números/Retrô deviam ficar escondidos sem histórico: ' + JSON.stringify(st));
  });

  await step('hub → Meu perfil abre o overlay do perfil', async () => {
    await p.click('#me-profile');
    await vis('overlay-profile');
    await closeAll();
  });

  await step('hub → Configurações abre o overlay de configurações', async () => {
    await p.click('#btn-me'); await vis('overlay-me');
    await p.click('#me-settings');
    await vis('overlay-settings');
    await closeAll();
  });

  await step('hub → Passaporte abre o passaporte (sempre, mesmo sem histórico)', async () => {
    await p.click('#btn-me'); await vis('overlay-me');
    await p.click('#me-passport');
    await vis('overlay-passport');
    await closeAll();
  });

  await step('cria a mesa e o SEU rosto aparece na barra de presença (mesmo sozinho)', async () => {
    await p.click('#btn-create');
    await p.waitForSelector('#screen-table.is-active', { timeout: T });
    await closeAll(); // fecha o convite
    await p.waitForSelector('.pres-me', { timeout: T }); // a barra sempre mostra VOCÊ agora
  });

  await step('mesa: tocar no SEU rosto na barra abre o MESMO hub', async () => {
    await p.click('.pres-me');
    await vis('overlay-me');
    await closeAll();
  });

  await step('faxina: o "…" da mesa NÃO tem mais Perfil/Números/Configurações (não duplica)', async () => {
    await p.click('#btn-menu'); await vis('overlay-menu');
    const leaked = await p.evaluate(() => ['menu-profile', 'menu-stats', 'menu-settings'].filter((id) => document.getElementById(id)));
    if (leaked.length) throw new Error('features pessoais ainda vazando no menu "…": ' + leaked.join(', '));
    await closeAll();
  });

  await A.close();
  await browser.close();
  console.log(`\n${results.length} verificacoes E2E (hub do avatar) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E hub FALHOU:', e.message); process.exit(1); });
