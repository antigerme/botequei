// E2E do "polish de plataforma" (convenções de Android/iOS num PWA):
//  1) criar a mesa NÃO engole o convite: atribuir location.hash é navegação (dispara popstate)
//     e o "voltar fecha overlay" já engoliu o convite recém-aberto quando o hash era escrito
//     DEPOIS dele (o bug do convite que piscava e fechava sozinho) — o assert espera o hash
//     assentar em #/mesa e confere que o convite SEGUE aberto;
//  2) VOLTAR do sistema (Android) / swipe de voltar (iOS) fecha o overlay aberto em vez de sair —
//     testado com page.goBack() (= popstate) — e a URL da mesa SOBREVIVE ao fechamento;
//  3) iOS não dispara beforeinstallprompt → num navegador iOS o botão "📲 Instalar" aparece mesmo
//     assim (testado com User-Agent de iPhone).
//
//   node server/node.mjs &
//   node tests/e2e-plataforma.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 25000;
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

  // ---- 1) VOLTAR fecha o overlay ----
  const A = await browser.newContext();
  await A.addInitScript(SEED);
  const page = await A.newPage();
  const visible = (id) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const hidden = (id) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && e.hidden; }, id, { timeout: T });
  const onTable = () => page.evaluate(() => document.getElementById('screen-table').classList.contains('is-active'));

  await page.goto(BASE);
  await page.waitForSelector('#screen-home.is-active', { timeout: T });
  await page.click('#btn-create');
  await page.waitForSelector('#screen-table.is-active', { timeout: T });

  await step('criar a mesa: o convite abre e FICA (a URL #/mesa não o engole via popstate)', async () => {
    // o fechamento-fantasma acontecia no MESMO task da escrita do hash — então "hash já é
    // #/mesa E convite aberto" é assert determinístico de que ele sobreviveu
    await page.waitForFunction(() => /#\/mesa\?room=/.test(location.hash) && !document.getElementById('overlay-invite').hidden, null, { timeout: T });
  });

  await step('voltar com o convite aberto: fecha SÓ o convite; mesa e URL #/mesa continuam', async () => {
    await page.goBack();
    await hidden('overlay-invite');
    if (!(await onTable())) throw new Error('voltar saiu da mesa em vez de fechar o convite');
    const h = await page.evaluate(() => location.hash);
    if (!/#\/mesa\?room=/.test(h)) throw new Error('fechar o convite regrediu a URL da mesa: ' + h);
  });

  await step('menu "…": voltar do sistema fecha o overlay (sem sair da mesa)', async () => {
    await page.click('#btn-menu');
    await visible('overlay-menu');
    await page.goBack(); // = botão voltar (Android) / swipe de voltar (iOS)
    await hidden('overlay-menu');
    if (!(await onTable())) throw new Error('voltar saiu da mesa em vez de fechar o overlay');
  });

  await step('placar: mesmo com outro overlay, voltar fecha e a mesa continua', async () => {
    await page.click('#btn-peers');
    await visible('overlay-peers');
    await page.goBack();
    await hidden('overlay-peers');
    if (!(await onTable())) throw new Error('voltar saiu da mesa');
  });

  await step('overlays EMPILHADOS: recorte sobre o perfil — voltar fecha SÓ o recorte (o perfil fica)', async () => {
    // O bug do André: recortar a foto sobre o perfil e apertar VOLTAR fechava TUDO (a pilha
    // inteira num marcador único) e perdia o apelido não salvo. Agora cada overlay empurra UM
    // estado; o voltar fecha só o TOPO. O recorte abre POR CIMA do perfil (não o fecha).
    await page.click('.pres-me'); // seu rosto na barra de presença → hub pessoal
    await visible('overlay-me');
    await page.click('#me-profile');
    await visible('overlay-profile');
    await page.fill('#profile-name', 'Zé Não-Salvo'); // apelido em edição, ainda não salvo
    // PNG 1×1 abre o recorte por cima do perfil (mesmo caminho da selfie/galeria)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await page.setInputFiles('#avatar-file', { name: 'selfie.png', mimeType: 'image/png', buffer: png });
    await visible('overlay-crop');
    // os DOIS abertos ao mesmo tempo = empilhou (não foi close-then-open)
    const empilhou = await page.evaluate(() => !document.getElementById('overlay-profile').hidden && !document.getElementById('overlay-crop').hidden);
    if (!empilhou) throw new Error('recorte não empilhou sobre o perfil (perfil fechou)');
    await page.goBack(); // voltar #1: fecha SÓ o recorte
    await hidden('overlay-crop');
    const perfilFicou = await page.evaluate(() => !document.getElementById('overlay-profile').hidden && document.getElementById('profile-name').value === 'Zé Não-Salvo');
    if (!perfilFicou) throw new Error('voltar fechou o perfil junto (perdeu o apelido não salvo) — regressão da pilha de overlays');
    await page.goBack(); // voltar #2: agora fecha o perfil
    await hidden('overlay-profile');
    if (!(await onTable())) throw new Error('voltar saiu da mesa em vez de fechar o perfil');
  });

  await A.close();

  // ---- 2) botão "Instalar" aparece no iOS (sem beforeinstallprompt) ----
  const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const B = await browser.newContext({ userAgent: IOS_UA });
  await B.addInitScript(SEED);
  const pageB = await B.newPage();
  await pageB.goto(BASE);
  await pageB.waitForSelector('#screen-home.is-active', { timeout: T });
  await step('iOS (sem beforeinstallprompt): o botão "📲 Instalar" aparece assim mesmo', async () => {
    await pageB.waitForFunction(() => { const b = document.getElementById('btn-install'); return b && !b.hidden; }, null, { timeout: T });
  });
  await B.close();

  await browser.close();
  console.log(`\n${results.length} verificacoes E2E (polish de plataforma) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E plataforma FALHOU:', e.message); process.exit(1); });
