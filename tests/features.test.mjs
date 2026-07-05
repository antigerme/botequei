// Testes das features novas (sem dependencias): PIX, perfil/mesa (LWW), conquistas.
// Rodar: node tests/features.test.mjs

import assert from 'node:assert';
import { crc16, pixPayload } from '../js/pix.js';
import { emptyState, applyEvent, getProfile, tableInfo, isDriver, userMoney, userTotal, tableTotal, sharePool, shareSplit, summary, happyHour, paysFor, payerOf, songs } from '../js/events.js';
import { badgesFor, mvp, ceremonyAwards } from '../js/achievements.js';
import { encodeBlob, decodeBlob } from '../js/handshake.js';

let passed = 0;
const ok = (n) => { console.log('  ✓ ' + n); passed++; };

// ---------- PIX ----------
{
  assert.strictEqual(crc16('123456789'), '29B1');
  ok('CRC-16/CCITT-FALSE (vetor padrão 29B1)');

  const p = pixPayload({ key: 'a@b.com', name: 'André Felício', city: 'São Paulo', amount: 12.5, txid: 'X1' });
  assert.strictEqual(p.slice(0, 6), '000201');
  ok('PIX: payload format indicator');
  assert.strictEqual(p.slice(-4), crc16(p.slice(0, -4)));
  ok('PIX: CRC embutido confere com o corpo');
  assert.ok(p.includes('br.gov.bcb.pix'), 'GUI');
  assert.ok(p.includes('540512.50'), 'valor 12.50 (TLV 54)');
  assert.ok(!/[^\x20-\x7E]/.test(p), 'só ASCII (acentos removidos)');
  ok('PIX: GUI + valor formatado + ASCII');

  const noAmt = pixPayload({ key: 'x', name: 'Y', city: 'Z' });
  assert.ok(!noAmt.includes('5406') && !/54\d\d/.test(noAmt.slice(0, noAmt.indexOf('5802'))), 'sem valor quando amount ausente');
  ok('PIX: valor omitido quando não informado');
}

// ---------- Perfil / mesa (LWW) ----------
{
  const s = emptyState();
  applyEvent(s, { type: 'PROFILE', user: 'a', name: 'André', color: '#f00', emoji: '😎', driver: false, ts: 1, eventId: 'p1' });
  applyEvent(s, { type: 'PROFILE', user: 'a', name: 'André', color: '#0f0', emoji: '🦊', driver: true, ts: 5, eventId: 'p2' });
  applyEvent(s, { type: 'PROFILE', user: 'a', name: 'André', color: '#00f', emoji: '🐼', driver: false, ts: 3, eventId: 'p3' });
  const p = getProfile(s, 'a');
  assert.strictEqual(p.emoji, '🦊');
  assert.strictEqual(p.color, '#0f0');
  assert.strictEqual(isDriver(s, 'a'), true);
  ok('perfil: LWW (maior ts vence) + driver');

  applyEvent(s, { type: 'TABLE', title: 'Mesa do Fundão', emoji: '🍻', ts: 2, eventId: 't1' });
  applyEvent(s, { type: 'TABLE', title: 'antiga', emoji: '🥴', ts: 1, eventId: 't0' }); // ts menor, não vence
  assert.strictEqual(tableInfo(s).title, 'Mesa do Fundão');
  ok('mesa: nome/emoji com LWW');
}

