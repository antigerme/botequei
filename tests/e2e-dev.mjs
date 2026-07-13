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
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=WebRtcHideLocalIpsWithMdns'], // WebRTC real p/ o teste de rede
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
    // foto de perfil de mentira (o relatório REDIGE: só o tamanho) + chave PIX (tem que MASCARAR)
    localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt', profPhoto: 'data:image/jpeg;base64,' + 'A'.repeat(400), pixKey: 'meupix@exemplo.com', ...s }));
  });
  const p = await A.newPage();
  const vis = (id) => p.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };
  const openSettings = async () => {
    await p.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
    // hub: da HOME é o avatar do canto (#btn-me); na MESA é o seu rosto na barra (.pres-me)
    const home = await p.evaluate(() => document.getElementById('screen-home').classList.contains('is-active'));
    await p.click(home ? '#btn-me' : '.pres-me'); await vis('overlay-me');
    await p.click('#me-settings'); await vis('overlay-settings');
  };

  await p.goto(BASE);
  await p.waitForSelector('#screen-home.is-active', { timeout: T });

  await step('a seção 🐛 e o 📸 flutuante nascem ESCONDIDOS', async () => {
    await openSettings();
    const hidden = await p.evaluate(() => document.getElementById('dev-section').hidden);
    if (!hidden) throw new Error('a seção dev devia nascer escondida');
    const fabHidden = await p.evaluate(() => document.getElementById('dev-fab').hidden);
    if (!fabHidden) throw new Error('o 📸 flutuante devia nascer escondido (dev desligado)');
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

  await step('liga o switch → settings.dev = true + o 📸 flutuante aparece (e o marco no diário)', async () => {
    await p.check('#set-dev');
    await p.waitForFunction(() => JSON.parse(localStorage.getItem('botequei.settings') || '{}').dev === true, null, { timeout: T });
    await p.waitForFunction(() => (JSON.parse(localStorage.getItem('botequei.devlog') || '[]')).some((e) => e.k === 'dev'), null, { timeout: T });
    // o FAB 📸 passa a aparecer junto com o modo dev ligado
    await p.waitForFunction(() => { const f = document.getElementById('dev-fab'); return f && !f.hidden; }, null, { timeout: T });
  });

  await step('funis: criar+nomear mesa + item → eventos, ações, tela E a VISITA (B1+) no diário', async () => {
    await p.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
    await p.click('#btn-create');
    await p.waitForSelector('#screen-table.is-active', { timeout: T });
    // B1+: nomear a mesa = o bar → registra a visita (o convite abre no create; table-name-input está lá)
    await p.fill('#table-name-input', 'Boteco Teste');
    await p.dispatchEvent('#table-name-input', 'change');
    await p.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
    await p.click('#btn-empty-custom');
    await p.fill('#add-name', 'Chopp');
    await p.click('#btn-additem-confirm');
    await p.waitForFunction(() => document.querySelectorAll('.item-card').length === 1, null, { timeout: T });
    await p.click('.item-card'); // +1
    await p.waitForFunction(() => {
      const d = JSON.parse(localStorage.getItem('botequei.devlog') || '[]');
      return d.some((e) => e.k === 'mesa.entrar' && e.criei)
        && d.some((e) => e.k === 'ev' && e.tipo === 'ITEM')
        && d.some((e) => e.k === 'ev' && e.tipo === 'ADD')
        && d.some((e) => e.k === 'tela.screen' && e.id === 'table')
        // funis de UI: handler embrulhado (onTableName ao nomear) + toast + jornada de overlay (convite)
        && d.some((e) => e.k === 'acao' && e.h === 'onTableName')
        && d.some((e) => e.k === 'toast')
        && d.some((e) => e.k === 'tela.overlay')
        // B1+: nomear a mesa dispara a VISITA (auto): checkin.salvo (grava na hora) + checkin.gps (geo concedida)
        && d.some((e) => e.k === 'checkin.salvo') && d.some((e) => e.k === 'checkin.gps');
    }, null, { timeout: T });
  });

  await step('rede: 2º peer entra → malha/conexão/versão do peer (igual) caem no diário', async () => {
    const code = (await p.textContent('#mesa-code')).trim();
    const B = await browser.newContext();
    await B.addInitScript(() => { localStorage.setItem('botequei.name', 'Bia'); localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 })); localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' })); });
    const pb = await B.newPage();
    await pb.goto(BASE + '#/join?room=' + code);
    await pb.waitForSelector('#screen-table.is-active', { timeout: T });
    await p.waitForFunction(() => document.getElementById('peer-count')?.textContent === '2', null, { timeout: T });
    await p.waitForFunction(() => {
      const d = JSON.parse(localStorage.getItem('botequei.devlog') || '[]');
      return d.some((e) => e.k === 'malha') && d.some((e) => e.k === 'conexao') && d.some((e) => e.k === 'versao.peer' && e.igual === true);
    }, null, { timeout: T });
    await B.close();
  });

  await step('📸 flutuante captura a tela ATUAL em contexto — o overlay que você vê, NÃO as Configurações', async () => {
    // fecha tudo, abre um overlay REAL (o convite) na mesa e toca o FAB POR CIMA dele (z 55).
    // A regressão que o André pegou: antes o botão morava nas Configs → ir lá fechava seus overlays
    // e o snapshot pegava a tela das Configs. Agora tem que pegar o convite, e NÃO o overlay-settings.
    await p.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
    await p.click('#btn-invite');
    await p.waitForFunction(() => { const e = document.getElementById('overlay-invite'); return e && !e.hidden; }, null, { timeout: T });
    await p.click('#dev-fab');
    await p.waitForFunction(() => {
      const d = JSON.parse(localStorage.getItem('botequei.devlog') || '[]');
      const f = d.filter((e) => e.k === 'foto.tela').pop();
      return f && f.tela === 'screen-table' && /overlay-invite/.test(f.abertos || '')
        && !/overlay-settings/.test(f.abertos || '') && (f.texto || '').length > 10;
    }, null, { timeout: T });
  });

  await step('📤 relatório: completo (permissões/transporte/eventos), foto REDIGIDA e PIX mascarado', async () => {
    await openSettings(); // o 📸 agora é o FAB (não mais nas Configs) → reabre as Configs pro 📤
    await p.click('#btn-dev-report');
    await p.waitForFunction(() => !!window.__devReport, null, { timeout: T });
    const rep = await p.evaluate(() => window.__devReport);
    if (rep.tipo !== 'botequei-relatorio') throw new Error('tipo errado: ' + rep.tipo);
    if (rep.permissoes.localizacao !== 'granted') throw new Error('permissão de localização devia sair "granted", veio: ' + rep.permissoes.localizacao);
    if (!rep.checkins.length || rep.checkins[0].name !== 'Boteco Teste') throw new Error('a visita (nomear a mesa) devia estar no relatório');
    if (!Array.isArray(rep.diario) || !rep.diario.some((e) => e.k === 'checkin.salvo')) throw new Error('o diário devia vir dentro do relatório');
    if (!rep.settings.dev) throw new Error('settings devia mostrar dev ligado');
    if (String(rep.settings.profPhoto).startsWith('data:')) throw new Error('a FOTO vazou no relatório — tinha que ser só o tamanho');
    if (!/foto: \d+ chars/.test(String(rep.settings.profPhoto))) throw new Error('a redação da foto devia dizer o tamanho, veio: ' + rep.settings.profPhoto);
    if (String(rep.settings.pixKey).includes('exemplo.com')) throw new Error('a chave PIX vazou inteira — tinha que sair mascarada');
    if (!/^meu…\(\d+\)$/.test(String(rep.settings.pixKey))) throw new Error('máscara do PIX fora do padrão: ' + rep.settings.pixKey);
    if (typeof rep.transporte !== 'string') throw new Error('transporte devia estar no relatório');
    if (!rep.mesa || rep.mesa.itens !== 1) throw new Error('a mesa aberta (1 item) devia estar no relatório');
    // v3: formato, log COMPLETO (replay), impressão digital, resumo, storage por chave, peers, SW
    if (rep.formatoV !== 3) throw new Error('formatoV devia ser 3, veio: ' + rep.formatoV);
    if (!Array.isArray(rep.logMesa) || !rep.logMesa.some((e) => e.type === 'ADD')) throw new Error('logMesa (log completo redigido) devia trazer o ADD pro replay');
    if (rep.logMesa.some((e) => e.photo)) throw new Error('o log completo NÃO pode carregar foto de PROFILE');
    if (!rep.impressaoDigital || !rep.impressaoDigital.porTipo || !rep.impressaoDigital.porTipo.ADD) throw new Error('impressaoDigital devia contar os eventos por tipo (ADD)');
    if (!rep.resumo || typeof rep.resumo.erros !== 'number' || typeof rep.resumo.linhas !== 'number') throw new Error('resumo (triagem no topo) faltando');
    if (!rep.storageChaves || !rep.storageChaves['botequei.devlog']) throw new Error('storageChaves devia listar o tamanho do diário');
    if (!Array.isArray(rep.storageCorrompido)) throw new Error('storageCorrompido devia ser uma lista (vazia = tudo ok)');
    if (!Array.isArray(rep.peers)) throw new Error('peers devia ser uma lista (com versão/conn por peer)');
    if (!rep.sw || typeof rep.sw.controlando !== 'boolean') throw new Error('sw (estado do service worker) faltando');
  });

  await step('console.error entra no diário (pista de bug de WebRTC/storage some no console)', async () => {
    await p.evaluate(() => console.error('teste-dev-console'));
    await p.waitForFunction(() => (JSON.parse(localStorage.getItem('botequei.devlog') || '[]')).some((e) => e.k === 'console' && e.n === 'error' && /teste-dev-console/.test(e.m || '')), null, { timeout: T });
  });

  await step('📋 Copiar relatório: expõe o relatório v3 (o 3º caminho, colar direto na conversa)', async () => {
    await p.evaluate(() => { window.__devReport = null; });
    await p.click('#btn-dev-copy');
    await p.waitForFunction(() => window.__devReport && window.__devReport.formatoV === 3, null, { timeout: T });
  });

  await step('👁️ Ver o diário: as últimas linhas aparecem DENTRO do app (sem exportar)', async () => {
    await p.click('#btn-dev-view');
    await p.waitForFunction(() => { const e = document.getElementById('dev-log-view'); return e && !e.hidden && (e.textContent || '').length > 20; }, null, { timeout: T });
  });

  await step('watchdog: GPS que PENDURA vira "pendurada" no diário (o comedor de check-in flagrado)', async () => {
    // trava o getCurrentPosition (nunca chama callback) e liga o switch de geo → geoGet arma o
    // watchdog; sem disarm no prazo (8s+3s), a operação vira `pendurada {o:'geo:toggle'}`
    await p.evaluate(() => { navigator.geolocation.getCurrentPosition = () => {}; });
    await openSettings();
    await p.uncheck('#set-geo'); await p.check('#set-geo'); // off→on: dispara o pedido de localização
    await p.waitForFunction(() => (JSON.parse(localStorage.getItem('botequei.devlog') || '[]')).some((e) => e.k === 'pendurada' && /geo/.test(e.o || '')), null, { timeout: 15000 });
  });

  await A.close();
  await browser.close();
  console.log(`\n${results.length} verificacoes E2E (modo desenvolvedor) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E modo dev FALHOU:', e.message); process.exit(1); });
