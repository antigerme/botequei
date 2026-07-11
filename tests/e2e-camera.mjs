// E2E da WEBCAM do perfil (desktop). No laptop o seletor de arquivo NÃO tem câmera, então o
// perfil ganha um botão "📸 Webcam" que abre a câmera ao vivo (getUserMedia, mesmo motor do QR)
// e o quadro capturado cai no MESMO recorte. No CELULAR o botão some — lá o sheet nativo do
// "📷 Trocar foto" já traz a câmera (é o SO quem oferece câmera/galeria).
//   1) desktop: o botão "Webcam" aparece; abre a câmera ao vivo (stream com quadro real);
//   2) Capturar → fecha a câmera (DESLIGA a stream: privacidade) e abre o recorte;
//   3) Usar essa → a foto vira o avatar do perfil;
//   4) fechar pelo ✕ também desliga a stream (sem câmera zumbi);
//   5) celular (viewport estreito): o botão "Webcam" NÃO aparece.
//
//   node server/node.mjs &
//   node tests/e2e-camera.mjs
//
// Usa a câmera FALSA do Chromium (--use-fake-device-for-media-stream) pra ter stream sem hardware.
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 25000;
const SEED = () => {
  localStorage.setItem('botequei.name', 'André'); // não é 1º uso (sem welcome/tour) e asseveram pt
  localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 }));
  localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' }));
};

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'], // câmera falsa + auto-permite
  });
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };
  const A = await browser.newContext({ viewport: { width: 1280, height: 800 } }); // desktop (≥900px) → botão Webcam aparece
  await A.addInitScript(SEED);
  const p = await A.newPage();
  const vis = (id) => p.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const hid = (id) => p.waitForFunction((i) => { const e = document.getElementById(i); return e && e.hidden; }, id, { timeout: T });
  const camLive = () => p.waitForFunction(() => { const v = document.getElementById('cam-video'); return v && v.videoWidth > 0; }, null, { timeout: T });
  const camOff = () => p.evaluate(() => document.getElementById('cam-video').srcObject === null);
  const closeAll = () => p.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
  const openProfile = async () => { await p.click('#btn-me'); await vis('overlay-me'); await p.click('#me-profile'); await vis('overlay-profile'); };

  await p.goto(BASE);
  await p.waitForSelector('#screen-home.is-active', { timeout: T });

  await step('desktop: hub → perfil e o botão "📸 Webcam" APARECE', async () => {
    await openProfile();
    await p.waitForFunction(() => { const b = document.getElementById('btn-avatar-webcam'); return b && !b.hidden; }, null, { timeout: T });
  });

  await step('clicar em Webcam abre a câmera ao vivo (stream com quadro real)', async () => {
    await p.click('#btn-avatar-webcam');
    await vis('overlay-camera');
    await camLive();
  });

  await step('Capturar → fecha a câmera (DESLIGA a stream) e abre o recorte', async () => {
    await p.click('#btn-cam-shoot');
    await hid('overlay-camera');
    await vis('overlay-crop');
    if (!(await camOff())) throw new Error('a stream da câmera não foi desligada após capturar');
  });

  await step('Usar essa → a foto capturada vira o avatar do perfil', async () => {
    await p.click('#btn-crop-use');
    await hid('overlay-crop');
    await p.waitForFunction(() => !document.getElementById('profile-photo-img').hidden, null, { timeout: T });
  });

  await step('fechar a câmera pelo ✕ também desliga a stream (sem câmera zumbi)', async () => {
    await p.click('#btn-avatar-webcam'); await vis('overlay-camera'); await camLive();
    await p.click('#overlay-camera .sheet-close'); // ✕ (data-close) → closeOverlays → para a stream
    await hid('overlay-camera');
    if (!(await camOff())) throw new Error('o ✕ não desligou a stream da câmera');
  });

  await step('CELULAR (viewport estreito): o botão "Webcam" NÃO aparece (sheet nativo cobre a câmera)', async () => {
    await closeAll();
    await p.setViewportSize({ width: 390, height: 800 });
    await openProfile();
    const shown = await p.evaluate(() => !document.getElementById('btn-avatar-webcam').hidden);
    if (shown) throw new Error('o botão Webcam devia sumir no celular (lá o sheet nativo já traz a câmera)');
  });

  await A.close();
  await browser.close();
  console.log(`\n${results.length} verificacoes E2E (webcam do perfil) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E webcam FALHOU:', e.message); process.exit(1); });
