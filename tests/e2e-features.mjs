// E2E das features em rede (2 navegadores reais, WebRTC): cardápio da mesa (formulário do
// ➕, item compartilhado, marca, esconder), cutucada entregue ao alvo, "eu pago pra fulano"
// (PAYFOR) convergindo entre os peers, e as estatísticas de vida após sair da mesa.
//
//   node server/node.mjs &
//   node tests/e2e-features.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const T = 45000; // teto generoso: é o e2e mais PESADO (2 peers + foto + conta/comanda + rodada paga).
                 // Teto maior NÃO afrouxa assert — o waitForFunction resolve assim que o estado bate.

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
  // mesa nasce limpa: monta o cardápio da noite pelo formulário do ➕
  // (Garrafa 600 é "da mesa" = share; ids viram x-garrafa-600 / x-chopp / x-lata)
  const novoItem = async (name, share, cat = 'cerveja') => {
    const vazio = await pageA.evaluate(() => !document.getElementById('menu-empty').hidden);
    await pageA.click(vazio ? '#btn-empty-custom' : '#btn-additem');
    await pageA.fill('#add-name', name);
    if (share) await pageA.check('#add-share');
    await pageA.selectOption('#add-cat', cat); // sem emoji escolhido a categoria cairia em "outros"; a rodada só lista bebidas
    await pageA.click('#btn-additem-confirm');
    await pageA.waitForFunction(() => document.getElementById('overlay-additem').hidden, null, { timeout: T });
  };
  await novoItem('Garrafa 600', true);
  await novoItem('Chopp');
  await novoItem('Lata');
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
    // DOIS atrasos legítimos num runner frio: a linha da Bia depende do PROFILE dela ter
    // sincronizado (summary usa state.users — só a malha de pé não basta) e o tipo de conexão
    // vem do getStats() amostrado. Reabrir re-renderiza com o estado novo; 25s cobre o pior
    // runner visto no CI (a 1ª falha real estourou os 10s antigos). O erro diz QUAL metade atrasou.
    let got = { row: false, net: false };
    for (let i = 0; i < 25 && !got.net; i++) {
      await pageA.click('#btn-peers'); await visible(pageA, 'overlay-peers');
      got = await pageA.evaluate(() => {
        const rows = [...document.querySelectorAll('#peers-list .peer-row')].filter((r) => !r.querySelector('.peer-you'));
        return { row: rows.length > 0, net: rows.some((r) => (r.querySelector('.peer-net')?.textContent || '').trim().length > 0) };
      });
      await closeAll(pageA);
      if (!got.net) await pageA.waitForTimeout(1000);
    }
    if (!got.net) throw new Error(got.row ? 'linha da Bia SEM indicador de conexão' : 'linha da Bia nem apareceu no placar (PROFILE não sincronizou)');
  });

  await step('foto de perfil: A recorta uma imagem e a fotinho aparece pra MESA toda', async () => {
    await pageA.click('.pres-me'); // seu rosto na barra de presença abre o hub pessoal
    await visible(pageA, 'overlay-me');
    await pageA.click('#me-profile');
    await visible(pageA, 'overlay-profile');
    // PNG 1×1 basta: "📷 Trocar foto" abre o MESMO #avatar-file (sheet nativo no cel); aqui o
    // setInputFiles simula a escolha do arquivo → cai no recorte igual à webcam do desktop
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
    await pageA.click('.pres-me'); // seu rosto na barra de presença abre o hub pessoal
    await visible(pageA, 'overlay-me');
    await pageA.click('#me-profile');
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
  await step('garrafa da mesa: +1 é DA MESA (o card compartilhado é só o contador da mesa)', async () => {
    // quem não bebe sai do racha na conta; sem contagem por copo (contar copo é mesquinharia)
    await pageA.click('.item-card[data-item="x-garrafa-600"]'); // chegou mais uma garrafa (qualquer um marca)
    await Promise.all([pageA, pageB].map((p) => p.waitForFunction(
      () => document.querySelector('.item-card[data-item="x-garrafa-600"] .item-qty')?.textContent.trim() === '1',
      null, { timeout: T })));
    const totB = (await pageB.textContent('#table-total')).trim();
    if (totB !== '1') throw new Error('a garrafa sobe o "a mesa mandou" — vi ' + totB);
    await pageB.click('.item-card[data-item="x-chopp"]'); // e um chopp individual (estatística da Bia)
    await pageA.waitForTimeout(400);
  });

  await step('conta: bolo da mesa aparece com preço e racheia entre os dois', async () => {
    await pageA.click('#btn-menu'); await pageA.click('#menu-prices');
    await visible(pageA, 'overlay-prices');
    await pageA.fill('.price-row[data-id="x-garrafa-600"] .pr-price', '12');
    await pageA.$eval('.price-row[data-id="x-garrafa-600"] .pr-price', (e) => e.dispatchEvent(new Event('change')));
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

  await step('cardápio da mesa: marca "Original", DESCRIÇÃO editada e item escondido valem pra TODOS', async () => {
    await pageA.click('#btn-menu'); await pageA.click('#menu-prices');
    await visible(pageA, 'overlay-prices');
    await pageA.fill('.price-row[data-id="x-garrafa-600"] .pr-brand', 'Original');
    await pageA.$eval('.price-row[data-id="x-garrafa-600"] .pr-brand', (e) => e.dispatchEvent(new Event('change')));
    // descrição (ex-observação) agora se edita AQUI também — caso Skoll/"Garrafa 600ml"
    await pageA.fill('.price-row[data-id="x-garrafa-600"] .pr-note', 'Garrafa 600ml gelada');
    await pageA.$eval('.price-row[data-id="x-garrafa-600"] .pr-note', (e) => e.dispatchEvent(new Event('change')));
    await pageA.click('.price-row[data-id="x-lata"] .pr-eye'); // ninguém pediu lata hoje
    await closeAll(pageA);
    await Promise.all([pageA, pageB].map((p) => p.waitForFunction(() => {
      const name = document.querySelector('.item-card[data-item="x-garrafa-600"] .item-name')?.textContent;
      const note = document.querySelector('.item-card[data-item="x-garrafa-600"] .item-note')?.textContent || '';
      return name === 'Original' && note.includes('Garrafa 600ml gelada') && !document.querySelector('.item-card[data-item="x-lata"]');
    }, null, { timeout: T })));
  });

  await step('desafio chega no alvo (B)', async () => {
    await closeAll(pageA);
    await pageA.click('#btn-peers'); await visible(pageA, 'overlay-peers');
    await pageA.click('.peer-poke');                 // único não-eu na lista = Bia
    await visible(pageA, 'overlay-poke');
    await pageA.click('.poke-btn[data-kind="challenge"]'); // 1º item de desafio (só há botão de desafio agora)
    await pageB.waitForFunction(() => {
      const t = document.getElementById('toast');
      return t && !t.hidden && /desafiou/i.test(t.textContent);
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

  await step('💸 pagar uma rodada: a garrafa do A sai do racha e cai na conta dele', async () => {
    await closeAll(pageA);
    await pageA.click('#btn-rodada'); // 💸 Rodada no dock (era o "Pagar rodada" do menu "…")
    await visible(pageA, 'overlay-payround');
    await pageA.click('#payround-list .pay-btn[data-id="x-garrafa-600"]'); // item DA MESA: paga uma garrafa só (com dono)
    // a garrafa com dono AINDA é da mesa: o card sobe pra 2 nos DOIS peers
    await Promise.all([pageA, pageB].map((p) => p.waitForFunction(
      () => document.querySelector('.item-card[data-item="x-garrafa-600"] .item-qty')?.textContent.trim() === '2',
      null, { timeout: T })));
    // na conta (vista da Bia): o bolo racheia SÓ a garrafa sem dono (12, nunca 24)
    await closeAll(pageB);
    await pageB.click('#btn-menu'); await pageB.click('#menu-bill');
    await visible(pageB, 'overlay-bill');
    await pageB.waitForFunction(() => {
      const l = document.getElementById('bill-pool-line');
      return l && l.textContent.includes('12') && !l.textContent.includes('24');
    }, null, { timeout: T });
    // e a comanda do André (sem gorjeta/rateio) mostra a linha "💸 pagou" com os R$12
    await closeAll(pageB);
    await pageB.click('#btn-peers'); await visible(pageB, 'overlay-peers');
    await pageB.evaluate(() => {
      const row = [...document.querySelectorAll('#peers-list .peer-row')].find((r) => /Andre/i.test(r.textContent));
      row.querySelector('.peer-main').click();
    });
    await visible(pageB, 'overlay-comanda');
    await pageB.waitForFunction(() => {
      const list = document.getElementById('comanda-list');
      const tot = document.getElementById('comanda-total');
      return list && list.textContent.includes('💸') && tot && tot.textContent.includes('12');
    }, null, { timeout: T });
    await closeAll(pageB);
  });

  await step('💸 pagar rodada de item PESSOAL: um pra cada online; cada um bebe, o pagador banca', async () => {
    // dá preço ao chopp pra a conta ter número (10)
    await closeAll(pageA);
    await pageA.click('#btn-menu'); await pageA.click('#menu-prices');
    await visible(pageA, 'overlay-prices');
    await pageA.fill('.price-row[data-id="x-chopp"] .pr-price', '10');
    await pageA.$eval('.price-row[data-id="x-chopp"] .pr-price', (e) => e.dispatchEvent(new Event('change')));
    await closeAll(pageA);
    // ⚠️ item PESSOAL paga UM pra cada ONLINE (roundTargets filtra mesh.peers().online); a garrafa
    // (share) acima só ia pro self, então não dependia da Bia. Sob carga no CI o heartbeat da Bia
    // pode PISCAR (STALE_MS=12s, ou ICE 'disconnected' derruba rec.ready na hora) e A a marca offline
    // → a rodada sairia SÓ pro André e o card do chopp TRAVA em 2 (nunca 3). Espera A ver a Bia online
    // DE NOVO antes de pagar (peer-count = connectedCount+1, lê o MESMO rec.ready do roundTargets) —
    // esperar ESTADO, não afrouxar assert (regressão real: e2e-features vermelho SÓ no alvo Node do CI).
    await peers(pageA, 2);
    // Bia já tinha 1 chopp (clicou antes). A PAGA uma rodada de CHOPP (pessoal) → +1 pra A e +1 pra B.
    await pageA.click('#btn-rodada'); // 💸 Rodada no dock
    await visible(pageA, 'overlay-payround');
    await pageA.click('#payround-list .pay-btn[data-id="x-chopp"]');
    // cada um bebeu: o card do chopp vai a 3 (A=1, B=2) nos dois peers
    await Promise.all([pageA, pageB].map((p) => p.waitForFunction(
      () => document.querySelector('.item-card[data-item="x-chopp"] .item-qty')?.textContent.trim() === '3',
      null, { timeout: T })));
    // 🔔 pagar rodada CHAMA o garçom dizendo item + quantos: a Bia vê "André pediu: 2× Chopp"
    await pageB.waitForFunction(() => { const el = document.getElementById('toast'); return el && !el.hidden && /pediu/i.test(el.textContent) && /Chopp/.test(el.textContent); }, null, { timeout: T });
    // comanda da Bia: bebeu 2 chopps (×2), mas 1 foi coberto → paga SÓ 1×10 (nunca 20), com a nota
    await closeAll(pageB);
    await pageB.click('#btn-peers'); await visible(pageB, 'overlay-peers');
    await pageB.evaluate(() => {
      const row = [...document.querySelectorAll('#peers-list .peer-row')].find((r) => /Bia/i.test(r.textContent));
      row.querySelector('.peer-main').click();
    });
    await visible(pageB, 'overlay-comanda');
    await pageB.waitForFunction(() => {
      const list = document.getElementById('comanda-list');
      const tot = document.getElementById('comanda-total');
      if (!list || !tot) return false;
      return /×2/.test(list.textContent) && /na conta de quem pagou/i.test(list.textContent)
        && tot.textContent.includes('R$10,00') && !tot.textContent.includes('R$20,00');
    }, null, { timeout: T });
    await closeAll(pageB);
    // comanda do André: banca a rodada — a linha 💸 do chopp aparece e a conta dele passa dos R$12
    await pageB.click('#btn-peers'); await visible(pageB, 'overlay-peers');
    await pageB.evaluate(() => {
      const row = [...document.querySelectorAll('#peers-list .peer-row')].find((r) => /Andre/i.test(r.textContent));
      row.querySelector('.peer-main').click();
    });
    await visible(pageB, 'overlay-comanda');
    await pageB.waitForFunction(() => {
      const tot = document.getElementById('comanda-total');
      return tot && tot.textContent.includes('R$32,00'); // 12 (garrafa) + 20 (2 chopps da rodada)
    }, null, { timeout: T });
    await closeAll(pageB);
  });

  await step('🎁 fechar a conta mostra QUEM bancou (rodadas/garrafas) — "cada um nas suas costas"', async () => {
    await closeAll(pageB);
    await pageB.click('#btn-menu'); await pageB.click('#menu-bill');
    await visible(pageB, 'overlay-bill');
    // o quadro do crédito lista o André bancando a garrafa E a rodada de chopp
    await pageB.waitForFunction(() => {
      const b = document.getElementById('bill-bankrolls');
      return b && !b.hidden && /Andre/i.test(b.textContent) && /Chopp/i.test(b.textContent);
    }, null, { timeout: T });
    await closeAll(pageB);
  });

  await step('estatísticas: B sai e vê 1 noite', async () => {
    await closeAll(pageB);
    await pageB.click('#btn-leave');
    await pageB.click('#toast .toast-action'); // sair pede confirmação (um toque errado não derruba da mesa)
    await pageB.waitForSelector('#screen-home.is-active', { timeout: T });
    await pageB.click('#btn-me'); // avatar no canto da home → hub pessoal
    await visible(pageB, 'overlay-me');
    await pageB.click('#me-stats'); // "Meus números" só aparece com histórico (B tem 1 noite)
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
