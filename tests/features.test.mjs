// Testes das features novas (sem dependencias): PIX, perfil/mesa (LWW), conquistas.
// Rodar: node tests/features.test.mjs

import assert from 'node:assert';
import { crc16, pixPayload } from '../js/pix.js';
import { emptyState, applyEvent, getProfile, tableInfo, isDriver, userMoney, happyHour } from '../js/events.js';
import { badgesFor, mvp } from '../js/achievements.js';
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

console.log(`\n${passed} testes de features passaram ✅`);
