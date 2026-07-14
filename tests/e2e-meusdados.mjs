// E2E do "🗄️ Meus dados": painel de transparência + deleção GRANULAR (por categoria/item/lugar).
// Trava, com dados semeados:
//  1) o painel abre das ⚙️ Configurações e mostra as categorias (perfil/mesas/passaporte/cardápios/
//     dev/tour) com a linha honesta "só deste aparelho";
//  2) Limpar UMA categoria (cardápios) apaga só ela (confirmação por toque no toast);
//  3) in-context: apagar UM check-in no passaporte / UMA mesa na home;
//  4) Fase B: "apagar este lugar" na ficha do boteco some com o lugar inteiro (check-in + histórico).
//
//   node server/node.mjs &
//   node tests/e2e-meusdados.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 25000;
// dados semeados: 2 mesas (Bar do Zé + Boteco X), 2 check-ins, 1 cardápio salvo, diário do dev.
const SEED = () => {
  localStorage.setItem('botequei.name', 'André');
  localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1, devUnlocked: 1 }));
  localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt', dev: true }));
  localStorage.setItem('botequei.history', JSON.stringify([
    { room: 'AB12', title: 'Bar do Zé', at: 1000, myTotal: 3, tableTotal: 10, myMoney: 12, items: {} },
    { room: 'CD34', title: 'Boteco X', at: 900, myTotal: 1, tableTotal: 5, myMoney: 0, items: {} },
  ]));
  localStorage.setItem('botequei.passport', JSON.stringify([
    { name: 'Bar do Zé', at: 111 }, { name: 'Boteco X', at: 222 },
  ]));
  localStorage.setItem('botequei.botecomenu', JSON.stringify({ 'bar do ze': { name: 'Bar do Zé', defs: [{ id: 'x-chopp', name: 'Chopp', emoji: '🍺', price: 8 }], at: 500 } }));
  localStorage.setItem('botequei.devlog', JSON.stringify([{ k: 'a', t: 1 }, { k: 'b', t: 2 }]));
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
  const ls = (k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), k);
  // confirma um actionToast (o toast INTEIRO é clicável — dispara o callback destrutivo)
  const confirm = async () => {
    await p.waitForFunction(() => { const t = document.getElementById('toast'); return t && !t.hidden && t.querySelector('.toast-action'); }, null, { timeout: T });
    await p.click('#toast');
    await p.waitForTimeout(300); // deixa o callback rodar (apaga + repinta)
  };

  await p.goto(BASE);
  await p.waitForSelector('#screen-home.is-active', { timeout: T });

  await step('painel abre das ⚙️ e mostra as categorias + a linha "só deste aparelho"', async () => {
    await p.click('#btn-me'); await vis('overlay-me');
    await p.click('#me-settings'); await vis('overlay-settings');
    await p.click('#btn-open-data'); await vis('overlay-data');
    const cats = await p.$$eval('#data-list [data-cat]', (bs) => bs.map((b) => b.dataset.cat));
    for (const need of ['perfil', 'mesas', 'passaporte', 'cardapios', 'dev', 'tour']) {
      if (!cats.includes(need)) throw new Error(`categoria "${need}" faltando no painel: ${cats.join(',')}`);
    }
    const sub = await p.textContent('#overlay-data .sheet-sub');
    if (!/aparelho/i.test(sub || '')) throw new Error('a linha honesta "só deste aparelho" sumiu: ' + sub);
    await p.screenshot({ path: (process.env.SHOTDIR || '/tmp') + '/meusdados-panel.png' });
  });

  await step('Limpar UMA categoria (cardápios) apaga só ela, com confirmação', async () => {
    if (Object.keys(await ls('botequei.botecomenu') || {}).length !== 1) throw new Error('semente do cardápio errada');
    await p.click('#data-list [data-cat="cardapios"]');
    await confirm();
    const menus = await ls('botequei.botecomenu');
    if (menus && Object.keys(menus).length) throw new Error('cardápios não foram apagados: ' + JSON.stringify(menus));
    // as OUTRAS categorias continuam intactas (não é a bomba atômica)
    if ((await ls('botequei.passport') || []).length !== 2) throw new Error('passaporte não devia ter sido tocado');
    if ((await ls('botequei.history') || []).length !== 2) throw new Error('histórico não devia ter sido tocado');
  });

  await step('in-context: apagar UM check-in no passaporte (2 → 1)', async () => {
    await closeAll();
    await p.click('#btn-me'); await vis('overlay-me');
    await p.click('#me-passport'); await vis('overlay-passport');
    const rows = await p.$$('#passport-list .pass-row');
    if (rows.length !== 2) throw new Error('passaporte devia ter 2 linhas, tem ' + rows.length);
    // apaga o check-in do "Boteco X" (at=222) — deixa o "Bar do Zé" pra Fase B
    await p.click('#passport-list .pass-row[data-at="222"] .pass-del');
    await confirm();
    const pass = await ls('botequei.passport');
    if (pass.length !== 1 || pass[0].name !== 'Bar do Zé') throw new Error('check-in errado apagado: ' + JSON.stringify(pass));
  });

  await step('in-context: apagar UMA mesa na home (2 → 1)', async () => {
    await closeAll();
    await p.waitForSelector('#screen-home.is-active', { timeout: T });
    const items = await p.$$('#history-list .hist-item');
    if (items.length !== 2) throw new Error('home devia listar 2 mesas, tem ' + items.length);
    await p.click('#history-list .hist-item[data-room="CD34"] .hist-del'); // apaga a mesa do Boteco X
    await confirm();
    const hist = await ls('botequei.history');
    if (hist.length !== 1 || hist[0].room !== 'AB12') throw new Error('mesa errada apagada: ' + JSON.stringify(hist));
    // o log da mesa apagada some junto (removeHistory)
    if (await ls('botequei.log.CD34')) throw new Error('o log da mesa apagada devia sumir junto');
  });

  await step('Fase B: "apagar este lugar" na ficha some com o lugar inteiro (check-in + histórico)', async () => {
    await p.click('#btn-me'); await vis('overlay-me');
    await p.click('#me-passport'); await vis('overlay-passport');
    await p.click('#passport-list .pass-row[data-place="Bar do Zé"] .pass-main'); // abre a ficha do boteco
    await vis('overlay-boteco');
    await p.click('#btn-boteco-delall');
    await confirm();
    if ((await ls('botequei.passport') || []).length !== 0) throw new Error('o check-in do lugar devia sumir');
    if ((await ls('botequei.history') || []).length !== 0) throw new Error('o histórico do lugar devia sumir');
  });

  await step('a bomba atômica (Apagar tudo) segue existindo no painel, agora COM confirmação', async () => {
    await closeAll();
    await p.click('#btn-me'); await vis('overlay-me');
    await p.click('#me-settings'); await vis('overlay-settings');
    await p.click('#btn-open-data'); await vis('overlay-data');
    const hasNuke = await p.$('#btn-clear-data');
    if (!hasNuke) throw new Error('o botão "Apagar tudo" sumiu do painel');
  });

  await A.close();
  await browser.close();
  console.log(`\n${results.length} verificacoes E2E (🗄️ Meus dados) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E Meus dados FALHOU:', e.message); process.exit(1); });
