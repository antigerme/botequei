// E2E das features novas em rede (2 navegadores reais, WebRTC): roleta sincronizada
// ("quem paga"), cutucada entregue ao alvo, "eu pago pra fulano" (PAYFOR) convergindo entre
// os peers, e as estatísticas de vida após sair da mesa.
//
//   node server/node.mjs &
//   node tests/e2e-features.mjs
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
  const peers = (page, n) => page.waitForFunction((v) => document.getElementById('peer-count')?.textContent === v, String(n), { timeout: T });
  const visible = (page, id) => page.waitForFunction((i) => { const e = document.getElementById(i); return e && !e.hidden; }, id, { timeout: T });
  const closeAll = (page) => page.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => (o.hidden = true)));
  const results = [];
  const step = async (name, fn) => { await fn(); console.log('  ✓ ' + name); results.push(name); };

  const A = await mkCtx('Andre'); const pageA = await A.newPage();
  await pageA.goto(BASE);
  await pageA.waitForSelector('#screen-home.is-active', { timeout: T });
  await pageA.click('#btn-create');
  await pageA.waitForSelector('#screen-table.is-active', { timeout: T });
  const code = (await pageA.textContent('#mesa-code')).trim();
  await closeAll(pageA);
  // mesa nasce vazia: monta o cardápio da noite (garrafa da mesa + chopp + lata)
  await pageA.click('#empty-suggest [data-id="cerveja"]');
  await pageA.click('#empty-suggest [data-id="chopp"]');
  await pageA.click('#empty-suggest [data-id="lata"]');
  await pageA.waitForFunction(() => document.querySelectorAll('.item-card').length === 3, null, { timeout: T });

  const B = await mkCtx('Bia'); const pageB = await B.newPage();
  await pageB.goto(BASE + '#/join?room=' + code);
  await pageB.waitForSelector('#screen-table.is-active', { timeout: T });

  await step('A e B conectam (peer-count = 2)', async () => {
    await Promise.all([peers(pageA, 2), peers(pageB, 2)]);
  });

  await step('presença: A mostra os avatares da mesa (self + Bia)', async () => {
    await pageA.waitForFunction(() => {
      const b = document.getElementById('presence-bar');
      return b && !b.hidden && b.querySelectorAll('.pres-av').length >= 2;
    }, null, { timeout: T });
  });

  await step('placar mostra indicador de conexão da Bia', async () => {
    // o indicador vem do getStats() amostrado periodicamente — em runner lento a 1ª amostra
    // pode ainda não ter chegado quando o placar abre; reabrir re-renderiza com o estado novo
    let hasNet = false;
    for (let i = 0; i < 10 && !hasNet; i++) {
      await pageA.click('#btn-peers'); await visible(pageA, 'overlay-peers');
      hasNet = await pageA.evaluate(() => [...document.querySelectorAll('#peers-list .peer-row')]
        .some((r) => !r.querySelector('.peer-you') && (r.querySelector('.peer-net')?.textContent || '').trim().length > 0));
      await closeAll(pageA);
      if (!hasNet) await pageA.waitForTimeout(1000);
    }
    if (!hasNet) throw new Error('sem indicador de conexão no placar');
  });

  await step('foto de perfil: A recorta uma imagem e a fotinho aparece pra MESA toda', async () => {
    await pageA.click('#btn-menu');
    await pageA.click('#menu-profile');
    await visible(pageA, 'overlay-profile');
    // PNG 1×1 basta: o caminho selfie/galeria é o MESMO input — só muda o atributo capture
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    await pageA.setInputFiles('#avatar-file', { name: 'selfie.png', mimeType: 'image/png', buffer: png });
    await visible(pageA, 'overlay-crop');
    await pageA.click('#btn-crop-use');
    await pageA.waitForFunction(() => !document.getElementById('profile-photo-img').hidden, null, { timeout: 5000 });
    await pageA.click('#btn-profile-save');
    // eu me vejo com foto na presença; B recebe pelo PROFILE (CRDT) e vê a mesma foto
    await pageA.waitForFunction(() => !!document.querySelector('#presence-bar .pres-av img.av-img'), null, { timeout: T });
    await pageB.waitForFunction(() => !!document.querySelector('#presence-bar .pres-av img.av-img'), null, { timeout: T });
  });

  await step('tocar num emoji VOLTA pro emoji (sem botão extra)', async () => {
    await pageA.click('#btn-menu');
    await pageA.click('#menu-profile');
    await visible(pageA, 'overlay-profile');
    const comFoto = await pageA.evaluate(() => !document.getElementById('profile-photo-img').hidden);
    if (!comFoto) throw new Error('herói deveria mostrar a foto salva');
    await pageA.click('#profile-avatars .emoji-pick');
    const voltou = await pageA.evaluate(() => document.getElementById('profile-photo-img').hidden && !document.getElementById('profile-preview-emoji').hidden);
    if (!voltou) throw new Error('tocar no emoji não voltou o herói pro emoji');
    await closeAll(pageA); // fecha SEM salvar — a foto segue valendo pra mesa (passo do reload de B)
  });

  await step('B recarrega e a foto de A volta (log salvo + anti-entropy em lotes)', async () => {
    await pageB.reload();
    await pageB.waitForSelector('#screen-table.is-active', { timeout: T });
    await pageB.waitForFunction(() => !!document.querySelector('#presence-bar .pres-av img.av-img'), null, { timeout: T });
    // espera a MALHA re-formar (a foto acima volta já do log salvo, antes da reconexão) —
    // os passos seguintes (roleta etc.) precisam dos dois peers online de novo
    await Promise.all([peers(pageA, 2), peers(pageB, 2)]);
  });

  // consumo p/ dar substância à conta/estatísticas — cobrindo o fluxo COMPARTILHADO
  await step('garrafa da mesa: pedido é da MESA; "meu copo" é só de quem bebeu', async () => {
    const cardA = await pageA.$('.item-card[data-item="cerveja"]');
    await cardA.scrollIntoViewIfNeeded(); // a área "monte o cardápio" empurra o grid pra baixo da dobra
    const box = await cardA.boundingBox();
    await pageA.mouse.click(box.x + box.width / 2, box.y + 18); // topo do card = mesa pediu +1 (longe da zona do copo)
    await Promise.all([pageA, pageB].map((p) => p.waitForFunction(
      () => document.querySelector('.item-card[data-item="cerveja"] .item-qty')?.textContent.trim() === '1',
      null, { timeout: T })));
    await pageB.click('.item-card[data-item="cerveja"] .item-cup'); // Bia bebeu um copo do bolo
    await pageB.waitForFunction(() => document.querySelector('.item-card[data-item="cerveja"] .item-cup-n')?.textContent.trim() === '1', null, { timeout: T });
    const cupA = await pageA.evaluate(() => document.querySelector('.item-card[data-item="cerveja"] .item-cup-n')?.textContent.trim());
    if (cupA !== '0') throw new Error('contador do copo é PESSOAL — em A deveria seguir 0, vi ' + cupA);
    const totB = (await pageB.textContent('#table-total')).trim();
    if (totB !== '1') throw new Error('copo NÃO sobe o "a mesa mandou" (a garrafa já contou) — vi ' + totB);
    await pageB.click('.item-card[data-item="chopp"]'); // e um chopp individual (estatística da Bia)
    await pageA.waitForTimeout(400);
  });

  await step('conta: bolo da mesa aparece com preço e racheia entre os dois', async () => {
    await pageA.click('#btn-menu'); await pageA.click('#menu-prices');
    await visible(pageA, 'overlay-prices');
    await pageA.fill('.price-row[data-id="cerveja"] .pr-price', '12');
    await pageA.$eval('.price-row[data-id="cerveja"] .pr-price', (e) => e.dispatchEvent(new Event('change')));
    await closeAll(pageA);
    await pageA.click('#btn-menu'); await pageA.click('#menu-bill');
    await visible(pageA, 'overlay-bill');
    await pageA.waitForFunction(() => {
      const p = document.getElementById('bill-pool');
      const l = document.getElementById('bill-pool-line');
      return p && !p.hidden && l && l.textContent.includes('12') && l.textContent.includes('× 2');
    }, null, { timeout: T });
    await closeAll(pageA);
  });

  await step('cardápio da mesa: marca "Original" e item escondido valem pra TODOS', async () => {
    await pageA.click('#btn-menu'); await pageA.click('#menu-prices');
    await visible(pageA, 'overlay-prices');
    await pageA.fill('.price-row[data-id="cerveja"] .pr-brand', 'Original');
    await pageA.$eval('.price-row[data-id="cerveja"] .pr-brand', (e) => e.dispatchEvent(new Event('change')));
    await pageA.click('.price-row[data-id="lata"] .pr-eye'); // ninguém pediu lata hoje
    await closeAll(pageA);
    await Promise.all([pageA, pageB].map((p) => p.waitForFunction(() => {
      const name = document.querySelector('.item-card[data-item="cerveja"] .item-name')?.textContent;
      return name === 'Original' && !document.querySelector('.item-card[data-item="lata"]');
    }, null, { timeout: T })));
  });

  await step('roleta: mesmo vencedor nos dois aparelhos', async () => {
    await pageA.click('#btn-menu'); await pageA.click('#menu-roulette');
    await visible(pageA, 'overlay-roulette');
    await pageA.click('#btn-roulette-spin');
    await Promise.all([visible(pageA, 'roulette-result'), visible(pageB, 'roulette-result')]);
    const rA = (await pageA.textContent('#roulette-result')).trim();
    const rB = (await pageB.textContent('#roulette-result')).trim();
    if (!rA || rA !== rB) throw new Error(`resultado divergente: A="${rA}" B="${rB}"`);
  });

  await step('cutucada chega no alvo (B)', async () => {
    await closeAll(pageA);
    await pageA.click('#btn-peers'); await visible(pageA, 'overlay-peers');
    await pageA.click('.peer-poke');                 // único não-eu na lista = Bia
    await visible(pageA, 'overlay-poke');
    await pageA.click('.poke-btn[data-kind="poke"]');
    await pageB.waitForFunction(() => {
      const t = document.getElementById('toast');
      return t && !t.hidden && /cutucou/i.test(t.textContent);
    }, null, { timeout: T });
  });

  await step('"eu pago pra fulano" (PAYFOR) converge em B', async () => {
    await closeAll(pageA);
    await pageA.click('#btn-menu'); await pageA.click('#menu-bill');
    await visible(pageA, 'overlay-bill');
    await pageA.click('.bill-row .b-pay');           // A passa a cobrir a Bia
    // No aparelho da Bia, a linha dela mostra "🙌 Andre" (coberta), via CRDT
    await closeAll(pageB);
    await pageB.click('#btn-menu'); await pageB.click('#menu-bill');
    await visible(pageB, 'overlay-bill');
    await pageB.waitForFunction(() => {
      const cov = [...document.querySelectorAll('#bill-list .b-covered')];
      return cov.some((c) => /Andre/i.test(c.textContent));
    }, null, { timeout: T });
  });

  await step('estatísticas: B sai e vê 1 noite', async () => {
    await closeAll(pageB);
    await pageB.click('#btn-leave');
    await pageB.click('#toast .toast-action'); // sair pede confirmação (um toque errado não derruba da mesa)
    await pageB.waitForSelector('#screen-home.is-active', { timeout: T });
    await pageB.click('#btn-stats');
    await visible(pageB, 'overlay-stats');
    const nights = await pageB.evaluate(() => {
      const cells = [...document.querySelectorAll('#stats-grid .stat-cell')];
      const c = cells.find((x) => (x.querySelector('.stat-l')?.textContent || '').includes('noites'));
      return c ? c.querySelector('.stat-v').textContent : null;
    });
    if (nights !== '1') throw new Error('esperava 1 noite, veio ' + nights);
  });

  await browser.close();
  console.log(`\n${results.length} verificacoes E2E (features) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E features FALHOU:', e.message); process.exit(1); });
