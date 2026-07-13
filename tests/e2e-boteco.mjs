// E2E do cardápio POR BOTECO (2 navegadores, WebRTC): o app LEMBRA o cardápio de cada lugar e
// OFERECE recarregar quando você volta. A ideia do André — "check-in no bar → o cardápio dele já
// aparece na mesa". Fluxo do frequentador:
//   check-in "Bar do Zé" (passaporte) → 1º rolê monta o cardápio → sai (guarda) → novo rolê no
//   mesmo boteco → o empty-state traz "📓 Carregar cardápio do Bar do Zé (2)" → 1 toque recarrega,
//   nomeia a mesa E sincroniza pra turma (CRDT).
//
//   node server/node.mjs &
//   node tests/e2e-boteco.mjs
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
  // O check-in é da HOME (só aparece com histórico), então semeamos direto no localStorage — é
  // o MESMO dado que o passaporte grava — fresco (agora) pra o "boteco da sessão" puxar o cardápio.
  const mkCtx = async (name, checkin) => {
    // geolocation concedida (posição fixa) — assim o getCurrentPosition RESOLVE no headless (sem
    // permissão ele fica pendurado): o check-in automático do join grava com coordenada, sem travar.
    const c = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: -23.56, longitude: -46.64 } });
    await c.addInitScript((a) => {
      localStorage.setItem('botequei.name', a.n);
      localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 }));
      localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' }));
      if (a.checkin) localStorage.setItem('botequei.passport', JSON.stringify([{ name: a.checkin, at: Date.now() }]));
    }, { n: name, checkin: checkin || '' });
    return c;
  };
  const peers = (page, n) => page.waitForFunction((v) => document.getElementById('peer-count')?.textContent === v, String(n), { timeout: T });
  const closeAll = (page) => page.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };

  const A = await mkCtx('Andre', 'Bar do Zé'); const pageA = await A.newPage();
  await pageA.goto(BASE);
  await pageA.waitForSelector('#screen-home.is-active', { timeout: T });

  // monta um item pelo formulário do ➕ (mesa limpa usa o btn-empty-custom; depois, o + item)
  const novoItem = async (name) => {
    const vazio = await pageA.evaluate(() => !document.getElementById('menu-empty').hidden);
    await pageA.click(vazio ? '#btn-empty-custom' : '#btn-additem');
    await pageA.fill('#add-name', name);
    await pageA.click('#btn-additem-confirm');
    await pageA.waitForFunction(() => document.getElementById('overlay-additem').hidden, null, { timeout: T });
  };

  await step('1º rolê no boteco: mesa sem CTA (nada salvo) e monta o cardápio', async () => {
    await pageA.click('#btn-create');
    await pageA.waitForSelector('#screen-table.is-active', { timeout: T });
    await closeAll(pageA);
    await pageA.waitForFunction(() => !document.getElementById('menu-empty').hidden, null, { timeout: T });
    const temCta = await pageA.evaluate(() => !document.getElementById('btn-empty-boteco').hidden);
    if (temCta) throw new Error('não devia ter CTA de carregar na 1ª vez (nada salvo ainda)');
    await novoItem('Chopp');
    // clareана #3: o 1º item numa sessão com boteco (check-in fresco "Bar do Zé") avisa que o
    // cardápio será lembrado — a corrente check-in→montar→sair→salvar deixa de ser invisível
    await pageA.waitForFunction(() => { const el = document.getElementById('toast'); return el && !el.hidden && /lembrar/i.test(el.textContent) && /Bar do Z/.test(el.textContent); }, null, { timeout: T });
    await novoItem('Porção');
    await pageA.waitForFunction(() => document.querySelectorAll('.item-card').length === 2, null, { timeout: T });
  });

  await step('ao sair, o cardápio fica guardado sob o boteco do check-in (local)', async () => {
    await pageA.click('#btn-leave');
    await pageA.click('#toast .toast-action'); // sair pede confirmação
    await pageA.waitForSelector('#screen-home.is-active', { timeout: T });
    const n = await pageA.evaluate(() => {
      const all = JSON.parse(localStorage.getItem('botequei.botecomenu') || '{}');
      return all['bar do ze'] ? all['bar do ze'].defs.length : 0;
    });
    if (n !== 2) throw new Error('esperava 2 itens salvos pro boteco "bar do ze", veio ' + n);
    // A CRIOU a mesa (não aprendeu de ninguém) → toast genérico "guardado", nunca o "conhece"
    await pageA.waitForFunction(() => { const el = document.getElementById('toast'); return el && !el.hidden && /guardado/i.test(el.textContent); }, null, { timeout: T });
    if (await pageA.evaluate(() => /conhece o cardápio/i.test(document.getElementById('toast').textContent))) {
      throw new Error('quem CRIOU a mesa não deveria "aprender" o cardápio');
    }
  });

  // 2º rolê: nova mesa, mesmo boteco (check-in ainda fresco). Bia entra antes de A carregar.
  let code;
  await step('2º rolê: nova mesa e o empty-state OFERECE o cardápio salvo (2 itens)', async () => {
    await pageA.click('#btn-create');
    await pageA.waitForSelector('#screen-table.is-active', { timeout: T });
    code = (await pageA.textContent('#mesa-code')).trim();
    await closeAll(pageA);
    await pageA.waitForFunction(() => {
      const b = document.getElementById('btn-empty-boteco');
      return b && !b.hidden && /Bar do Z/i.test(b.textContent) && /\(2\)/.test(b.textContent);
    }, null, { timeout: T });
  });

  const B = await mkCtx('Bia'); const pageB = await B.newPage();
  await pageB.goto(BASE + '#/join?room=' + code);
  await pageB.waitForSelector('#screen-table.is-active', { timeout: T });
  await step('A e B conectam (peer-count = 2)', async () => {
    await Promise.all([peers(pageA, 2), peers(pageB, 2)]);
  });

  await step('1 toque carrega o cardápio, nomeia a mesa E sincroniza pros dois', async () => {
    await pageA.click('#btn-empty-boteco');
    // os 2 itens aparecem nos DOIS peers (viajaram pela malha, evento ITEM)
    await Promise.all([pageA, pageB].map((p) => p.waitForFunction(
      () => document.querySelectorAll('.item-card').length === 2, null, { timeout: T })));
    const nomesB = await pageB.evaluate(() => [...document.querySelectorAll('.item-card .item-name')].map((e) => e.textContent).sort());
    if (!(nomesB.includes('Chopp') && nomesB.includes('Porção'))) throw new Error('itens não sincronizaram pra Bia: ' + JSON.stringify(nomesB));
    // a mesa "colou" o boteco: o título vira "Bar do Zé" nos dois (evento TABLE)
    await Promise.all([pageA, pageB].map((p) => p.waitForFunction(
      () => document.getElementById('table-title')?.textContent.trim() === 'Bar do Zé', null, { timeout: T })));
  });

  await step('auto check-in: a Bia ENTROU numa mesa nomeada → "Bar do Zé" cai no passaporte dela sozinho', async () => {
    // ela entrou por código (join) e a mesa tem nome → check-in automático (sem GPS obrigatório).
    // A Bia NÃO tinha check-in prévio (contexto sem seed), então o registro só pode ter vindo do join.
    await pageB.waitForFunction(() => {
      const p = JSON.parse(localStorage.getItem('botequei.passport') || '[]');
      return p.some((c) => c.name === 'Bar do Zé');
    }, null, { timeout: T });
  });

  await step('#3 efeito de rede: a Bia ENTROU na mesa → ao sair, "você conhece o cardápio do Bar do Zé"', async () => {
    await pageB.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
    await pageB.click('#btn-leave');
    await pageB.click('#toast .toast-action'); // sair pede confirmação
    await pageB.waitForSelector('#screen-home.is-active', { timeout: T });
    // Bia não hospedou nada — aprendeu o cardápio pela sincronização → toast de rede
    await pageB.waitForFunction(() => {
      const el = document.getElementById('toast');
      return el && !el.hidden && /conhece o cardápio/i.test(el.textContent) && /Bar do Z/.test(el.textContent);
    }, null, { timeout: T });
    // e o cardápio aprendido ficou salvo no aparelho DELA (2 itens) pra recarregar quando voltar
    const n = await pageB.evaluate(() => { const all = JSON.parse(localStorage.getItem('botequei.botecomenu') || '{}'); return all['bar do ze'] ? all['bar do ze'].defs.length : 0; });
    if (n !== 2) throw new Error('a Bia devia ter aprendido 2 itens do Bar do Zé, veio ' + n);
  });

  await browser.close();
  console.log(`\n${results.length} verificacoes E2E (cardápio por boteco) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E boteco FALHOU:', e.message); process.exit(1); });
