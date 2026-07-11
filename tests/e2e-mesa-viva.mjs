// E2E da "mesa viva" (navegadores reais, WebRTC):
//   A) fechar um jogo NÃO cancela mais: ✕ minimiza (pill "voltar" na mesa), o jogo segue nos
//      outros; "Encerrar" é explícito, com confirmação e ATRIBUIÇÃO (toast diz quem encerrou);
//   B) presença SERENA com MEMÓRIA: quem cai vira 💤 SEM toast e ganha o RELÓGIO de há quanto
//      tempo; fechar o APP (pagehide → 'gone') sai da barra em silêncio após a graça; "👋 saiu"
//      só existe no tchau EXPLÍCITO do botão sair (tela apagada não vira drama);
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
  // raio-x quando uma espera de PRESENÇA estoura: barra + sonda __presDbg viram parte do erro
  // (flake de CI vira dado, não mistério — foi assim que a corrida do bye foi pega)
  const presDump = async (page) => {
    try {
      return await page.evaluate(() => JSON.stringify({
        bar: [...document.querySelectorAll('#presence-bar .pres-av')].map((a) => (a.getAttribute('title') || '') + (a.classList.contains('zz') ? '💤' : '')),
        dbg: window.__presDbg ? window.__presDbg() : null,
        toasts: window.__toasts || [],
      }));
    } catch { return '(sem dump)'; }
  };
  const waitPres = async (page, fn, timeout, what) => {
    try { await page.waitForFunction(fn, null, { timeout }); }
    catch { throw new Error(`${what} não aconteceu em ${timeout}ms — raio-x: ${await presDump(page)}`); }
  };
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
    return { ctxs, pages, host, code };
  };

  // ---------- A) minimizar + pill + encerrar com atribuição ----------
  {
    const { ctxs, pages, host } = await mkTable(['Andre', 'Bia']);
    const guest = pages[1];
    await host.click('#btn-games');
    await host.waitForFunction(() => document.querySelectorAll('#games-grid .game-pick').length >= 3, null, { timeout: T });
    await host.evaluate(() => { [...document.querySelectorAll('#games-grid .game-pick')].find((b) => /Dominó/.test(b.textContent)).click(); });
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

    await step('toque no rótulo do chip traz o jogo de volta (mesma partida)', async () => {
      await host.click('#game-pill .game-chip-open');
      await vis(host, 'dom-game');
      await host.waitForFunction(() => document.getElementById('game-pill').hidden, null, { timeout: 5000 });
    });

    await step('✕ vermelho na pill (do convidado) pede confirmação, fecha pra todos e diz QUEM encerrou', async () => {
      await guest.click('#btn-dom-close'); // ✕ minimiza pro convidado → a pill aparece
      await vis(guest, 'game-pill');
      await guest.click('#game-pill .game-chip-end[data-kind="dom"]'); // ✕ vermelho = encerrar pra mesa toda
      await guest.waitForFunction(() => !document.getElementById('toast').hidden, null, { timeout: 5000 });
      await guest.click('#toast'); // confirma a ação do actionToast
      await hid(host, 'overlay-domino');
      await host.waitForFunction(() => (window.__toasts || []).some((t) => /Bia encerrou o dominó/.test(t)), null, { timeout: 8000 });
      const pillGone = await host.evaluate(() => document.getElementById('game-pill').hidden);
      if (!pillGone) throw new Error('pill ficou aceso depois do encerramento');
    });

    for (const c of ctxs) await c.close();
  }

  // ---------- B) presença SERENA com MEMÓRIA: 💤 + relógio; fechar o app arruma a barra; "saiu" só no tchau ----------
  {
    const { ctxs, pages, host, code } = await mkTable(['Andre', 'Bia', 'Caio', 'Dani']);
    await tapToasts(host);

    await step('morte SEM tchau (renderer morto) vira 💤 sem NENHUM toast e segue na barra', async () => {
      // mata o renderer do Caio via CDP (Page.crash) — tela apagada/bateria/OS matando o app:
      // JS some, WebRTC cai e NÃO dispara pagehide; fechar o app dispara (caso da Dani, adiante).
      // fire-and-forget: o renderer morre no MEIO da resposta do CDP (await pendura pra sempre)
      const cdp = await ctxs[2].newCDPSession(pages[2]);
      cdp.send('Page.crash').catch(() => { /* esperado */ });
      await waitPres(host, () => !!document.querySelector('#presence-bar .pres-av.zz'), 30000, 'Caio 💤 na barra');
      await host.waitForTimeout(50000); // muito além de qualquer "graça" — 💤 não tem prazo
      const said = await toasts(host);
      if (said.some((t) => /saiu/.test(t))) throw new Error('queda de conexão virou toast de "saiu": ' + JSON.stringify(said));
      const zz = await host.evaluate(() => !!document.querySelector('#presence-bar .pres-av.zz'));
      if (!zz) throw new Error('o 💤 sumiu da barra — quem caiu deveria seguir visível, esmaecido');
    });

    await step('o 💤 ganha RELÓGIO ("1min"+): a mesa conclui sozinha quem já foi embora', async () => {
      await waitPres(host, () => /min|h/.test(document.querySelector('#presence-bar .pres-av.zz .zz-t')?.textContent || ''), 75000, 'relógio no 💤');
    });

    await step('fechar o APP (pagehide → tchau educado): sai da barra em SILÊNCIO após a graça', async () => {
      const dani = pages[3];
      // dispara o pagehide com a página ainda viva (o 'gone' sai garantido) e aí fecha de verdade
      await dani.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      await ctxs[3].close();
      // graça de 45s (reload/atualização de SW voltam antes) + folga: Dani sai SEM toast
      await waitPres(host, () => [...document.querySelectorAll('#presence-bar .pres-av')].length === 3, 75000, 'barra com 3 (Dani arrumada)');
      const said = await toasts(host);
      if (said.some((t) => /Dani saiu/.test(t))) throw new Error('fechar o app virou toast de "saiu" — devia ser silencioso');
      const zz = await host.evaluate(() => !!document.querySelector('#presence-bar .pres-av.zz'));
      if (!zz) throw new Error('a arrumação tirou a pessoa errada — Caio (💤) deveria seguir na barra');
    });

    await step('sair DE VERDADE (botão sair) → "👋 Bia saiu" toca no host NA HORA', async () => {
      const bia = pages[1];
      // pior caso REAL (e o do runner de CI): a rede morre JUNTO do sair — o teardown remoto
      // nunca chega e o pc dela ficaria "online" zumbi por ~12s (STALE_MS). O bye autoritativo
      // (receiveBye → mesh.dropUser) tem que assentar a barra SOZINHO, na hora.
      await bia.evaluate(() => { RTCPeerConnection.prototype.close = function () {}; });
      await bia.click('#btn-leave');
      await bia.waitForFunction(() => !document.getElementById('toast').hidden, null, { timeout: 5000 });
      await bia.click('#toast'); // confirma o actionToast de sair
      await waitPres(host, () => (window.__toasts || []).some((t) => /Bia saiu/.test(t)), 10000, 'toast "Bia saiu"');
      // Bia (tchau explícito) sai da barra; sobram eu + Caio (💤 com relógio)
      await waitPres(host, () => [...document.querySelectorAll('#presence-bar .pres-av')].length === 2, 8000, 'barra com 2 (eu + Caio 💤)');
    });

    await step('quem deu tchau NÃO ressuscita: alguém entra logo depois e a Bia segue fora', async () => {
      // regressão da corrida que o CI pegou: alguém ENTRANDO logo após o tchau mexe na malha
      // DENTRO da janela zumbi — sem o dropUser, o diffPresence via a Bia "online" no rabo da
      // conexão morrendo, apagava o saidBye ("voltou!") e ela ressuscitava como 💤 fantasma (1h!).
      const cEva = await mkCtx('Eva');
      ctxs.push(cEva); // fecha junto com a mesa no fim da seção
      const eva = await cEva.newPage();
      await eva.goto(BASE + '#/join?room=' + code);
      await eva.waitForSelector('#screen-table.is-active', { timeout: T });
      await waitPres(host, () => {
        const av = [...document.querySelectorAll('#presence-bar .pres-av')];
        return av.length === 3 && !av.some((a) => (a.getAttribute('title') || '').includes('Bia'));
      }, 20000, 'barra com 3 (eu + Caio 💤 + Eva, SEM Bia)');
      // atravessa a janela do stale (~12-15s), vigiando: a zumbi cai lá dentro e a Bia
      // NÃO pode reaparecer em nenhum instante (nem online, nem 💤)
      for (let i = 0; i < 16; i++) {
        await host.waitForTimeout(1000);
        const av = await host.evaluate(() => [...document.querySelectorAll('#presence-bar .pres-av')].map((a) => a.getAttribute('title') || ''));
        if (av.some((s) => s.includes('Bia'))) throw new Error(`Bia ressuscitou na barra ${i + 1}s depois do tchau — raio-x: ${await presDump(host)}`);
        if (av.length !== 3) throw new Error(`barra deveria seguir com 3 (eu + Caio 💤 + Eva): ${JSON.stringify(av)} — raio-x: ${await presDump(host)}`);
      }
    });

    for (const c of ctxs) await c.close();
  }

  // ---------- C) ausente no dominó: a vez é pulada sozinha (mesa nunca trava) ----------
  {
    const { ctxs, pages, host } = await mkTable(['Andre', 'Bia']);
    const guest = pages[1];
    await host.click('#btn-games');
    await host.waitForFunction(() => document.querySelectorAll('#games-grid .game-pick').length >= 3, null, { timeout: T });
    await host.evaluate(() => { [...document.querySelectorAll('#games-grid .game-pick')].find((b) => /Dominó/.test(b.textContent)).click(); });
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
