// E2E da "mesa viva" (navegadores reais, WebRTC):
//   A) fechar um jogo NÃO cancela mais: ✕ minimiza (pill "voltar" na mesa), o jogo segue nos
//      outros; "Encerrar" é explícito, com confirmação e ATRIBUIÇÃO (toast diz quem encerrou);
//   B) presença com histerese: quem cai fica 💤 na barra por 45s SEM toast de "saiu";
//      só depois da graça o "👋 saiu" aparece (tela apagada não vira drama);
//   C) ausente não trava o dominó: com o dono da vez offline, a vez é PULADA sozinha (~20s)
//      e a mesa segue jogando.
//
//   node server/node.mjs &
//   node tests/e2e-mesa-viva.mjs
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
  const mkCtx = async (name) => {
    const c = await browser.newContext();
    await c.addInitScript((n) => { localStorage.setItem('botequei.name', n); localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 })); localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' })); }, name); // testes não são 1º uso (sem welcome/tour) e asseveram textos pt
    return c;
  };
  const vis = (page, id) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const hid = (page, id) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && e.hidden; }, id, { timeout: T });
  // grava TODOS os toasts numa lista (toast dura 2,4s — polling perderia janela)
  const tapToasts = (page) => page.evaluate(() => {
    window.__toasts = [];
    const t = document.getElementById('toast');
    new MutationObserver(() => { if (!t.hidden && t.textContent) window.__toasts.push(t.textContent); })
      .observe(t, { childList: true, characterData: true, subtree: true, attributes: true });
  });
  const toasts = (page) => page.evaluate(() => window.__toasts || []);
  const turnText = (page) => page.evaluate(() => (document.getElementById('dom-turn')?.textContent || '').trim());
  const act = async (page) => {
    const tile = await page.$('.dom-htile.can:not([disabled])');
    if (tile) { await tile.click(); if (await page.$('#dom-side-pick:not([hidden])')) await page.click('#btn-dom-L'); return; }
    const pass = await page.$('#btn-dom-pass:not([hidden])');
    if (pass) await pass.click();
  };
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };

  const mkTable = async (names) => {
    const ctxs = [], pages = [];
    for (const n of names) { const c = await mkCtx(n); ctxs.push(c); pages.push(await c.newPage()); }
    const host = pages[0];
    await host.goto(BASE);
    await host.waitForSelector('#screen-home.is-active', { timeout: T });
    await host.click('#btn-create');
    await host.waitForSelector('#screen-table.is-active', { timeout: T });
    const code = (await host.textContent('#mesa-code')).trim();
    await host.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
    for (let i = 1; i < pages.length; i++) {
      await pages[i].goto(BASE + '#/join?room=' + code);
      await pages[i].waitForSelector('#screen-table.is-active', { timeout: T });
    }
    await Promise.all(pages.map((p) => p.waitForFunction((n) => document.getElementById('peer-count')?.textContent === String(n), names.length, { timeout: T })));
    return { ctxs, pages, host };
  };

  // ---------- A) minimizar + pill + encerrar com atribuição ----------
  {
    const { ctxs, pages, host } = await mkTable(['Andre', 'Bia']);
    const guest = pages[1];
    await host.click('#btn-menu'); await host.click('#menu-domino');
      await host.waitForSelector('#btn-dom-go', { timeout: T }); await host.click('#btn-dom-go'); // tela de início (0 bots no multiplayer)
    await Promise.all(pages.map((p) => vis(p, 'dom-game')));
    await tapToasts(host);

    await step('✕ minimiza: overlay fecha SÓ pra mim, pill "voltar" aparece e o jogo segue no outro', async () => {
      await host.click('#btn-dom-close');
      await hid(host, 'overlay-domino');
      await vis(host, 'game-pill');
      const pill = await host.textContent('#game-pill');
      if (!/[Dd]ominó/.test(pill)) throw new Error('pill sem dominó: ' + pill);
      const guestOpen = await guest.evaluate(() => !document.getElementById('overlay-domino').hidden);
      if (!guestOpen) throw new Error('minimizar de um fechou o jogo do outro!');
    });

    await step('toque no pill traz o jogo de volta (mesma partida)', async () => {
      await host.click('#game-pill');
      await vis(host, 'dom-game');
      await host.waitForFunction(() => document.getElementById('game-pill').hidden, null, { timeout: 5000 });
    });

    await step('"Encerrar" (do convidado) pede confirmação, fecha pra todos e diz QUEM encerrou', async () => {
      await guest.click('#btn-dom-end');
      await guest.waitForFunction(() => !document.getElementById('toast').hidden, null, { timeout: 5000 });
      await guest.click('#toast'); // confirma a ação do actionToast
      await hid(guest, 'overlay-domino');
      await hid(host, 'overlay-domino');
      await host.waitForFunction(() => (window.__toasts || []).some((t) => /Bia encerrou o dominó/.test(t)), null, { timeout: 8000 });
      const pillGone = await host.evaluate(() => document.getElementById('game-pill').hidden);
      if (!pillGone) throw new Error('pill ficou aceso depois do encerramento');
    });

    for (const c of ctxs) await c.close();
  }

  // ---------- B) histerese de presença: 💤 na graça, "saiu" só depois de 45s ----------
  {
    const { ctxs, host } = await mkTable(['Andre', 'Bia', 'Caio']);
    await tapToasts(host);
    const t0 = Date.now();
    await ctxs[2].close(); // Caio "apagou a tela" (fecha o navegador)

    await step('quem caiu vira 💤 esmaecido na barra (sem sumir) e SEM toast de "saiu"', async () => {
      await host.waitForFunction(() => !!document.querySelector('.pres-av.zz'), null, { timeout: 30000 });
      const said = await toasts(host);
      if (said.some((t) => /saiu/.test(t))) throw new Error('toast de saiu ANTES da graça: ' + JSON.stringify(said));
    });

    await step('passada a graça (45s), aí sim "👋 Caio saiu"', async () => {
      await host.waitForFunction(() => (window.__toasts || []).some((t) => /saiu/.test(t)), null, { timeout: 80000 });
      const elapsed = Date.now() - t0;
      if (elapsed < 40000) throw new Error(`"saiu" veio cedo demais (${Math.round(elapsed / 1000)}s < graça)`);
      const said = await toasts(host);
      if (!said.some((t) => /Caio.*saiu|saiu/.test(t))) throw new Error('sem toast de saiu: ' + JSON.stringify(said));
    });

    for (const c of ctxs) await c.close();
  }

  // ---------- C) ausente no dominó: a vez é pulada sozinha (mesa nunca trava) ----------
  {
    const { ctxs, pages, host } = await mkTable(['Andre', 'Bia']);
    const guest = pages[1];
    await host.click('#btn-menu'); await host.click('#menu-domino');
      await host.waitForSelector('#btn-dom-go', { timeout: T }); await host.click('#btn-dom-go'); // tela de início (0 bots no multiplayer)
    await Promise.all(pages.map((p) => vis(p, 'dom-game')));
    await tapToasts(host);

    await step('com o dono da vez offline, a vez dele é PULADA (~20s) e volta pra quem ficou', async () => {
      // garante que a vez é da Bia (2p alterna: se for do Andre, ele joga uma e a vez vira dela)
      for (let i = 0; i < 20 && !/Vez de Bia/.test(await turnText(host)); i++) {
        if (/Sua vez/.test(await turnText(host))) await act(host);
        await host.waitForTimeout(250);
      }
      if (!/Vez de Bia/.test(await turnText(host))) throw new Error('não consegui deixar a vez com a Bia: ' + await turnText(host));
      void guest; // (a página dela não age — o objetivo é derrubá-la na vez dela)
      await ctxs[1].close(); // Bia some no meio da vez dela
      await host.waitForFunction(() => (window.__toasts || []).some((t) => /Pulando a vez/.test(t)), null, { timeout: 60000 });
      // 60s (não 10s): com o azar do embaralho, o host pode estar SEM pedra jogável — ele
      // auto-passa (5s), a vez volta pra Bia offline e roda MAIS um ciclo de skip (~20s)
      // antes de voltar (ou de trancar e abrir o resultado). O assert é "a mesa não trava":
      // mesa travada de verdade não resolve nem em 60s.
      await host.waitForFunction(() => /Sua vez/.test(document.getElementById('dom-turn')?.textContent || '') ||
        !document.getElementById('dom-result')?.hidden, null, { timeout: 60000 });
    });

    for (const c of ctxs) await c.close();
  }

  await browser.close();
  console.log(`\n${results.length} verificações da mesa viva passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-mesa-viva falhou:', e.message); process.exit(1); });
