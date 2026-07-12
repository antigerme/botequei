// E2E do modo desenvolvedor: 7 toques na versão destravam a seção 🐛 (e a flag fica),
// o switch liga o diário técnico (um check-in entra no diário) e o 📤 gera o relatório
// completo (permissões + checkins + diário; a foto de perfil NUNCA vai — só o tamanho).
//
//   node server/node.mjs &
//   node tests/e2e-dev.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 20000;

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  // geolocation CONCEDIDA: o check-in do teste resolve na hora (permissão pendente pendura
  // o getCurrentPosition em headless — esse buraco é assunto do fix do check-in, não daqui)
  const A = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: -23.56, longitude: -46.64 } });
  await A.addInitScript(() => {
    // ⚠️ addInitScript roda em CADA navegação: o seed MESCLA (não clobbera) — senão o reload
    // do teste apagaria o devUnlocked/settings.dev que o próprio app acabou de gravar
    localStorage.setItem('botequei.name', 'André');
    const f = JSON.parse(localStorage.getItem('botequei.flags') || '{}');
    localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1, ...f }));
    const s = JSON.parse(localStorage.getItem('botequei.settings') || '{}');
    // foto de perfil de mentira: o relatório tem que REDIGIR (só o tamanho, nunca o dataURL)
    localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt', profPhoto: 'data:image/jpeg;base64,' + 'A'.repeat(400), ...s }));
  });
  const p = await A.newPage();
  const vis = (id) => p.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };
  const openSettings = async () => {
    await p.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
    await p.click('#btn-me'); await vis('overlay-me');
    await p.click('#me-settings'); await vis('overlay-settings');
  };

  await p.goto(BASE);
  await p.waitForSelector('#screen-home.is-active', { timeout: T });

  await step('a seção 🐛 nasce ESCONDIDA nas configurações', async () => {
    await openSettings();
    const hidden = await p.evaluate(() => document.getElementById('dev-section').hidden);
    if (!hidden) throw new Error('a seção dev devia nascer escondida');
  });

  await step('7 toques na versão destravam a seção (à la Android, com contagem)', async () => {
    for (let i = 0; i < 7; i++) await p.click('#btn-version', { delay: 20 });
    await vis('dev-section');
  });

  await step('destravou uma vez, FICA: recarrega e a seção continua lá', async () => {
    await p.reload();
    await p.waitForSelector('#screen-home.is-active', { timeout: T });
    await openSettings();
    const hidden = await p.evaluate(() => document.getElementById('dev-section').hidden);
    if (hidden) throw new Error('a flag devUnlocked devia persistir o destrave');
  });

  await step('liga o switch → settings.dev = true (e o marco entra no diário)', async () => {
    await p.check('#set-dev');
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('botequei.settings') || '{}').dev === true, null, { timeout: T });
    await p.waitForFunction(() => (JSON.parse(localStorage.getItem('botequei.devlog') || '[]')).some((e) => e.k === 'dev'), null, { timeout: T });
  });

  await step('um check-in com o diário ligado grava toque + salvo (a trilha do caça-bug)', async () => {
    await p.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
    await p.click('#btn-home-checkin'); await vis('overlay-passport');
    await p.fill('#passport-name', 'Minha Casa');
    await p.click('#btn-passport-checkin');
    await p.waitForFunction(() => {
      const d = JSON.parse(localStorage.getItem('botequei.devlog') || '[]');
      return d.some((e) => e.k === 'checkin.toque') && d.some((e) => e.k === 'checkin.salvo' && e.gps === true);
    }, null, { timeout: T });
  });

  await step('📤 relatório: JSON completo, permissões visíveis e foto REDIGIDA (só tamanho)', async () => {
    await openSettings();
    await p.click('#btn-dev-report');
    await p.waitForFunction(() => !!window.__devReport, null, { timeout: T });
    const rep = await p.evaluate(() => window.__devReport);
    if (rep.tipo !== 'botequei-relatorio') throw new Error('tipo errado: ' + rep.tipo);
    if (rep.permissoes.localizacao !== 'granted') throw new Error('permissão de localização devia sair "granted", veio: ' + rep.permissoes.localizacao);
    if (!rep.checkins.length || rep.checkins[0].name !== 'Minha Casa') throw new Error('o check-in devia estar no relatório');
    if (!Array.isArray(rep.diario) || !rep.diario.some((e) => e.k === 'checkin.salvo')) throw new Error('o diário devia vir dentro do relatório');
    if (!rep.settings.dev) throw new Error('settings devia mostrar dev ligado');
    if (String(rep.settings.profPhoto).startsWith('data:')) throw new Error('a FOTO vazou no relatório — tinha que ser só o tamanho');
    if (!/foto: \d+ chars/.test(String(rep.settings.profPhoto))) throw new Error('a redação da foto devia dizer o tamanho, veio: ' + rep.settings.profPhoto);
  });

  await A.close();
  await browser.close();
  console.log(`\n${results.length} verificacoes E2E (modo desenvolvedor) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E modo dev FALHOU:', e.message); process.exit(1); });
