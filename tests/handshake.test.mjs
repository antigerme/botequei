// Unit do codec do handshake (js/handshake.js): o sync comprimido do anti-entropy
// (deflateJSON/inflateJSON — novo) e, de bônus, o codec do QR offline (encodeBlob/decodeBlob).
// CompressionStream é global no Node 18+, então roda sem browser.
import { deflateJSON, inflateJSON, encodeBlob, decodeBlob } from '../js/handshake.js';

let n = 0;
const ok = (c, m) => { if (!c) { console.error('✗ ' + m); process.exit(1); } console.log('  ✓ ' + m); n++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// lote típico de anti-entropy (JSON repetitivo → comprime forte)
const batch = [];
for (let i = 0; i < 64; i++) batch.push({ type: 'ADD', user: 'peer-abcdef', item: 'chopp', ts: 1700000000000 + i, eventId: 'peer-abcdef-' + i });

{
  const z = await deflateJSON(batch);
  const raw = new TextEncoder().encode(JSON.stringify(batch));
  ok(z instanceof Uint8Array, 'deflateJSON devolve bytes (Uint8Array)');
  ok(z.length < raw.length / 3, `comprime forte o log repetitivo (${raw.length}→${z.length} bytes)`);
  ok(eq(await inflateJSON(z), batch), 'round-trip idêntico (deflate → inflate)');
}

// o receptor pega ArrayBuffer no DataChannel (dc.binaryType='arraybuffer'), não Uint8Array
{
  const z = await deflateJSON(batch);
  const ab = z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength);
  ok(ab instanceof ArrayBuffer && eq(await inflateJSON(ab), batch), 'inflateJSON aceita ArrayBuffer (o que chega no fio)');
}

// vazio e evento com foto grande (dataURL) round-trip sem perder nada
{
  ok(eq(await inflateJSON(await deflateJSON([])), []), 'array vazio round-trip');
  const withPhoto = [{ type: 'PROFILE', user: 'x', photo: 'data:image/jpeg;base64,' + 'A'.repeat(20000), ts: 1, eventId: 'x-1' }];
  ok(eq(await inflateJSON(await deflateJSON(withPhoto)), withPhoto), 'evento com foto grande (20k) round-trip');
}

// bônus: o codec do QR offline (encodeBlob/decodeBlob) segue redondo
{
  const blob = { v: 1, t: 'offer', from: 'p', room: 'MESA1', sdp: { type: 'offer', sdp: 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\n' } };
  ok(eq(await decodeBlob(await encodeBlob(blob)), blob), 'encodeBlob/decodeBlob round-trip (QR offline)');
  let threw = false; try { await decodeBlob('lixo não-BQ'); } catch { threw = true; }
  ok(threw, 'decodeBlob rejeita texto que não é código do Botequei');
}

console.log(`\n${n} asserts do handshake (sync comprimido + QR offline) passaram ✅`);
