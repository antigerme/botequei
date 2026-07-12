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

  await step('CELULAR (touch): "📸 Webcam" some e entram "📷 Câmera" (nativa) + "🖼️ Galeria"', async () => {
    // contexto TOUCH próprio (hasTouch → navigator.maxTouchPoints>0): no cel a câmera é o app NATIVO
    // via capture, não a webcam ao vivo. Antes o app confiava no "sheet nativo" do <input> sem capture,
    // mas o Android moderno manda isso direto pro Photo Picker (só galeria) — o André caiu nesse buraco.
    const M = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
    await M.addInitScript(SEED);
    const pm = await M.newPage();
    pm.on('filechooser', () => {}); // intercepta o seletor do SO (headless não abre dialog real; sem isso trava)
    await pm.goto(BASE);
    await pm.waitForSelector('#screen-home.is-active', { timeout: T });
    await pm.click('#btn-me'); await pm.waitForFunction(() => { const e = document.getElementById('overlay-me'); return e && !e.hidden; }, null, { timeout: T });
    await pm.click('#me-profile'); await pm.waitForFunction(() => { const e = document.getElementById('overlay-profile'); return e && !e.hidden; }, null, { timeout: T });
    const st = await pm.evaluate(() => ({
      webcam: !document.getElementById('btn-avatar-webcam').hidden,
      camera: !document.getElementById('btn-avatar-camera').hidden,
      gallery: !document.getElementById('btn-avatar-upload').hidden,
    }));
    if (st.webcam) throw new Error('no celular a Webcam ao vivo devia sumir (lá é a câmera nativa via capture)');
    if (!st.camera) throw new Error('no celular o botão "📷 Câmera" (captura nativa) devia APARECER — era o buraco do André');
    if (!st.gallery) throw new Error('o botão "🖼️ Galeria" devia continuar aparecendo');
    // 📷 Câmera seta capture=user (o SO abre a câmera direto); 🖼️ Galeria TIRA o capture (vira seletor de imagens)
    await pm.click('#btn-avatar-camera');
    const cap = await pm.evaluate(() => document.getElementById('avatar-file').getAttribute('capture'));
    if (cap !== 'user') throw new Error('"📷 Câmera" devia setar capture="user" no #avatar-file, veio: ' + cap);
    await pm.click('#btn-avatar-upload');
    const cap2 = await pm.evaluate(() => document.getElementById('avatar-file').getAttribute('capture'));
    if (cap2 !== null) throw new Error('"🖼️ Galeria" devia TIRAR o capture (seletor de imagens), veio: ' + cap2);
    await M.close();
  });

  await A.close();
  await browser.close();
  console.log(`\n${results.length} verificacoes E2E (webcam do perfil) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E webcam FALHOU:', e.message); process.exit(1); });
