// E2E do dominó (navegadores reais, WebRTC): joga partidas INTEIRAS de 2 E 4 jogadores. O dono
// distribui as mãos privadas (canal direto — oponente nunca vê), e todos jogam adaptativo (lêem
// as pedras que encaixam no DOM) até bater/trancar. Prova o loop P2P completo com 2 e 4 pessoas:
// deal privado + jogadas públicas + fim de jogo coerente em todos os aparelhos.
//
//   node server/node.mjs &
//   node tests/e2e-domino.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 25000;
const NAMES = ['Andre', 'Bia', 'Caio', 'Duda'];

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  const mkCtx = async (name) => {
    const c = await browser.newContext();
    await c.addInitScript((n) => { localStorage.setItem('botequei.name', n); localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 })); localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' })); }, name); // testes não são 1º uso (sem welcome/tour) e asseveram textos pt
    return c;
  };
  const vis = (page, id) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const isOver = (page) => page.evaluate(() => { const e = document.getElementById('dom-result'); return !!e && !e.hidden; });
  const turnText = (page) => page.evaluate(() => (document.getElementById('dom-turn')?.textContent || '').trim());
  const act = async (page) => {
    const tile = await page.$('.dom-htile.can:not([disabled])');
    if (tile) { await tile.click(); if (await page.$('#dom-side-pick:not([hidden])')) await page.click('#btn-dom-L'); return true; }
    const pass = await page.$('#btn-dom-pass:not([hidden])');
    if (pass) { await pass.click(); return true; }
    return false;
  };
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };
  // confere a SERPENTINA real no navegador (js/domino.js/snakeLayout, ancorada na abertura): numa
  // largura de celular a cobra VIRA A QUINA (>1 linha), pedras em ABSOLUTO e SEM vazar a largura; NÃO
  // ENCOLHE a pedra (serpenteia pra caber em tamanho cheio, sem scale); ao girar pra paisagem RE-FLUI.
  const checkSnake = async (page) => {
    await page.setViewportSize({ width: 380, height: 820 });
    // o resize dispara domRefit → snakeLayout; runner FRIO pode passar de qualquer folga fixa
    // (a 1ª falha real no CI pegou o tabuleiro no meio do re-render) — espera as PEDRAS de pé
    await page.waitForFunction(() => document.querySelectorAll('#dom-board .dom-tile').length >= 2, null, { timeout: 8000 })
      .catch(() => { throw new Error('serpentina: tabuleiro vazio (refit não repôs as pedras em 8s)'); });
    await page.waitForTimeout(200); // deixa as posições absolutas assentarem
    const port = await page.evaluate(() => {
      const board = document.getElementById('dom-board'), wrap = board.parentElement;
      const tiles = [...board.querySelectorAll('.dom-tile')];
      const padY = (el) => { const s = getComputedStyle(el); return (parseFloat(s.paddingTop) || 0) + (parseFloat(s.paddingBottom) || 0); };
      const br = board.getBoundingClientRect();
      const tr = getComputedStyle(board).transform; // fator de escala do tabuleiro (deve ser 1 = tamanho cheio)
      const scale = (!tr || tr === 'none') ? 1 : (tr.match(/matrix\(([^)]+)\)/) ? parseFloat(tr.match(/matrix\(([^)]+)\)/)[1].split(',')[0]) : 1);
      return {
        n: tiles.length,
        abs: tiles.every((t) => t.style.position === 'absolute' && t.style.left !== '' && t.style.top !== ''),
        rows: new Set(tiles.map((t) => Math.round(parseFloat(t.style.top)))).size,
        // pedra tem que viver DENTRO do tabuleiro (bounding box do snakeLayout). Mede a caixa de
        // LAYOUT (offset*, imune a transform): a pedra recém-jogada PULSA (domplace escala 1.55→1)
        // e o rect VISUAL dela estoura o tabuleiro no meio do pulso — falso vazamento (flake de
        // timing; o refit do resize re-monta o DOM e re-dispara a animação). O tabuleiro em si
        // pode passar do wrap quando honrar o T estica a corrida — aí o feltro ROLA, não é vazamento.
        overflow: tiles.filter((t) => t.offsetLeft < -2 || t.offsetLeft + t.offsetWidth > board.offsetWidth + 2)
          .map((t) => `${t.className}[${t.textContent.length}] x=${t.offsetLeft} w=${t.offsetWidth} > board=${board.offsetWidth} (style.w=${board.style.width})`),
        // o feltro é FLEX (ganha o que sobrar do overlay): rolar SÓ quando o tabuleiro realmente
        // não cabe. "Cabe mas rola" = fantasma (enfeite/animação virando conteúdo rolável).
        vscroll: wrap.scrollHeight - wrap.clientHeight,
        fits: board.offsetHeight + padY(wrap) <= wrap.clientHeight + 1,
        fitW: wrap.dataset.fitW || '',
        scale, h: br.height,
      };
    });
    if (port.n < 2) throw new Error('serpentina: tabuleiro vazio');
    if (!port.abs) throw new Error('serpentina não ativou (pedras sem posição absoluta)');
    if (port.overflow.length) throw new Error('serpentina: pedra vazou a largura do tabuleiro — ' + port.overflow.join(' · '));
    if (port.vscroll > 1 && port.fits) throw new Error(`scroll FANTASMA no feltro (cabe mas rola ${port.vscroll}px)`);
    if (port.scale < 0.99) throw new Error(`serpentina ENCOLHEU a pedra (scale ${port.scale}) — devia serpentear/rolar em tamanho cheio`);
    if (port.n >= 6 && port.rows < 2) throw new Error(`serpentina: a cobra não virou a quina (uma linha só com ${port.n} pedras num celular)`);
    await page.setViewportSize({ width: 820, height: 380 });
    // sonda DETERMINÍSTICA de que o refit rodou com os números da PAISAGEM: o domFitBoard estampa
    // a largura útil usada (dataset.fitW) — 380 de retrato → 820 de paisagem SEMPRE muda, pra
    // QUALQUER corrente. "Altura menor" era proxy furado: corrente que coube RETA (ou com as
    // mesmas bandas) no retrato fica LEGITIMAMENTE igual na paisagem — só não pode CRESCER.
    if (port.n >= 6) {
      const refit = await page.waitForFunction((old) => {
        const wrap = document.getElementById('dom-board').parentElement;
        return (wrap.dataset.fitW || '') !== old;
      }, port.fitW, { timeout: 8000 }).then(() => true).catch(() => false);
      if (!refit) throw new Error('serpentina: não re-arrumou ao girar (refit não rodou com a janela nova)');
      const lh = await page.evaluate(() => document.getElementById('dom-board').getBoundingClientRect().height);
      if (lh > port.h + 2) throw new Error(`serpentina: paisagem ficou MAIS ALTA que o retrato (${lh} > ${port.h})`);
    } else await page.waitForTimeout(300);
    const land = await page.evaluate(() => {                      // paisagem: mesmo invariante do scroll
      const board = document.getElementById('dom-board'), wrap = board.parentElement;
      const s = getComputedStyle(wrap);
      const padY = (parseFloat(s.paddingTop) || 0) + (parseFloat(s.paddingBottom) || 0);
      return {
        vscroll: wrap.scrollHeight - wrap.clientHeight, fits: board.offsetHeight + padY <= wrap.clientHeight + 1,
        dbg: `wrap sh=${wrap.scrollHeight} ch=${wrap.clientHeight} sw=${wrap.scrollWidth} cw=${wrap.clientWidth} · board=${board.style.width}×${board.style.height}`,
      };
    });
    if (land.vscroll > 1 && land.fits) throw new Error(`scroll FANTASMA no feltro em paisagem (cabe mas rola ${land.vscroll}px) — ${land.dbg}`);
  };

  async function playGame(N) {
    const ctxs = [], pages = [];
    for (let i = 0; i < N; i++) { const c = await mkCtx(NAMES[i]); ctxs.push(c); pages.push(await c.newPage()); }
    const host = pages[0];
    await host.goto(BASE);
    await host.waitForSelector('#screen-home.is-active', { timeout: T });
    await host.click('#btn-create');
    await host.waitForSelector('#screen-table.is-active', { timeout: T });
    const code = (await host.textContent('#mesa-code')).trim();
    await host.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
    for (let i = 1; i < N; i++) { await pages[i].goto(BASE + '#/join?room=' + code); await pages[i].waitForSelector('#screen-table.is-active', { timeout: T }); }
    // espera a malha ficar completa em TODOS os nós (cada um enxerga N na mesa)
    await Promise.all(pages.map((p) => p.waitForFunction((n) => document.getElementById('peer-count')?.textContent === String(n), N, { timeout: T })));

    await step(`${N}p: dominó abre em todos e o tabuleiro começa (abertura forçada)`, async () => {
      await host.click('#btn-games');
      await host.waitForFunction(() => document.querySelectorAll('#games-grid .game-pick').length >= 3, null, { timeout: T });
      await host.evaluate(() => { [...document.querySelectorAll('#games-grid .game-pick')].find((b) => /Dominó/.test(b.textContent)).click(); });
      // ≥2 humanos: o dominó começa DIRETO (sem tela de bots) — a "espera" É o handshake da mesa verificada
      // sempre mesa verificada: o handshake (lacres + corte coletivo) roda primeiro, aí o jogo abre
      await Promise.all(pages.map((p) => vis(p, 'dom-game')));
      await Promise.all(pages.map((p) => p.waitForFunction(() => document.querySelectorAll('#dom-board .dom-tile').length >= 1, null, { timeout: T })));
    });

    await step(`${N}p: mãos privadas — o host só vê a CONTAGEM dos oponentes`, async () => {
      const counts = await host.$$eval('#dom-opps .dom-ocount', (els) => els.map((e) => e.textContent));
      if (counts.length !== N - 1) throw new Error(`esperava ${N - 1} oponentes, vi ${counts.length}`);
      if (!counts.every((c) => /\d/.test(c))) throw new Error('oponente sem contagem de pedras');
    });

    await step(`${N}p: partida inteira até bater/trancar (converge em todos)`, async () => {
      let over = false;
      for (let i = 0; i < 240 && !over; i++) {
        if ((await Promise.all(pages.map(isOver))).every(Boolean)) { over = true; break; }
        let acted = false;
        for (const p of pages) { if (/Sua vez/.test(await turnText(p))) { acted = await act(p); break; } }
        await host.waitForTimeout(180);
        if (!acted) await host.waitForTimeout(120);
      }
      if (!over) { await host.waitForTimeout(800); over = (await Promise.all(pages.map(isOver))).every(Boolean); }
      if (!over) throw new Error('a partida não terminou em todos os aparelhos');
    });

    await step(`${N}p: fim coerente — mesmo motivo e exatamente um vencedor ("Você")`, async () => {
      const res = await Promise.all(pages.map((p) => p.textContent('#dom-result').then((s) => s.trim())));
      const reason = (s) => (/bateu/.test(s) ? 'batida' : (/[Tt]rancou/.test(s) ? 'trancou' : '?'));
      const reasons = res.map(reason);
      if (reasons.some((r) => r === '?') || new Set(reasons).size !== 1) throw new Error(`motivo divergente: ${JSON.stringify(res)}`);
      const winners = res.filter((s) => /Você/.test(s)).length;
      if (winners !== 1) throw new Error(`esperava exatamente 1 vencedor, vi ${winners}: ${JSON.stringify(res)}`);
    });

    await step(`${N}p: tabuleiro serpentina — pedras coladas, vira a quina no celular e re-flui ao girar`, async () => {
      await checkSnake(host); // o tabuleiro cheio (todas as pedras jogadas) segue visível sob o resultado
    });

    for (const c of ctxs) await c.close();
  }

  await playGame(2);
  await playGame(4);

  await browser.close();
  console.log(`\n${results.length} verificações do dominó (2p + 4p) passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-domino falhou:', e.message); process.exit(1); });
