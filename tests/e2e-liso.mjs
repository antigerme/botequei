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
    await step('padrão de fábrica: tema CLARO já no primeiro uso', async () => {
      const light = await page.evaluate(() => document.body.classList.contains('light'));
      if (!light) throw new Error('primeiro uso deveria abrir no tema claro');
    });
    await step('demo do gesto DENTRO do guia: toque no card de treino = +1, segurar = −1', async () => {
      await page.click('#welcome-demo');
      await page.waitForFunction(() => document.getElementById('welcome-demo-n').textContent === '1', null, { timeout: 5000 });
      const box = await page.evaluate(() => { const r = document.getElementById('welcome-demo').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
      await page.mouse.move(box.x, box.y); await page.mouse.down();
      await page.waitForTimeout(650); // > limiar do segurar (480ms)
      await page.mouse.up();
      await page.waitForFunction(() => document.getElementById('welcome-demo-n').textContent === '0', null, { timeout: 5000 });
    });
    await step('"Bora!" fecha a saudação e SOLTA na home (apelido/criar mesa moram lá)', async () => {
      await page.click('#btn-welcome-go');
      await page.waitForFunction(() => document.getElementById('overlay-welcome').hidden, null, { timeout: 5000 });
      const home = await page.evaluate(() => document.getElementById('screen-home').classList.contains('is-active'));
      if (!home) throw new Error('fechar o welcome deveria deixar a pessoa na HOME');
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

    await step('fim do tour: pergunta o tema (e o padrão em uso é o CLARO)', async () => {
      await vis(page, 'overlay-themepick');
      const light = await page.evaluate(() => document.body.classList.contains('light'));
      if (!light) throw new Error('antes de escolher, o tema deveria ser o claro padrão');
    });

    await step('escolhe "Escuro" → aplica na hora e fecha a pergunta', async () => {
      await page.click('#themepick-row [data-th="dark"]');
      await page.waitForFunction(() => document.getElementById('overlay-themepick').hidden, null, { timeout: 5000 });
      const dark = await page.evaluate(() => !document.body.classList.contains('light'));
      if (!dark) throw new Error('tema escuro não aplicou');
    });

    await step('reload (volta pra mesa via hash) NÃO repete o tour e o tema escolhido PERSISTE', async () => {
      await page.reload();
      await page.waitForSelector('#screen-table.is-active', { timeout: T });
      await page.waitForTimeout(1600); // > intervalo do gatilho (600ms)
      const open = await page.evaluate(() => !document.getElementById('tour').hidden);
      if (open) throw new Error('tour apareceu de novo');
      const stillDark = await page.evaluate(() => !document.body.classList.contains('light'));
      if (!stillDark) throw new Error('escolha de tema não persistiu no reload');
      const pickOpen = await page.evaluate(() => !document.getElementById('overlay-themepick').hidden);
      if (pickOpen) throw new Error('pergunta de tema apareceu de novo no reload');
    });

    await step('"🎓 Tour do Botequei": índice com 4 trilhas; a 💸 ABRE o menu de verdade na parada 2', async () => {
      await page.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
      await page.click('#btn-menu');
      await page.waitForFunction(() => !document.getElementById('overlay-menu').hidden, null, { timeout: T });
      await page.click('#menu-tour');
      await page.waitForFunction(() => !document.getElementById('overlay-tour').hidden, null, { timeout: T });
      const trails = await page.evaluate(() => document.querySelectorAll('#tour-trails [data-trail]').length);
      if (trails !== 4) throw new Error('esperava 4 trilhas no índice, vi ' + trails);
      await page.click('#tour-trails [data-trail="conta"]');
      await vis(page, 'tour');
      const dots = await page.evaluate(() => document.querySelectorAll('#tour-count .tour-dot').length);
      if (dots !== 3) throw new Error('trilha da conta devia ter 3 paradas, vi ' + dots); // 💸 Rodada (dock) + Fechar a conta + Preços (a parada do "Pagar rodada" fundiu na 💸 Rodada do dock)
      await page.click('#btn-tour-next'); // parada 2 (💸 Fechar a conta) mora DENTRO do menu → o `pre` abre o menu de verdade
      await page.waitForFunction(() => !document.getElementById('overlay-menu').hidden && !document.getElementById('tour').hidden, null, { timeout: 8000 });
      for (let i = 0; i < 2; i++) { await page.click('#btn-tour-next'); await page.waitForTimeout(400); }
      await page.waitForFunction(() => document.getElementById('tour').hidden, null, { timeout: 5000 });
      const clean = await page.evaluate(() => document.getElementById('overlay-menu').hidden && document.getElementById('overlay-themepick').hidden);
      if (!clean) throw new Error('fim da trilha deveria FECHAR o menu e não re-perguntar o tema');
    });

    await step('configurações mostram a VERSÃO (serial de zona legível) no rodapé', async () => {
      await page.click('.pres-me'); // seu rosto na barra de presença → hub pessoal
      await page.waitForFunction(() => !document.getElementById('overlay-me').hidden, null, { timeout: T });
      await page.click('#me-settings');
      await page.waitForFunction(() => !document.getElementById('overlay-settings').hidden, null, { timeout: T });
      const label = (await page.textContent('#btn-version')).trim();
      if (!/^🍺 Botequei 20\d{2}\.\d{2}\.\d{2}-\d{2}$/.test(label)) throw new Error('rodapé sem a versão no formato AAAA.MM.DD-nn: ' + label);
      await page.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
    });

    await step('trilha concluída ganha ✓ no índice (lembra no aparelho)', async () => {
      await page.click('#btn-menu');
      await page.waitForFunction(() => !document.getElementById('overlay-menu').hidden, null, { timeout: T });
      await page.click('#menu-tour');
      await page.waitForFunction(() => !document.getElementById('overlay-tour').hidden, null, { timeout: T });
      const done = await page.evaluate(() => !!document.querySelector('#tour-trails [data-trail="conta"] .trail-done'));
      if (!done) throw new Error('trilha concluída deveria mostrar o ✓');
      const basicoDone = await page.evaluate(() => !!document.querySelector('#tour-trails [data-trail="basico"] .trail-done'));
      if (!basicoDone) throw new Error('o básico (feito na 1ª mesa) também deveria ter ✓');
      await page.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
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
    // mesa nasce limpa: cria o item pelo formulário do ➕ (cat cerveja → entra na Rodada)
    await A.click('#btn-empty-custom');
    await A.fill('#add-name', 'Chopp');
    await A.selectOption('#add-cat', 'cerveja');
    await A.click('#btn-additem-confirm');
    await A.waitForFunction(() => document.getElementById('overlay-additem').hidden, null, { timeout: T });
    await B.goto(BASE + '#/join?room=' + code);
    await B.waitForSelector('#screen-table.is-active', { timeout: T });
    await Promise.all([A, B].map((p) => p.waitForFunction(() => document.getElementById('peer-count')?.textContent === '2', null, { timeout: T })));

    await step('JOGOS moram no grid "🎮 Jogos" (os 3, sem emoji dobrado) e NÃO se repetem no menu "…"', async () => {
      // Os jogos têm UMA casa: o grid do chip 🎮 (decisão de faxina do menu). A fonte única do
      // rótulo segue sendo a chave *.title — este guarda trava o "🂠 🂠 Truco" (emoji dobrado) E
      // que nenhum jogo volte a vazar pro menu (a consistência agora é "grid é a casa, menu limpo").
      const norm = (x) => x.replace(/\s+/g, '');
      await A.click('#btn-games');
      await A.waitForFunction(() => !document.getElementById('overlay-games').hidden, null, { timeout: T });
      const grid = (await A.$$eval('#games-grid .game-pick', (bs) => bs.map((b) => b.textContent))).map(norm).sort();
      await A.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
      // o grid tem EXATAMENTE os 3 jogos, cada rótulo com um único emoji (não "🂠 🂠 Truco")
      if (grid.length !== 3) throw new Error(`o grid devia ter 3 jogos, veio ${grid.length}: ${grid.join(' | ')}`);
      for (const g of grid) if (/(\p{Extended_Pictographic}|[\u{1F0A0}-\u{1F0FF}]).*(\p{Extended_Pictographic}|[\u{1F0A0}-\u{1F0FF}])/u.test(g.replace(/[A-Za-zÀ-ÿ]/g, ''))) throw new Error(`emoji dobrado no grid: ${g}`);
      // o menu "…" NÃO pode ter nenhum jogo (nem seção "Jogos"): a faxina tirou de lá
      await A.click('#btn-menu');
      const leaked = await A.evaluate(() => {
        const names = ['Purrinha', 'Dominó', 'Truco'];
        const secGames = [...document.querySelectorAll('#overlay-menu .menu-sec')].some((s) => /Jogos/i.test(s.textContent));
        const items = [...document.querySelectorAll('#overlay-menu .menu-item')].map((b) => b.textContent);
        // "Pagar uma rodada" saiu do menu → virou o 💸 Rodada do dock (não pode voltar pro "…")
        return { secGames, hits: items.filter((tx) => names.some((n) => tx.includes(n))), payround: !!document.getElementById('menu-payround') };
      });
      await A.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
      if (leaked.secGames) throw new Error('a seção "Jogos" voltou pro menu "…" (era pra morar só no grid)');
      if (leaked.hits.length) throw new Error(`jogo vazou de volta pro menu "…": ${leaked.hits.join(' | ')}`);
      if (leaked.payround) throw new Error('"Pagar uma rodada" ainda está no menu "…" (virou o 💸 Rodada do dock)');
    });

    await step('💸 Rodada NÃO marca direto: abre a ESCOLHA do item pra pagar (total segue 0)', async () => {
      await A.click('#btn-rodada'); // dock: você paga uma rodada pra mesa (era o "Pagar rodada" do menu)
      await A.waitForFunction(() => !document.getElementById('overlay-payround').hidden, null, { timeout: 5000 });
      await A.waitForTimeout(400); // ninguém escolheu ainda → total segue 0
      const tot = (await A.textContent('#table-total')).trim();
      if (tot !== '0') throw new Error('rodada marcou sem escolher! total=' + tot);
    });

    await step('escolheu chopp → +1 pra cada um online (você paga), sincronizado nos dois', async () => {
      await A.click('#payround-list .pay-btn[data-id="x-chopp"]');
      await Promise.all([A, B].map((p) => p.waitForFunction(() => document.getElementById('table-total')?.textContent.trim() === '2', null, { timeout: T })));
    });

    await step('Brinde virou reação: o chip saiu da barra e 🍻 no "Reagir" dispara o brinde de verdade', async () => {
      if (await A.evaluate(() => !!document.getElementById('btn-brinde'))) throw new Error('o chip "Brinde" deveria ter saído da barra');
      await A.click('#btn-react');
      await A.waitForFunction(() => !document.getElementById('overlay-react').hidden, null, { timeout: T });
      await A.click('#react-row button[data-e="🍻"]');
      await A.waitForFunction(() => { const b = document.getElementById('brinde'); return b && !b.hidden; }, null, { timeout: T });
    });

    await cA.close(); await cB.close();
  }

  await browser.close();
  console.log(`\n${results.length} verificações do app liso passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-liso falhou:', e.message); process.exit(1); });
