// E2E da tela "Sobre o Botequei": abre pelas ⚙️ Configurações e confere que traz a história
// (combo), a promessa P2P e o "me paga um chopp" (QR do PIX + chave). Zero rede — é só UI local.
//
//   node server/node.mjs &
//   node tests/e2e-sobre.mjs
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
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext();
  await ctx.addInitScript(SEED);
  const p = await ctx.newPage();
  const vis = (id) => p.waitForSelector('#' + id, { state: 'visible', timeout: T });

  let n = 0;
  const ok = (cond, msg) => { if (!cond) throw new Error('✗ ' + msg); console.log('  ✓ ' + msg); n++; };

  await p.goto(BASE);
  await p.waitForSelector('#screen-home.is-active', { timeout: T });

  // ⚙️ → Sobre: avatar (#btn-me) → hub → Configurações → "ℹ️ Sobre o Botequei"
  await p.click('#btn-me'); await vis('overlay-me');
  await p.click('#me-settings'); await vis('overlay-settings');
  await p.click('#btn-open-sobre'); await vis('overlay-sobre');
  ok(true, 'abre "Sobre o Botequei" pelas ⚙️ Configurações');

  // história combo + a promessa de privacidade renderizadas (data-i18n-html no idioma pt)
  const txt = await p.textContent('#overlay-sobre');
  ok(/conta que não bateu/.test(txt), 'a história (origem) aparece');
  ok(/direto entre os celulares/.test(txt), 'a promessa P2P/privacidade aparece');

  // "me paga um chopp": QR do PIX desenhou + a chave do dev + botão de copiar
  const qrKids = await p.evaluate(() => document.getElementById('sobre-pix-qr').childElementCount);
  ok(qrKids > 0, 'o QR do PIX (me paga um chopp) foi desenhado');
  const pixKey = (await p.textContent('#sobre-pixkey') || '').trim();
  ok(pixKey === 'andre@felicio.com.br', 'a chave PIX do dev aparece');
  ok(await p.$('#btn-sobre-pixcopy') !== null, 'tem o botão de copiar o código PIX');
  const ver = (await p.textContent('#sobre-version') || '').trim();
  ok(/^🍺 Botequei \d/.test(ver), 'o rodapé mostra a versão');

  await ctx.close();
  await browser.close();
  console.log(`\n${n} verificacoes E2E (Sobre o Botequei + chopp PIX) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E SOBRE FALHOU:', e.message); process.exit(1); });