// ---------- Itens compartilhados (garrafa/litrão/torre): pessoal × mesa ----------
{
  const defs = {
    cerveja: { id: 'cerveja', price: 12, share: 1 }, // garrafa 600 da mesa
    chopp: { id: 'chopp', price: 9 },
    copo: { id: 'copo', price: 0, g: 11, cup: 1 },
  };
  const resolve = (id) => defs[id];
  const s = emptyState();
  const add = (user, item, n) => { for (let i = 0; i < n; i++) applyEvent(s, { type: 'ADD', user, item, ts: i + 1, eventId: user + item + i }); };
  add('a', 'cerveja', 2); // "chegaram 2 garrafas" (a marcou pela mesa)
  add('a', 'chopp', 3);
  add('a', 'copo', 2);
  add('b', 'cerveja', 1);

  assert.strictEqual(userTotal(s, 'a'), 7, 'sem resolver: soma tudo (compat)');
  assert.strictEqual(userTotal(s, 'a', resolve), 5, 'pessoal: garrafas da mesa ficam de fora');
  ok('compartilhado: total pessoal não conta o recipiente da mesa');

  // o número grande da mesa = o que foi PEDIDO: copo NÃO soma (a garrafa dele já contou)
  assert.strictEqual(tableTotal(s), 8, 'sem resolver: soma tudo (compat)');
  assert.strictEqual(tableTotal(s, resolve), 6, '3 garrafas + 3 chopps; os 2 copos ficam de fora');
  ok('compartilhado: "a mesa mandou" não conta copo (senão a mesma cerveja contaria 2×)');

  assert.strictEqual(userMoney(s, 'a', resolve), 27, 'só os 3 chopps (copo é R$0; garrafa é do bolo)');
  assert.strictEqual(userMoney(s, 'b', resolve), 0, 'b só marcou garrafa da mesa');
  ok('compartilhado: dinheiro do recipiente não pendura em quem tocou');

  const pool = sharePool(s, resolve);
  assert.strictEqual(pool.total, 36, '3 garrafas × 12');
  assert.strictEqual(pool.lines.length, 1);
  assert.strictEqual(pool.lines[0].count, 3);
  ok('compartilhado: sharePool junta o bolo da mesa (3 garrafas, R$36)');

  const rows = summary(s, resolve);
  const ra = rows.find((r) => r.user === 'a');
  assert.strictEqual(ra.total, 5);
  assert.strictEqual(ra.money, 27);
  ok('compartilhado: summary usa o total/dinheiro pessoais');

  // rateio do bolo: motorista fora por padrão; toggle "todos"; fallback se só tem motorista
  applyEvent(s, { type: 'PROFILE', user: 'm', name: 'Mari', emoji: '🚗', driver: true, ts: 9, eventId: 'pm' });
  assert.deepStrictEqual([...shareSplit(s, ['a', 'b', 'm'])].sort(), ['a', 'b'], 'motorista fica fora do bolo');
  assert.deepStrictEqual([...shareSplit(s, ['a', 'b', 'm'], { shareAll: true })].sort(), ['a', 'b', 'm'], 'toggle inclui todo mundo');
  assert.deepStrictEqual([...shareSplit(s, ['m'])], ['m'], 'só motorista na conta → racha entre quem tem');
  ok('compartilhado: shareSplit (motorista fora / toggle todos / fallback)');
}

// ---------- Foto de perfil (miniatura no PROFILE, validada) ----------
{
  const s = emptyState();
  const foto = 'data:image/jpeg;base64,' + 'A'.repeat(400); // miniatura plausível
  applyEvent(s, { type: 'PROFILE', user: 'a', name: 'André', emoji: '😎', photo: foto, ts: 1, eventId: 'f1' });
  assert.strictEqual(getProfile(s, 'a').photo, foto);
  ok('foto: dataURL pequena entra no perfil');

  applyEvent(s, { type: 'PROFILE', user: 'a', name: 'André', emoji: '😎', photo: '', ts: 2, eventId: 'f2' });
  assert.strictEqual(getProfile(s, 'a').photo, '');
  ok('foto: PROFILE novo com photo vazia LIMPA (volta pro emoji)');

  applyEvent(s, { type: 'PROFILE', user: 'a', name: 'André', emoji: '😎', photo: foto, ts: 1, eventId: 'f0' });
  assert.strictEqual(getProfile(s, 'a').photo, '', 'ts menor não ressuscita a foto');
  ok('foto: LWW vale pra foto também (ts velho não volta)');

  // higiene P2P: gigante ou src estranho é DESCARTADO (evento segue valendo sem foto)
  applyEvent(s, { type: 'PROFILE', user: 'b', name: 'Bia', emoji: '🦊', photo: 'data:image/png;base64,' + 'B'.repeat(30000), ts: 1, eventId: 'g1' });
  assert.strictEqual(getProfile(s, 'b').photo, '');
  assert.strictEqual(getProfile(s, 'b').emoji, '🦊', 'resto do perfil fica');
  applyEvent(s, { type: 'PROFILE', user: 'c', name: 'Caio', emoji: '🐼', photo: 'javascript:alert(1)', ts: 1, eventId: 'g2' });
  assert.strictEqual(getProfile(s, 'c').photo, '');
  applyEvent(s, { type: 'PROFILE', user: 'd', name: 'Duda', emoji: '🐸', photo: { hack: 1 }, ts: 1, eventId: 'g3' });
  assert.strictEqual(getProfile(s, 'd').photo, '');
  ok('foto: gigante/URL esquisita/não-string são descartadas (higiene P2P)');
}

