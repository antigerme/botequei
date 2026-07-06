// E2E do MODO SOLO com bots (a turma virtual). Um aparelho só, mesa vazia, jogando com 🤖.
// Prova que o iniciador hospeda os bots e conduz a partida pelo protocolo real (commit-reveal).
//
//   node server/node.mjs &
//   node tests/e2e-bots.mjs
//
// Variáveis: BASE (default http://127.0.0.1:8000), CHROME.

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

  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem('botequei.name', 'André');
    localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 }));
    localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' }));
  });
  const A = await ctx.newPage();
  A.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  await A.goto(BASE);
  await A.waitForSelector('#screen-home.is-active', { timeout: T });
  await A.click('#btn-create');
  await A.waitForSelector('#screen-table.is-active', { timeout: T });
  await A.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));

  // ---------- PURRINHA rápida: sozinho + 2 bots ----------
  await A.click('#btn-menu'); await A.click('#menu-purrinha');
  await A.waitForFunction(() => !document.getElementById('overlay-purrinha').hidden, null, { timeout: T });

  await step('sozinho na mesa: o setup já sugere 1 bot (pra poder jogar)', async () => {
    const n = await A.evaluate(() => document.querySelector('.bot-chip.sel')?.dataset.n);
    if (n !== '1') throw new Error('bot default no solo deveria ser 1, vi ' + n);
  });

  await step('chama 2 da turma e começa a RÁPIDA (mesa de 3: você + Zé + Bigode)', async () => {
    await A.click('.bot-chip[data-n="2"]');
    await A.click('#btn-purr-fast');
    await A.waitForFunction(() => document.getElementById('purr-pick') && !document.getElementById('purr-pick').hidden, null, { timeout: T });
  });

  await step('você sela; os bots selam E revelam sozinhos → resultado com 3 jogadores', async () => {
    await A.click('.purr-hand[data-hand="2"]');
    await A.click('.purr-opt[data-guess="3"]');
    await A.click('#btn-purr-seal');
    await A.waitForFunction(() => document.getElementById('purr-result') && !document.getElementById('purr-result').hidden, null, { timeout: 15000 });
    const rows = await A.evaluate(() => document.querySelectorAll('#purr-reveals .purr-rev').length);
    if (rows !== 3) throw new Error('esperava 3 revelações (você + 2 bots), vi ' + rows);
    // os bots aparecem com o nome do elenco (conteúdo de jogo pt-BR)
    const names = await A.evaluate(() => [...document.querySelectorAll('#purr-reveals .purr-rname')].map((x) => x.textContent));
    if (!names.some((n) => /Zé|Bigode/.test(n))) throw new Error('bots sem nome de elenco: ' + names.join(', '));
  });

  // ---------- PURRINHA clássica: bots selam a mão E palpitam em turno (falado, sem repetir) ----------
  await step('CLÁSSICA solo + 2 bots: bots selam a mão, palpitam em turno e a rodada apura', async () => {
    await A.click('#btn-purr-again');                 // "de novo" volta pra escolha de modo
    await A.waitForFunction(() => document.getElementById('purr-setup') && !document.getElementById('purr-setup').hidden, null, { timeout: T });
    await A.click('.bot-chip[data-n="2"]');
    await A.click('#btn-purr-classic');
    let gotBotGuess = false, resolved = false;
    for (let i = 0; i < 90 && !resolved; i++) {
      await A.waitForTimeout(300);
      const st = await A.evaluate(() => {
        const vis = (id) => { const e = document.getElementById(id); return e && !e.hidden; };
        return {
          pick: vis('purr-pick'),
          hands: [...document.querySelectorAll('#purr-pick .purr-hand:not([disabled])')].map((b) => b.dataset.hand),
          myTurn: vis('purr-guessing') && !document.getElementById('purr-gpick')?.hidden,
          says: [...document.querySelectorAll('#purr-gpick [data-say]:not([disabled])')].map((b) => b.dataset.say),
          botSaid: [...document.querySelectorAll('#purr-said .purr-sd:not(.me)')].length, // palpite de bot já falado
          result: vis('purr-result'),
        };
      });
      if (st.botSaid > 0) gotBotGuess = true;
      if (st.result && gotBotGuess) { resolved = true; break; } // rodada apurou com bot tendo palpitado
      if (st.pick && st.hands.length) { await A.click(`#purr-pick .purr-hand[data-hand="${st.hands[0]}"]`).catch(() => {}); await A.waitForTimeout(80); await A.click('#btn-purr-seal').catch(() => {}); }
      else if (st.myTurn && st.says.length) { await A.click(`#purr-gpick [data-say="${st.says[0]}"]`).catch(() => {}); await A.waitForTimeout(80); await A.click('#btn-purr-say').catch(() => {}); }
    }
    if (!gotBotGuess) throw new Error('nenhum bot palpitou em turno');
    if (!resolved) throw new Error('a rodada da clássica não apurou');
  });

  // fecha a purrinha
  await A.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));

  // ---------- DOMINÓ (mesa verificada): sozinho + 1 bot, partida completa + auditoria ----------
  await A.click('#btn-menu'); await A.click('#menu-domino');
  await A.waitForFunction(() => !document.getElementById('overlay-domino').hidden, null, { timeout: T });

  await step('dominó: handshake da mesa verificada FECHA com o seed do bot (host fala por ele)', async () => {
    await A.click('#dom-setup .bot-chip[data-n="1"]');
    await A.click('#btn-dom-go');
    await A.waitForFunction(() => { const g = document.getElementById('dom-game'); return g && !g.hidden; }, null, { timeout: 15000 });
    const opp = await A.evaluate(() => document.querySelector('#dom-opps .dom-opp')?.textContent || '');
    if (!/Zé|Bigode|Cida|Careca/.test(opp)) throw new Error('bot não sentou na mesa: ' + opp);
  });

  await step('dominó: a partida corre (o bot joga a vez dele) e chega ao fim', async () => {
    let over = false;
    for (let i = 0; i < 90 && !over; i++) {
      await A.waitForTimeout(350);
      const st = await A.evaluate(() => {
        const vis = (id) => { const e = document.getElementById(id); return e && !e.hidden; };
        return {
          over: vis('dom-result'),
          myTurn: document.getElementById('dom-turn')?.classList.contains('mine'),
          playable: [...document.querySelectorAll('#dom-hand .dom-htile.can')].map((b) => b.dataset.key),
          canPass: !document.getElementById('btn-dom-pass')?.hidden,
        };
      });
      if (st.over) { over = true; break; }
      if (st.myTurn && st.playable.length) { await A.click(`#dom-hand .dom-htile[data-key="${st.playable[0]}"]`).catch(() => {}); await A.waitForTimeout(120); if (await A.evaluate(() => !document.getElementById('dom-side-pick')?.hidden)) await A.click('#btn-dom-L').catch(() => {}); }
      else if (st.myTurn && st.canPass) { await A.click('#btn-dom-pass').catch(() => {}); }
    }
    if (!over) throw new Error('a partida de dominó não fechou');
  });

  await step('dominó: a auditoria da mesa verificada NÃO acusa trapaça (🔒 sem 🚫)', async () => {
    await A.waitForFunction(() => {
      const v = document.getElementById('dom-verified');
      return v && !v.hidden && !v.classList.contains('bad');
    }, null, { timeout: 15000 });
  });

  await ctx.close();
  await browser.close();
  console.log(`\n${results.length} verificações do modo solo (bots) passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-bots falhou:', e.message); process.exit(1); });
