// E2E do PERFIL DO BOTECO (Fase 2 do cardápio): o passaporte vira ficha de cada lugar. Semeia
// (localStorage) um check-in + histórico + cardápio salvo do "Bar do Zé" e dirige a UI:
//   passaporte mostra o selo 📓 → toca no lugar → ficha com visitas/gasto/favorita/cardápio →
//   "carregar numa mesa nova" abre mesa NOMEADA com os itens, que sincronizam pro 2º peer.
//
//   node server/node.mjs &
//   node tests/e2e-boteco-perfil.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 25000;

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  const mkCtx = async (name, seed) => {
    const c = await browser.newContext();
    await c.addInitScript((a) => {
      localStorage.setItem('botequei.name', a.n);
      localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 }));
      localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' }));
      if (a.seed) {
        const now = Date.now();
        localStorage.setItem('botequei.passport', JSON.stringify([{ name: 'Bar do Zé', at: now, lat: -23.5, lng: -46.6 }]));
        localStorage.setItem('botequei.history', JSON.stringify([
          { room: 'r-old', at: now - 100000, title: 'Bar do Zé', myTotal: 7, tableTotal: 7, myMoney: 42, items: { 'x-chopp': 6, 'x-porcao': 1 }, mates: [] },
        ]));
        localStorage.setItem('botequei.botecomenu', JSON.stringify({
          'bar do ze': { name: 'Bar do Zé', at: now, defs: [
            { id: 'x-chopp', emoji: '🍺', name: 'Chopp', price: 8, cat: 'cerveja' },
            { id: 'x-porcao', emoji: '🍟', name: 'Porção', price: 32, cat: 'comida' },
          ] },
        }));
      }
    }, { n: name, seed: !!seed });
    return c;
  };
  const peers = (page, n) => page.waitForFunction((v) => document.getElementById('peer-count')?.textContent === v, String(n), { timeout: T });
  const visible = (page, id) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };

  const A = await mkCtx('Andre', true); const pageA = await A.newPage();
  await pageA.goto(BASE);
  await pageA.waitForSelector('#screen-home.is-active', { timeout: T });

  await step('passaporte: o lugar com cardápio salvo mostra o selo 📓', async () => {
    await visible(pageA, 'home-extras'); // features pessoais aparecem porque há histórico
    await pageA.click('#btn-passport');
    await visible(pageA, 'overlay-passport');
    await pageA.waitForFunction(() => {
      const row = document.querySelector('#passport-list .pass-row');
      return row && /Bar do Z/.test(row.textContent) && !!row.querySelector('.pass-menu');
    }, null, { timeout: T });
  });

  await step('toca no lugar → ficha com visitas · gasto · favorita · cardápio', async () => {
    await pageA.click('#passport-list .pass-main');
    await visible(pageA, 'overlay-boteco');
    const okFicha = await pageA.evaluate(() => {
      const title = document.getElementById('boteco-title').textContent;
      const stats = document.getElementById('boteco-stats').textContent;
      const items = [...document.querySelectorAll('#boteco-menu .comanda-row .c-name')].map((e) => e.textContent);
      return /Bar do Z/.test(title) && /check-in/.test(stats) && stats.includes('42') && /Chopp/.test(stats)
        && items.includes('Chopp') && items.includes('Porção')
        && !document.getElementById('btn-boteco-load').hidden;
    });
    if (!okFicha) throw new Error('ficha do boteco incompleta (título/stats/cardápio/botão)');
  });

  let code;
  await step('"carregar numa mesa nova" abre mesa NOMEADA com o cardápio', async () => {
    await pageA.click('#btn-boteco-load');
    await pageA.waitForSelector('#screen-table.is-active', { timeout: T });
    await pageA.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true))); // fecha o convite
    await pageA.waitForFunction(() => document.getElementById('table-title')?.textContent.trim() === 'Bar do Zé', null, { timeout: T });
    await pageA.waitForFunction(() => document.querySelectorAll('.item-card').length === 2, null, { timeout: T });
    code = (await pageA.textContent('#mesa-code')).trim();
  });

  const B = await mkCtx('Bia'); const pageB = await B.newPage();
  await pageB.goto(BASE + '#/join?room=' + code);
  await pageB.waitForSelector('#screen-table.is-active', { timeout: T });
  await step('o cardápio carregado sincroniza pro 2º peer (CRDT)', async () => {
    await Promise.all([peers(pageA, 2), peers(pageB, 2)]);
    await pageB.waitForFunction(() => document.querySelectorAll('.item-card').length === 2, null, { timeout: T });
    const names = await pageB.evaluate(() => [...document.querySelectorAll('.item-card .item-name')].map((e) => e.textContent).sort());
    if (!(names.includes('Chopp') && names.includes('Porção'))) throw new Error('itens não sincronizaram pra Bia: ' + JSON.stringify(names));
  });

  await browser.close();
  console.log(`\n${results.length} verificacoes E2E (perfil do boteco) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E perfil FALHOU:', e.message); process.exit(1); });