// ---------- Preço via ITEM + conta ----------
{
  const s = emptyState();
  applyEvent(s, { type: 'ITEM', def: { id: 'cerveja', emoji: '🍺', name: 'Cerveja', price: 10 }, ts: 1, eventId: 'i1' });
  for (let i = 0; i < 3; i++) applyEvent(s, { type: 'ADD', user: 'a', name: 'A', item: 'cerveja', ts: 2 + i, eventId: 'a' + i });
  const resolve = (id) => (s.items.get(id) ? s.items.get(id).def : { id, price: 0 });
  assert.strictEqual(userMoney(s, 'a', resolve), 30);
  ok('preço via ITEM: userMoney soma preço × quantidade');
}

// ---------- Conquistas / MVP ----------
{
  const s = emptyState();
  applyEvent(s, { type: 'PROFILE', user: 'andre', name: 'André', driver: true, ts: 1, eventId: 'p' });
  for (let i = 0; i < 6; i++) applyEvent(s, { type: 'ADD', user: 'bia', name: 'Bia', item: 'cerveja', ts: 10 + i, eventId: 'b' + i });
  applyEvent(s, { type: 'ADD', user: 'bia', name: 'Bia', item: 'agua', ts: 30, eventId: 'w' });
  applyEvent(s, { type: 'ADD', user: 'andre', name: 'André', item: 'agua', ts: 31, eventId: 'wa' });
  const ids = badgesFor(s, 'bia').map((b) => b.id);
  assert.ok(ids.includes('first') && ids.includes('five') && ids.includes('water'));
  ok('conquistas: first/five/water');
  const ri = (id) => ({ id, price: 0 });
  assert.strictEqual(mvp(s, ri).name, 'Bia'); // André é motorista -> fora do MVP
  ok('MVP: ignora motorista');
}

// ---------- Handshake offline (codec do offer/answer, sem servidor) ----------
{
  const sdp = 'v=0\r\no=- 1 2 IN IP4 0.0.0.0\r\n' + 'a=candidate:x 1 udp 1 10.0.0.1 5000 typ host\r\n'.repeat(30);
  const blob = { v: 1, t: 'offer', from: 'abc-123', name: 'André 🍺', room: '7XQF', sdp: { type: 'offer', sdp } };
  const code = await encodeBlob(blob);
  assert.strictEqual(code.slice(0, 2), 'BQ');
  assert.deepStrictEqual(await decodeBlob(code), blob);
  ok('handshake: round-trip preserva offer/answer (com SDP+ICE)');

  await assert.rejects(() => decodeBlob('não é um código'), 'texto inválido deve lançar');
  await assert.rejects(() => decodeBlob('BQ'), 'código truncado deve lançar');
  ok('handshake: código inválido é rejeitado');
}

// ---------- Happy hour (LWW) ----------
{
  const s = emptyState();
  assert.strictEqual(happyHour(s), null);
  applyEvent(s, { type: 'HAPPYHOUR', until: 1000, startTotal: 3, startedBy: 'a', ts: 5, eventId: 'h1' });
  applyEvent(s, { type: 'HAPPYHOUR', until: 2000, startTotal: 9, startedBy: 'b', ts: 2, eventId: 'h0' }); // ts menor, não vence
  const hh = happyHour(s);
  assert.strictEqual(hh.until, 1000);
  assert.strictEqual(hh.startTotal, 3);
  ok('happy hour: LWW (maior ts vence)');
}

