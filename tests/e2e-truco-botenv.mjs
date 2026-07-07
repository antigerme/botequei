// Regressão (bug achado na varredura): no truco GAÚCHO 2v2 com bots, o ENVIDO travava a mão.
// O motor (reduceT) só fecha o fold do envido com as DUAS respostas da dupla (n===4), mas o
// maestro dos bots agendava só o 1º bot do time a responder → o 2º nunca respondia → pendBy
// ficava preso pra sempre e a mão não andava. Cenário: SOLO com 3 bots (assentos [eu, bot, bot,
// bot] → meu time {0,2}, time dos bots {1,3}); eu chamo envido e o time dos bots tem que fechar.
//
//   node server/node.mjs &
//   node tests/e2e-truco-botenv.mjs
//
// Variáveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 30000;

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem('botequei.name', 'André');
    localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 }));
    localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' }));
  });
  const A = await ctx.newPage();
  A.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };
  const vis = (id) => A.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const scoreTotal = () => A.evaluate(() => { const bs = document.querySelectorAll('#tru-score b'); return bs.length === 2 ? Number(bs[0].textContent) + Number(bs[1].textContent) : -1; });

  await A.goto(BASE);
  await A.waitForSelector('#screen-home.is-active', { timeout: T });
  await A.click('#btn-create');
  await A.waitForSelector('#screen-table.is-active', { timeout: T });
  await A.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));

  await step('gaúcha SOLO com 3 bots abre uma mão 2v2 (eu + 3 da turma) com envido na 1ª vaza', async () => {
    await A.click('#btn-games');
    await A.waitForFunction(() => !document.getElementById('overlay-games').hidden, null, { timeout: T });
    await A.evaluate(() => { [...document.querySelectorAll('#games-grid .game-pick')].find((b) => /Truco/.test(b.textContent)).click(); });
    await vis('tru-setup');
    await A.click('#tru-setup .bot-chip[data-n="3"]'); // chama 3 da turma -> 4 assentos (2v2)
    await A.click('#btn-tru-gau');
    await vis('tru-game');
    await A.waitForFunction(() => document.querySelectorAll('#tru-hand .tru-hcard').length === 3, null, { timeout: T });
    await A.waitForFunction(() => !!document.querySelector('#btn-tru-env'), null, { timeout: T });
  });

  await step('minimizar o truco (✕) mostra a pill "voltar" e reabre — antes o jogo sumia sem volta', async () => {
    await A.click('#btn-tru-close'); // ✕ = minimiza (o jogo segue rolando)
    await A.waitForFunction(() => { const p = document.getElementById('game-pill'); return p && !p.hidden && /Truco|🂠/i.test(p.textContent || ''); }, null, { timeout: T });
    await A.click('#game-pill'); // toca a pill pra voltar
    await vis('tru-game');
  });

  await step('chamo ENVIDO: o time dos bots fecha (AS DUAS respostas) e a mão NÃO trava', async () => {
    await A.click('#btn-tru-env');
    // com o bug, pendBy ficava preso: sem pontos e sem carta jogável (a mão congelava).
    // com o fix, os DOIS bots respondem, o envido fecha e o placar anda (fold +1 ou aceite +2).
    await A.waitForFunction(() => {
      const bs = document.querySelectorAll('#tru-score b');
      const total = bs.length === 2 ? Number(bs[0].textContent) + Number(bs[1].textContent) : 0;
      const canPlay = !!document.querySelector('#tru-hand .tru-hcard:not([disabled])');
      return total >= 1 || canPlay; // envido resolvido: placar mexeu OU já dá pra jogar carta
    }, null, { timeout: 20000 });
    if ((await scoreTotal()) < 1 && !(await A.$('#tru-hand .tru-hcard:not([disabled])'))) {
      throw new Error('o envido não resolveu — a mão travou (o 2º bot do time não respondeu)');
    }
  });

  await step('a mão segue jogável depois do envido (não ficou presa em pendBy)', async () => {
    // joga a mão até o fim / até o placar mexer — prova que destravou de vez
    const before = await scoreTotal();
    for (let i = 0; i < 40; i++) {
      const c = await A.$('#tru-hand .tru-hcard:not([disabled])');
      if (c) await c.click().catch(() => {});
      await A.waitForTimeout(320);
      if ((await scoreTotal()) > before) break;
    }
    if ((await scoreTotal()) <= before && before === 0) throw new Error('a mão não progrediu após o envido');
  });

  await ctx.close();
  await browser.close();
  console.log(`\n${results.length} verificações do envido 2v2 com bots passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-truco-botenv falhou:', e.message); process.exit(1); });
