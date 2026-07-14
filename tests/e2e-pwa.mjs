// E2E do PWA: os atalhos (shortcuts do manifest) fazem o que dizem + o manifest tem os campos novos.
//  1) abrir com ?nova=1 (atalho "Criar mesa") → cai direto na MESA (create disparou);
//  2) abrir com ?entrar=1 (atalho "Entrar por código") → home com o campo de CÓDIGO focado;
//     (os dois limpam o ?param da URL pra um reload não re-disparar)
//  3) o manifest carrega os campos novos: launch_handler (navigate-existing), id, 2 shortcuts,
//     screenshots (install rico).
//
//   node server/node.mjs &
//   node tests/e2e-pwa.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 20000;
const SEED = () => {
  localStorage.setItem('botequei.name', 'André');
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
  const ctx = await browser.newContext();
  await ctx.addInitScript(SEED);

  await step('atalho "Criar mesa" (?nova=1) cai direto na MESA + limpa a URL', async () => {
    const p = await ctx.newPage();
    await p.goto(BASE + '?nova=1');
    await p.waitForSelector('#screen-table.is-active', { timeout: T }); // create disparou
    const search = await p.evaluate(() => location.search);
    if (search.includes('nova')) throw new Error('o ?nova=1 devia ter sido limpo da URL: ' + search);
    await p.close();
  });

  await step('atalho "Entrar por código" (?entrar=1) foca o campo de código na home + limpa a URL', async () => {
    const p = await ctx.newPage();
    await p.goto(BASE + '?entrar=1');
    await p.waitForSelector('#screen-home.is-active', { timeout: T });
    await p.waitForFunction(() => document.activeElement && document.activeElement.id === 'input-code', null, { timeout: T });
    const search = await p.evaluate(() => location.search);
    if (search.includes('entrar')) throw new Error('o ?entrar=1 devia ter sido limpo da URL: ' + search);
    await p.close();
  });

  await step('manifest carrega os campos novos (launch_handler / id / 2 shortcuts / screenshots)', async () => {
    const p = await ctx.newPage();
    await p.goto(BASE);
    const m = await p.evaluate(async () => (await fetch('manifest.webmanifest')).json());
    if (!m.launch_handler || m.launch_handler.client_mode !== 'navigate-existing') throw new Error('launch_handler navigate-existing faltando');
    if (!m.id) throw new Error('id do manifest faltando');
    const urls = (m.shortcuts || []).map((s) => s.url).join(' ');
    if (!/nova=1/.test(urls) || !/entrar=1/.test(urls)) throw new Error('os 2 shortcuts (nova/entrar) deviam existir: ' + urls);
    if (!Array.isArray(m.screenshots) || m.screenshots.length < 2) throw new Error('screenshots (>=2) faltando no manifest');
    await p.close();
  });

  await ctx.close();
  await browser.close();
  console.log(`\n${results.length} verificacoes E2E (PWA: atalhos + manifest) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E PWA FALHOU:', e.message); process.exit(1); });
