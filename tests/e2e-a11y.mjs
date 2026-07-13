// E2E de ACESSIBILIDADE & plataforma (leva M3+HIG):
//  1) Dynamic Type: com a fonte da raiz a 200%, nada estoura na horizontal (home e mesa)
//     e a barra de ações continua na tela — o texto é todo rem, então acompanha o sistema.
//  2) Toast é ANUNCIADO por leitor de tela (role=status + aria-live).
//  3) Trocar o tema pinta a PLATAFORMA: meta theme-color + color-scheme acompanham.
//  4) "Fonte grande" escala a raiz (html.bigfont) → o corpo cresce de verdade.
//  5) Alvos de toque ≥ 44px (✕ do sheet, botões da topbar) e touch-action: manipulation.
//
//   node server/node.mjs &
//   node tests/e2e-a11y.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 25000;

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };
  const C = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await C.addInitScript(() => {
    localStorage.setItem('botequei.name', 'André');
    localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 }));
    localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt', theme: 'dark' }));
    // forja document.hidden (getter mutável) p/ DIRIGIR o visibilitychange — o headless não
    // congela a aba de verdade (mesmo truque do e2e-catchup).
    let _h = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => _h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (_h ? 'hidden' : 'visible') });
    window.__setHidden = (v) => { _h = !!v; document.dispatchEvent(new Event('visibilitychange')); };
    // stub do Screen Wake Lock: grava pedidos/solturas. defineProperty é OBRIGATÓRIO —
    // navigator.wakeLock é getter do protótipo (read-only); atribuição direta falha em silêncio.
    // O SISTEMA solta o lock quando a aba some (Android/iOS): o stub ESPELHA isso — dispara o
    // 'release' do sentinel no 1º visibilitychange p/ hidden (o app NÃO solta à mão; re-adquire na volta).
    window.__wakes = [];
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: {
      request: async () => {
        window.__wakes.push('request');
        const relHandlers = [];
        const sentinel = {
          addEventListener(ev, fn) { if (ev === 'release') relHandlers.push(fn); },
          release() { window.__wakes.push('release'); relHandlers.splice(0).forEach((h) => { try { h(); } catch { /* ignore */ } }); return Promise.resolve(); },
        };
        const onHide = () => { if (document.hidden) { document.removeEventListener('visibilitychange', onHide); sentinel.release(); } };
        document.addEventListener('visibilitychange', onHide);
        return sentinel;
      },
    } });
  });
  const p = await C.newPage();
  const noHScroll = () => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const visible = (id) => p.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });

  await p.goto(BASE);
  await p.waitForSelector('#screen-home.is-active', { timeout: T });

  await step('toast tem role=status + aria-live (leitor de tela anuncia)', async () => {
    const okAttrs = await p.evaluate(() => {
      const t = document.getElementById('toast');
      return t && t.getAttribute('role') === 'status' && t.getAttribute('aria-live') === 'polite';
    });
    if (!okAttrs) throw new Error('#toast sem role=status/aria-live');
  });

  await step('Dynamic Type 200%: home sem estouro horizontal', async () => {
    await p.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await p.waitForTimeout(250);
    if (!(await noHScroll())) throw new Error('home estourou na horizontal a 200%');
  });

  await step('Dynamic Type 200%: mesa com cards + dock visíveis, sem estouro', async () => {
    await p.click('#btn-create');
    await p.waitForSelector('#screen-table.is-active', { timeout: T });
    await p.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
    // monta um item pra mesa ter card
    await p.click('#btn-empty-custom');
    await p.fill('#add-name', 'Chopp');
    // sem campo Categoria: o padrão 🍺 já deriva "cerveja" (EMOJI_CAT) no confirm
    await p.click('#btn-additem-confirm');
    await p.waitForFunction(() => document.getElementById('overlay-additem').hidden, null, { timeout: T });
    await p.waitForTimeout(250);
    if (!(await noHScroll())) throw new Error('mesa estourou na horizontal a 200%');
    const dockOk = await p.evaluate(() => {
      const r = document.getElementById('btn-rodada').getBoundingClientRect();
      return r.width > 0 && r.height >= 44; // alvo de toque digno mesmo com fonte gigante
    });
    if (!dockOk) throw new Error('dock sumiu ou ficou raso a 200%');
    await p.evaluate(() => document.querySelector('style:last-of-type')?.remove()); // volta a 100%
  });

  await step('alvos de toque ≥ 48px (fecha HIG 44pt E M3 48dp): topbar + ✕ do sheet', async () => {
    const menu = await p.evaluate(() => { const r = document.getElementById('btn-menu').getBoundingClientRect(); return Math.min(r.width, r.height); });
    if (menu < 48) throw new Error('btn-menu < 48px: ' + menu);
    await p.click('#btn-menu'); await visible('overlay-menu');
    const close = await p.evaluate(() => { const b = document.querySelector('#overlay-menu .sheet-close'); const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); });
    if (close < 48) throw new Error('sheet-close < 48px: ' + close);
    await p.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
  });

  await step('touch-action: manipulation nos alvos (sem double-tap-zoom no spam de +1)', async () => {
    const ta = await p.evaluate(() => getComputedStyle(document.getElementById('btn-rodada')).touchAction);
    if (ta !== 'manipulation') throw new Error('btn-rodada touch-action=' + ta);
  });

  await step('tela acesa na mesa (wake lock): pede ao ENTRAR; o sistema solta ao ESCONDER a aba; re-pede na volta (sem switch — keepAwake virou default invisível)', async () => {
    const req1 = await p.evaluate(() => (window.__wakes || []).filter((x) => x === 'request').length);
    if (req1 < 1) throw new Error('não pediu wake lock ao entrar na mesa');
    // esconder a aba: no Android/iOS o SO congela e SOLTA o lock (o app não solta à mão)
    await p.evaluate(() => window.__setHidden(true));
    await p.waitForFunction(() => (window.__wakes || []).includes('release'), null, { timeout: 5000 });
    // voltar: o app re-adquire no visibilitychange, sem depender de nenhum switch
    await p.evaluate(() => window.__setHidden(false));
    await p.waitForFunction((n) => (window.__wakes || []).filter((x) => x === 'request').length > n, req1, { timeout: 5000 });
  });

  await step('sheet: arrastar a alcinha pra baixo FECHA; puxãozinho volta (snap)', async () => {
    await p.click('#btn-menu'); await visible('overlay-menu');
    const g = await p.evaluate(() => { const r = document.querySelector('#overlay-menu .sheet-grab').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 12 }; });
    // puxão curto (40px): NÃO fecha, volta pro lugar
    await p.mouse.move(g.x, g.y); await p.mouse.down(); await p.mouse.move(g.x, g.y + 40, { steps: 4 }); await p.mouse.up();
    await p.waitForTimeout(400);
    const stillOpen = await p.evaluate(() => !document.getElementById('overlay-menu').hidden);
    if (!stillOpen) throw new Error('puxãozinho de 40px não deveria fechar o sheet');
    // puxão de verdade (200px): fecha (mesmo caminho do ✕/ESC/scrim)
    await p.mouse.move(g.x, g.y); await p.mouse.down(); await p.mouse.move(g.x, g.y + 200, { steps: 8 }); await p.mouse.up();
    await p.waitForFunction(() => document.getElementById('overlay-menu').hidden, null, { timeout: T });
  });

  await step('jogos NÃO têm alcinha de arrasto (✕ deles minimiza, não fecha)', async () => {
    const hasGrab = await p.evaluate(() =>
      ['overlay-domino', 'overlay-purrinha', 'overlay-truco'].some((id) => document.querySelector(`#${id} .sheet-grab`)));
    if (hasGrab) throw new Error('jogo com faixa de arrasto — puxão sem querer fecharia a partida');
  });

  await step('toggles de estado são SWITCHES (role=switch + trilho); checkbox de formulário segue checkbox', async () => {
    const sw = await p.evaluate(() => {
      const el = document.getElementById('set-sound');
      const cs = getComputedStyle(el);
      return { role: el.getAttribute('role'), w: parseFloat(cs.width), appearance: cs.appearance };
    });
    if (sw.role !== 'switch' || sw.w < 40 || sw.appearance !== 'none') throw new Error('set-sound não virou switch: ' + JSON.stringify(sw));
    const cb = await p.evaluate(() => document.getElementById('add-share').getAttribute('role'));
    if (cb === 'switch') throw new Error('add-share é escolha de formulário — devia seguir checkbox');
  });

  await step('todo input de texto visível tem RÓTULO (label associado ou aria) — trava pro futuro', async () => {
    const missing = await p.evaluate(() => {
      const out = [];
      document.querySelectorAll('input, textarea, select').forEach((el) => {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (['hidden', 'file', 'checkbox', 'radio'].includes(type)) return; // checkbox/radio vivem em label.check
        if (el.readOnly) return; // caixas de código copia-e-cola são SAÍDA, não campo
        const wrap = el.closest('label');
        const okWrap = wrap && wrap.textContent.trim().length > 0;
        const forLbl = el.id && document.querySelector(`label[for="${el.id}"]`);
        const okFor = forLbl && forLbl.textContent.trim().length > 0;
        const okAria = (el.getAttribute('aria-label') || '').trim().length > 0;
        if (!okWrap && !okFor && !okAria) out.push(el.id || el.name || el.className);
      });
      return out;
    });
    if (missing.length) throw new Error('inputs sem rótulo: ' + missing.join(', '));
  });

  await step('tema claro pinta a plataforma: meta theme-color + color-scheme acompanham', async () => {
    await p.click('.pres-me'); await visible('overlay-me'); // seu rosto na barra de presença → hub
    await p.click('#me-settings'); await visible('overlay-settings');
    await p.selectOption('#set-theme', 'light');
    await p.waitForFunction(() => document.body.classList.contains('light'), null, { timeout: T });
    const chrome = await p.evaluate(() => ({
      meta: document.querySelector('meta[name="theme-color"]').getAttribute('content'),
      scheme: document.documentElement.style.colorScheme,
    }));
    if (chrome.meta !== '#ece0c7') throw new Error('theme-color não acompanhou o claro: ' + chrome.meta);
    if (chrome.scheme !== 'light') throw new Error('color-scheme não acompanhou: ' + chrome.scheme);
  });

  await step('"Fonte grande" escala a RAIZ: tudo cresce junto (html.bigfont)', async () => {
    const before = await p.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    await p.check('#set-bigfont');
    await p.waitForFunction(() => document.documentElement.classList.contains('bigfont'), null, { timeout: T });
    const after = await p.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    if (!(after > before * 1.15)) throw new Error(`corpo não cresceu: ${before} → ${after}`);
  });

  await C.close();
  await browser.close();
  console.log(`\n${results.length} verificacoes E2E (acessibilidade M3+HIG) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E a11y FALHOU:', e.message); process.exit(1); });
