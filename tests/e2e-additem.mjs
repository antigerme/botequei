// E2E da tela de ADICIONAR ITEM (reforma: preview ao vivo + nome primeiro).
// Prova as regras de ouro na prática: preview que atualiza a cada tecla/toque, campo Nome
// com foco automático, categoria que segue o emoji, e sem repetir as sugestões que a pessoa
// acabou de ver no empty state.
//
//   node server/node.mjs &
//   node tests/e2e-additem.mjs
//
// Variáveis: BASE (default http://127.0.0.1:8000), CHROME.

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

  // mesa nasce vazia: o "monte o cardápio" está à mão
  await A.waitForFunction(() => !document.getElementById('menu-empty').hidden, null, { timeout: T });

  // ---------- abrir o overlay pelo EMPTY STATE (➕ Criar outro item) ----------
  await step('do empty state: as sugestões NÃO se repetem e o Nome já vem focado', async () => {
    await A.click('#btn-empty-custom');
    await A.waitForFunction(() => !document.getElementById('overlay-additem').hidden, null, { timeout: T });
    // sem loop: a pessoa acabou de ver os chips do catálogo no empty → a seção some
    const suggestHidden = await A.evaluate(() => document.getElementById('add-suggest-wrap').hidden);
    if (!suggestHidden) throw new Error('as sugestões deviam sumir quando vem do empty state (loop)');
    // foco automático no Nome (mínimo de toques: teclado já pronto)
    await A.waitForFunction(() => document.activeElement === document.getElementById('add-name'), null, { timeout: T });
  });

  await step('preview começa como placeholder ("seu item")', async () => {
    const st = await A.evaluate(() => ({
      name: document.getElementById('add-prev-name').textContent,
      ph: document.getElementById('add-prev-name').classList.contains('ph'),
      subHidden: document.getElementById('add-prev-sub').hidden,
    }));
    if (!/seu item/i.test(st.name) || !st.ph) throw new Error('preview não começou no placeholder: ' + JSON.stringify(st));
    if (!st.subHidden) throw new Error('o sub do preview (preço/mesa) devia começar escondido');
  });

  await step('digitar o nome atualiza o preview AO VIVO (some o placeholder)', async () => {
    await A.fill('#add-name', 'Pizza');
    await A.waitForFunction(() => {
      const n = document.getElementById('add-prev-name');
      return n.textContent === 'Pizza' && !n.classList.contains('ph');
    }, null, { timeout: T });
  });

  await step('escolher o ícone atualiza o preview E infere a categoria (🍕 → Comida)', async () => {
    await A.click('#emoji-row .emoji-pick[data-e="🍕"]');
    await A.waitForFunction(() => {
      const e = document.getElementById('add-prev-emoji').textContent;
      const cat = document.getElementById('add-cat').value;
      return e === '🍕' && cat === 'comida';
    }, null, { timeout: T });
  });

  await step('digitar o preço mostra o valor no preview', async () => {
    await A.fill('#add-price', '25');
    await A.waitForFunction(() => {
      const sub = document.getElementById('add-prev-sub');
      return !sub.hidden && /25/.test(sub.textContent);
    }, null, { timeout: T });
  });

  await step('Adicionar cria o card na mesa com o emoji e nome escolhidos', async () => {
    await A.click('#btn-additem-confirm');
    await A.waitForFunction(() => !!document.querySelector('.item-card[data-item="x-pizza"]'), null, { timeout: T });
    const card = await A.evaluate(() => {
      const c = document.querySelector('.item-card[data-item="x-pizza"]');
      return { emoji: c.querySelector('.item-emoji')?.textContent, name: c.querySelector('.item-name')?.textContent };
    });
    if (card.emoji !== '🍕' || card.name !== 'Pizza') throw new Error('card errado: ' + JSON.stringify(card));
  });

  // ---------- abrir pelo "+ item personalizado" de mesa MONTADA: aí as sugestões APARECEM ----------
  await step('no "+ item" da mesa montada, o catálogo aparece (atalho de 1 toque)', async () => {
    await A.click('.item-card[data-item="x-pizza"]');                 // 1 gole → sai do modo montagem
    await A.waitForFunction(() => !document.getElementById('btn-additem').hidden, null, { timeout: T });
    await A.click('#btn-additem');
    await A.waitForFunction(() => !document.getElementById('overlay-additem').hidden, null, { timeout: T });
    const suggestHidden = await A.evaluate(() => document.getElementById('add-suggest-wrap').hidden);
    if (suggestHidden) throw new Error('no "+ item" da mesa montada as sugestões deviam aparecer');
  });

  await ctx.close();
  await browser.close();
  console.log(`\n${results.length} verificações da tela de adicionar item passaram ✅`);
}

main().catch((e) => { console.error('❌ e2e-additem falhou:', e.message); process.exit(1); });
