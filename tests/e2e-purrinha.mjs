// E2E da Purrinha (navegadores reais, WebRTC): os DOIS modos, honestos por commit-reveal.
//   • Rápida (2p e 4p): cada um lacra mão+palpite; abre junto; todos batem no mesmo total.
//   • Clássica (3p): lacre só da mão; palpite falado em turno (número repetido fica bloqueado);
//     quem crava se livra e sai; rodadas seguem até sobrar um — que paga. Prova eliminação,
//     rotação do starter e convergência multi-rodada sem servidor.
//
//   php -S 127.0.0.1:8000 &
//   node tests/e2e-purrinha.mjs
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
  const peersAll = (pages, n) => Promise.all(pages.map((p) => p.waitForFunction((v) => document.getElementById('peer-count')?.textContent === v, String(n), { timeout: T })));
  const vis = (page, id) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };
  // espera até o jogo chamar ALGUÉM (dentre cands) pra falar o palpite, e devolve essa página
  const prompted = async (cands) => {
    const t0 = Date.now();
    while (Date.now() - t0 < T) {
      for (const p of cands) {
        const up = await p.evaluate(() => { const b = document.getElementById('btn-purr-say'); return !!b && !b.hidden; });
        if (up) return p;
      }
      await cands[0].waitForTimeout(120);
    }
    throw new Error('ninguém foi chamado a palpitar');
  };
  const sealHand = async (p, hand) => { await p.click(`#purr-hands .purr-hand[data-hand="${hand}"]`); await p.click('#btn-purr-seal'); };
  const say = async (p, n) => { await p.click(`#purr-gpick .purr-opt[data-say="${n}"]:not([disabled])`); await p.click('#btn-purr-say'); };

  // sobe uma mesa com N pessoas e abre a purrinha no modo pedido
  async function setupTable(N, modeBtn) {
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
    await peersAll(pages, N);
    await host.click('#btn-menu'); await host.click('#menu-purrinha');
    await vis(host, 'purr-setup'); await host.click(modeBtn); // quem inicia escolhe o modo
    return { ctxs, pages, host };
  }

  // ---------- modo RÁPIDO (variante 1 rodada) ----------
  const seal = async (page, hand, guess) => {
    await page.click(`#purr-hands .purr-hand[data-hand="${hand}"]`);
    if (guess != null) await page.click(`#purr-guesses .purr-opt[data-guess="${guess}"]`);
    await page.click('#btn-purr-seal');
  };
  async function playFast(N, picks, label, extra) {
    const { ctxs, pages } = await setupTable(N, '#btn-purr-fast');
    await step(`${label} rápida: abre em todos`, async () => {
      await Promise.all(pages.map((p) => vis(p, 'purr-pick')));
    });
    await step(`${label} rápida: cada um lacra a mão + palpite`, async () => {
      await seal(pages[0], picks[0].hand, picks[0].guess);
      await vis(pages[0], 'purr-wait');
      for (let i = 1; i < N; i++) await seal(pages[i], picks[i].hand, picks[i].guess);
    });
    await step(`${label} rápida: abre junto e TODOS batem no mesmo total (${extra.total})`, async () => {
      await Promise.all(pages.map((p) => vis(p, 'purr-result')));
      const totals = await Promise.all(pages.map((p) => p.textContent('#purr-total').then((s) => s.replace(/\D+/g, ''))));
      if (new Set(totals).size !== 1) throw new Error(`total divergente: ${JSON.stringify(totals)}`);
      if (Number(totals[0]) !== extra.total) throw new Error(`total ${totals[0]} ≠ esperado ${extra.total}`);
      const rows = await pages[0].$$eval('#purr-reveals .purr-rev', (els) => els.length);
      if (rows !== N) throw new Error(`reveal mostrou ${rows} mãos, esperava ${N}`);
    });
    await step(`${label} rápida: exatamente um "Você paga"`, async () => {
      const verds = await Promise.all(pages.map((p) => p.textContent('#purr-verdict')));
      const pays = verds.filter((v) => /Você paga/.test(v)).length;
      if (pays !== 1) throw new Error(`esperava 1 "Você paga", vi ${pays}: ${JSON.stringify(verds)}`);
    });
    for (const c of ctxs) await c.close();
  }

  // ---------- modo CLÁSSICO (eliminação em rodadas; palpite em turno sem repetir) ----------
  // Os assentos seguem a foto da mesa no convite (ordem do mesh do iniciador) — então o teste
  // NÃO assume quem fala primeiro: ele segue quem o jogo CHAMA pra palpitar (prompt-driven).
  async function playClassic() {
    const { ctxs, pages } = await setupTable(3, '#btn-purr-classic');

    let winner1; // quem cravou na rodada 1 (vira espectador)
    await step('clássica 3p: todos lacram SÓ a mão (sem palpite junto)', async () => {
      await Promise.all(pages.map((p) => vis(p, 'purr-pick')));
      const guessHidden = await pages[0].$eval('#purr-guess-wrap', (e) => e.hidden);
      if (!guessHidden) throw new Error('no clássico o palpite não deveria estar na tela do lacre');
      for (const p of pages) await sealHand(p, 0); // mãos 0+0+0 (roteiro determinístico)
    });
    await step('clássica 3p: palpites em turno — número repetido fica bloqueado', async () => {
      await Promise.all(pages.map((p) => vis(p, 'purr-guessing')));
      const p1 = await prompted(pages); await say(p1, 0); // 1º a falar crava o 0
      const rest = pages.filter((p) => p !== p1);
      const p2 = await prompted(rest);
      const blocked = await p2.$('#purr-gpick .purr-opt[data-say="0"][disabled]');
      if (!blocked) throw new Error('o 0 já foi dito — deveria estar bloqueado pro 2º a falar');
      await say(p2, 1);
      const p3 = await prompted(rest.filter((p) => p !== p2));
      await say(p3, 2);
      winner1 = p1;
    });
    await step('clássica 3p: quem cravou se livrou — rodada 2 segue sem ele', async () => {
      await Promise.all(pages.map((p) => vis(p, 'purr-result')));
      const v = await winner1.textContent('#purr-verdict');
      if (!/Você cravou 0/.test(v)) throw new Error(`o 1º a falar cravou 0: "${v}"`);
      // depois da pausa, os outros dois voltam pro lacre; quem cravou vira espectador
      const others = pages.filter((p) => p !== winner1);
      await Promise.all(others.map((p) => vis(p, 'purr-pick')));
      await winner1.waitForFunction(() => /livrou/.test(document.getElementById('purr-waitsub')?.textContent || ''), null, { timeout: T });
    });
    await step('clássica 3p: rodada 2 — outro crava, o último que sobra paga', async () => {
      const others = pages.filter((p) => p !== winner1);
      for (const p of others) await sealHand(p, 0);   // mãos 0+0
      const q1 = await prompted(others); await say(q1, 0); // crava de novo
      const q2 = await prompted(others.filter((p) => p !== q1));
      const blocked = await q2.$('#purr-gpick .purr-opt[data-say="0"][disabled]');
      if (!blocked) throw new Error('o 0 já foi dito na rodada 2 — deveria estar bloqueado');
      await say(q2, 1);
      await Promise.all(pages.map((p) => vis(p, 'purr-result')));
      const verds = await Promise.all(pages.map((p) => p.textContent('#purr-verdict')));
      const pays = verds.filter((v) => /Você paga/.test(v)).length;
      if (pays !== 1) throw new Error(`esperava 1 "Você paga", vi ${pays}: ${JSON.stringify(verds)}`);
      if (!/Você paga/.test(await q2.textContent('#purr-verdict'))) throw new Error('quem paga é o último que sobrou');
      if (!/cravou 0 e se livrou/.test(await q1.textContent('#purr-verdict'))) throw new Error('o 2º vencedor vê que cravou e se livrou');
      const status = await winner1.textContent('#purr-rstatus');
      if (!/fim de jogo/.test(status)) throw new Error(`status final esperado: "${status}"`);
    });
    for (const c of ctxs) await c.close();
  }

  // ---------- modo POR PALITOS (3-2-1): cravou descarta e fala primeiro; zerou saiu; último paga ----------
  // 2 jogadores, roteiro determinístico: A (iniciador, assento 0) crava 0 três vezes seguidas.
  async function playSticks() {
    const { ctxs, pages } = await setupTable(2, '#btn-purr-sticks');
    const [A, B] = pages;
    const round = async () => {
      await sealHand(A, 0); await sealHand(B, 0);
      await Promise.all(pages.map((p) => vis(p, 'purr-guessing')));
      const q1 = await prompted(pages); await say(q1, 0);
      const q2 = pages.find((p) => p !== q1); await prompted([q2]); await say(q2, 1);
      await Promise.all(pages.map((p) => vis(p, 'purr-result')));
      return q1;
    };
    await step('3-2-1 2p: rodada 1 — cravou, descartou um palito (3→2)', async () => {
      await Promise.all(pages.map((p) => vis(p, 'purr-pick')));
      const st = await A.textContent('#purr-pstatus');
      if (!/Andre 3 · Bia 3/.test(st)) throw new Error(`estoques públicos no lacre: "${st}"`);
      const q1 = await round();
      if (q1 !== A) throw new Error('rodada 1 começa no iniciador (assento 0)');
      const v = await A.textContent('#purr-verdict');
      if (!/descartou um palito \(restam 2\)/.test(v)) throw new Error(`esperava descarte 3→2: "${v}"`);
    });
    await step('3-2-1 2p: quem cravou fala primeiro e o teto encolhe (6→5)', async () => {
      await Promise.all(pages.map((p) => vis(p, 'purr-pick')));
      await sealHand(A, 0); await sealHand(B, 0);
      await Promise.all(pages.map((p) => vis(p, 'purr-guessing')));
      const first = await prompted(pages);
      if (first !== A) throw new Error('quem cravou deveria falar primeiro na rodada seguinte');
      const has6 = await A.$('#purr-gpick .purr-opt[data-say="6"]');
      const has5 = await A.$('#purr-gpick .purr-opt[data-say="5"]');
      if (has6 || !has5) throw new Error('teto deveria ser 5 (estoques 2+3)');
      await say(A, 0);
      await prompted([B]); await say(B, 1);
      await Promise.all(pages.map((p) => vis(p, 'purr-result')));
    });
    await step('3-2-1 2p: com 1 palito a mão trava em 0–1; A zera e B (último com palitos) paga', async () => {
      await Promise.all(pages.map((p) => vis(p, 'purr-pick')));
      const blockedHand = await A.$('#purr-hands .purr-hand[data-hand="2"][disabled]');
      if (!blockedHand) throw new Error('com 1 palito, esconder 2 deveria estar bloqueado');
      await round();
      const verds = await Promise.all(pages.map((p) => p.textContent('#purr-verdict')));
      const pays = verds.filter((v) => /Você paga/.test(v)).length;
      if (pays !== 1) throw new Error(`esperava 1 "Você paga", vi ${pays}: ${JSON.stringify(verds)}`);
      if (!/Você paga/.test(verds[1])) throw new Error('B é o último com palitos — ele paga');
      if (!/zerou os palitos/.test(verds[0])) throw new Error(`A zerou e se livrou: "${verds[0]}"`);
    });
    for (const c of ctxs) await c.close();
  }

  // rápida 2p: mãos 2 e 1 -> total 3; A crava 3 (vidente), B chuta 5 e paga
  await playFast(2, [{ hand: 2, guess: 3 }, { hand: 1, guess: 5 }], '2p', { total: 3 });
  // rápida 4p: todos escondem 1 -> total 4; A/B/D cravam 4 (videntes), C chuta 0 e paga
  await playFast(4, [{ hand: 1, guess: 4 }, { hand: 1, guess: 4 }, { hand: 1, guess: 0 }, { hand: 1, guess: 4 }], '4p', { total: 4 });
  // clássica 3p: eliminação em 2 rodadas com rotação do starter e bloqueio de palpite repetido
  await playClassic();
  // 3-2-1 2p: descarte por cravada, vencedor fala primeiro, teto/mão encolhem, último com palitos paga
  await playSticks();

  await browser.close();
  console.log(`\n${results.length} verificações da purrinha (rápida 2p+4p, clássica 3p, 3-2-1 2p) passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-purrinha falhou:', e.message); process.exit(1); });