// ---------- "Eu pago pra fulano" (PAYFOR, LWW) ----------
{
  const s = emptyState();
  applyEvent(s, { type: 'PAYFOR', from: 'andre', to: 'bia', on: true, ts: 1, eventId: 'pf1' });
  assert.strictEqual(paysFor(s, 'andre', 'bia'), true);
  assert.strictEqual(payerOf(s).get('bia'), 'andre');
  applyEvent(s, { type: 'PAYFOR', from: 'andre', to: 'bia', on: false, ts: 2, eventId: 'pf2' }); // desmarca (ts maior)
  assert.strictEqual(paysFor(s, 'andre', 'bia'), false);
  assert.strictEqual(payerOf(s).has('bia'), false);
  applyEvent(s, { type: 'PAYFOR', from: 'andre', to: 'bia', on: true, ts: 1, eventId: 'pf0' }); // ts menor não revive
  assert.strictEqual(paysFor(s, 'andre', 'bia'), false);
  ok('payfor: LWW liga/desliga a cobertura');

  // conflito: dois pagadores pra mesma pessoa → vence o de maior ts
  const s2 = emptyState();
  applyEvent(s2, { type: 'PAYFOR', from: 'andre', to: 'ze', on: true, ts: 5, eventId: 'c1' });
  applyEvent(s2, { type: 'PAYFOR', from: 'bia', to: 'ze', on: true, ts: 9, eventId: 'c2' });
  assert.strictEqual(payerOf(s2).get('ze'), 'bia');
  ok('payfor: conflito resolvido pelo maior ts');
}

// ---------- Cerimônia de troféus ----------
{
  const s = emptyState();
  applyEvent(s, { type: 'PROFILE', user: 'andre', name: 'André', driver: true, ts: 1, eventId: 'pa' });
  for (let i = 0; i < 4; i++) applyEvent(s, { type: 'ADD', user: 'bia', name: 'Bia', item: 'cerveja', ts: 10 + i, eventId: 'b' + i });
  applyEvent(s, { type: 'ADD', user: 'bia', name: 'Bia', item: 'dose', ts: 20, eventId: 'bd' });
  applyEvent(s, { type: 'ADD', user: 'ze', name: 'Zé', item: 'agua', ts: 30, eventId: 'za' });
  applyEvent(s, { type: 'ADD', user: 'ze', name: 'Zé', item: 'agua', ts: 31, eventId: 'za2' });
  const ri = (id) => ({ id, price: 0, g: id === 'cerveja' ? 13 : id === 'dose' ? 15 : 0 });
  const aw = ceremonyAwards(s, ri, { log: [], now: 0 });
  const byId = Object.fromEntries(aw.map((a) => [a.id, a]));
  assert.strictEqual(byId.mvp.name, 'Bia');   // maior total, não-motorista
  assert.strictEqual(byId.agua.name, 'Zé');   // mais águas
  assert.strictEqual(byId.driver.name, 'André'); // motorista
  assert.ok(byId.ferro && byId.ferro.name === 'Bia'); // única com destilado
  ok('cerimônia: MVP, hidratado, motorista, cabeça de ferro');
}

// ---------- Jukebox (fila de músicas) ----------
{
  const s = emptyState();
  applyEvent(s, { type: 'SONG', user: 'a', name: 'André', title: 'Evidências', url: '', ts: 2, eventId: 's2' });
  applyEvent(s, { type: 'SONG', user: 'b', name: 'Bia', title: 'Tim Maia', url: 'x', ts: 1, eventId: 's1' });
  const q = songs(s);
  assert.strictEqual(q.length, 2);
  assert.strictEqual(q[0].title, 'Tim Maia'); // ordena por ts do pedido
  assert.strictEqual(q[1].name, 'André');
  assert.strictEqual(applyEvent(s, { type: 'SONG', user: 'c', title: '', ts: 3, eventId: 's3' }), false); // sem título é ignorado
  ok('jukebox: fila acumula e ordena por pedido');
}

console.log(`\n${passed} testes de features passaram ✅`);
