// Regressão (bug do André): na purrinha, se um jogador REMOTO dá uma piscada de rede (tela apaga,
// wifi↔4G — rotineiro no boteco) ANTES de lacrar a mão, o host NÃO pode avançar pro palpite sem o
// lacre dele — senão os bots palpitam "sem ninguém ter lacrado" e as pontas divergem no resultado.
// Piscou ≠ saiu: o portão segura pela graça; só avança quando ele volta e lacra, OU quando a graça
// vence (dropout não trava o jogo). Cenário: A (host, +1 bot) + B (remoto) na clássica.
//
//   node server/node.mjs &
//   node tests/e2e-purr-blip.mjs
//
// Variáveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 25000;

const st = (p) => p.evaluate(() => window.__purrState && window.__purrState());
const poll = async (p, pred, ms, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const s = await st(p); if (s && pred(s)) return s; await p.waitForTimeout(120); }
  throw new Error('timeout esperando: ' + label);
};

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  const mkCtx = async (n) => {
    const c = await browser.newContext();
    await c.addInitScript((nm) => { localStorage.setItem('botequei.name', nm); localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 })); localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' })); }, n);
    return c;
  };
  const vis = (p, id) => p.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };

  const ctxA = await mkCtx('André'); const A = await ctxA.newPage();
  const ctxB = await mkCtx('Bia'); const B = await ctxB.newPage();
  A.on('pageerror', (e) => console.log('  [A pageerror]', e.message));

  await A.goto(BASE); await A.waitForSelector('#screen-home.is-active', { timeout: T });
  await A.click('#btn-create'); await A.waitForSelector('#screen-table.is-active', { timeout: T });
  const code = (await A.textContent('#mesa-code')).trim();
  await A.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
  await B.goto(BASE + '#/join?room=' + code); await B.waitForSelector('#screen-table.is-active', { timeout: T });
  await Promise.all([A, B].map((p) => p.waitForFunction(() => document.getElementById('peer-count')?.textContent === '2', null, { timeout: T })));

  // A abre a clássica com 1 bot -> assentos [A, B, bot]
  await A.click('#btn-games');
  await A.waitForFunction(() => document.querySelectorAll('#games-grid .game-pick').length >= 3, null, { timeout: T });
  await A.evaluate(() => { [...document.querySelectorAll('#games-grid .game-pick')].find((b) => /Purrinha/.test(b.textContent)).click(); });
  await vis(A, 'purr-setup');
  await A.click('#purr-setup .bot-chip[data-n="1"]');
  await A.click('#btn-purr-classic');
  await Promise.all([A, B].map((p) => vis(p, 'purr-pick')));
  const Bid = (await st(B)).self;

  await step('A e o bot lacram; B (remoto) ainda NÃO — o host segue no pick esperando B', async () => {
    await A.click('#purr-hands .purr-hand[data-hand="0"]'); await A.click('#btn-purr-seal');
    const s = await poll(A, (x) => x.phase === 'pick' && x.commits.length >= 2 && !x.commits.includes(Bid), T, 'A+bot lacrados e B não');
    if (s.phase !== 'pick') throw new Error('deveria seguir no pick esperando o lacre de B');
  });

  await step('B pisca (queda de rede) sem lacrar — o host NÃO avança pro palpite (piscou ≠ saiu)', async () => {
    await ctxB.close(); // piscada dura: cai a conexão de B (o host detecta o offline)
    const s = await poll(A, (x) => !x.online.some(([u, on]) => u === Bid && on), T, 'o host registrar B offline');
    // AQUI o bug aparecia: fase='guessing' com B fora sem lacrar. Com a graça, segue 'pick'.
    if (s.phase !== 'pick') throw new Error(`host avançou sem o lacre de B (fase=${s.phase}, commits=${s.commits.length})`);
    await A.waitForTimeout(3500); // ainda dentro da graça
    const s2 = await st(A);
    if (s2.phase !== 'pick') throw new Error(`host avançou durante a graça (fase=${s2.phase})`);
    if (s2.commits.includes(Bid)) throw new Error('B não lacrou — não pode constar como lacrado no host');
  });

  await step('graça vence: dropout não trava — o host segue sem B e a rodada anda pro palpite', async () => {
    await poll(A, (x) => x.phase !== 'pick', 16000, 'o host avançar depois da graça'); // watchdog re-checa o portão
    await vis(A, 'purr-guessing');
  });

  await ctxA.close();
  await browser.close();
  console.log(`\n${results.length} verificações do blip da purrinha passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-purr-blip falhou:', e.message); process.exit(1); });
