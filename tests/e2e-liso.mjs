// E2E do "app liso" (navegadores reais):
//   1) guia de boas-vindas aparece UMA vez só (flag persistente — reload não repete);
//   2) tour guiado na PRIMEIRA mesa (spotlight 4 passos, avança no toque, não volta depois);
//   3) "🍻 Rodada" explica e CONFIRMA antes de marcar (+1 pra todo mundo online).
//
//   node server/node.mjs &
//   node tests/e2e-liso.mjs
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
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };
  const vis = (page, id) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });

  // ---------- 1) welcome 1× (contexto SEM nome e SEM flags = primeiro uso de verdade) ----------
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(BASE);
    await step('1º uso: guia de boas-vindas abre sozinho', async () => {
      await vis(page, 'overlay-welcome');
    });
    await step('reload NÃO repete o guia (flag persistente)', async () => {
      await page.reload();
      await page.waitForSelector('#screen-home.is-active', { timeout: T });
      await page.waitForTimeout(700);
      const open = await page.evaluate(() => !document.getElementById('overlay-welcome').hidden);
      if (open) throw new Error('welcome apareceu de novo no reload');
    });
    await ctx.close();
  }

  // ---------- 2) tour guiado na primeira mesa ----------
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      localStorage.setItem('botequei.name', 'Novato');
      // merge (o init roda em TODA navegação — não pode apagar o tourSeen gravado pelo app)
      const f = JSON.parse(localStorage.getItem('botequei.flags') || '{}');
      if (!f.welcomeSeen) { f.welcomeSeen = 1; localStorage.setItem('botequei.flags', JSON.stringify(f)); }
    });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForSelector('#screen-home.is-active', { timeout: T });
    await page.click('#btn-create');
    await page.waitForSelector('#screen-table.is-active', { timeout: T });
    await page.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true))); // fecha o convite

    await step('tour abre sozinho na 1ª mesa (passo 1/4 com spotlight)', async () => {
      await vis(page, 'tour');
      const count = (await page.textContent('#tour-count')).trim();
      if (count !== '1/4') throw new Error('esperava 1/4, vi ' + count);
      const spot = await page.evaluate(() => { const s = document.getElementById('tour-spot').getBoundingClientRect(); return s.width > 10 && s.height > 10; });
      if (!spot) throw new Error('spotlight sem recorte');
    });

    await step('avança os 4 passos e fecha no "Bora!"', async () => {
      for (let i = 0; i < 4; i++) {
        await page.click('#btn-tour-next');
        await page.waitForTimeout(350);
      }
      const open = await page.evaluate(() => !document.getElementById('tour').hidden);
      if (open) throw new Error('tour não fechou depois do último passo');
    });

    await step('reload (volta pra mesa via hash) NÃO repete o tour', async () => {
      await page.reload();
      await page.waitForSelector('#screen-table.is-active', { timeout: T });
      await page.waitForTimeout(1600); // > intervalo do gatilho (600ms)
      const open = await page.evaluate(() => !document.getElementById('tour').hidden);
      if (open) throw new Error('tour apareceu de novo');
    });
    await ctx.close();
  }

  // ---------- 3) rodada com confirmação ----------
  {
    const mk = async (n) => {
      const c = await browser.newContext();
      await c.addInitScript((x) => { localStorage.setItem('botequei.name', x); localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 })); localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' })); }, n);
      return c;
    };
    const cA = await mk('Andre'), cB = await mk('Bia');
    const A = await cA.newPage(), B = await cB.newPage();
    await A.goto(BASE);
    await A.waitForSelector('#screen-home.is-active', { timeout: T });
    await A.click('#btn-create');
    await A.waitForSelector('#screen-table.is-active', { timeout: T });
    const code = (await A.textContent('#mesa-code')).trim();
    await A.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
    await B.goto(BASE + '#/join?room=' + code);
    await B.waitForSelector('#screen-table.is-active', { timeout: T });
    await Promise.all([A, B].map((p) => p.waitForFunction(() => document.getElementById('peer-count')?.textContent === '2', null, { timeout: T })));

    await step('tocar em "Rodada" NÃO marca direto: explica e espera o "Bora!"', async () => {
      await A.click('#btn-rodada');
      await A.waitForFunction(() => { const t = document.getElementById('toast'); return !t.hidden && /Rodada/.test(t.textContent); }, null, { timeout: 5000 });
      await A.waitForTimeout(400); // ninguém confirmou ainda → total segue 0
      const tot = (await A.textContent('#table-total')).trim();
      if (tot !== '0') throw new Error('rodada marcou sem confirmação! total=' + tot);
    });

    await step('confirmou → +1 cerveja pra cada um online, sincronizado nos dois', async () => {
      await A.click('#toast'); // "Bora!"
      await Promise.all([A, B].map((p) => p.waitForFunction(() => document.getElementById('table-total')?.textContent.trim() === '2', null, { timeout: T })));
    });

    await cA.close(); await cB.close();
  }

  await browser.close();
  console.log(`\n${results.length} verificações do app liso passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-liso falhou:', e.message); process.exit(1); });
