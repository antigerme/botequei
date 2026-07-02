// Handshake WebRTC "fora de banda" (sem servidor): serializa o offer/answer — com os
// ICE candidates ja embutidos no SDP — num texto curto que cabe num QR ou num copia-e-cola.
//
// É o que permite parear dois celulares SEM internet e SEM signaling.php: um mostra o
// código/QR do offer, o outro devolve o do answer. Depois disso o DataChannel abre e tudo
// (consumo, placar, conta) trafega P2P como sempre.
//
// Formato do texto:  "BQ" + versao + base64url(payload)
//   versao '1' -> payload deflate-raw (comprimido)   | '0' -> JSON puro (fallback)
// O blob interno: { v, t:'offer'|'answer', from, name, room?, sdp:{type,sdp} }.
//
// Modulo PURO e isomorfico (sem DOM): roda igual no navegador e no Node (testavel).

const MAGIC = 'BQ';

// ---- base64url <-> bytes (sem depender de Buffer; usa btoa/atob, globais no browser e no Node) ----
function bytesToBinary(bytes) {
  let s = '';
  const CHUNK = 0x8000; // evita estourar o stack no apply com arrays grandes
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return s;
}
function b64urlEncode(bytes) {
  return btoa(bytesToBinary(bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- deflate/inflate via Web Streams (CompressionStream e global no browser e no Node 18+) ----
async function squeeze(bytes, compress) {
  const S = compress
    ? new CompressionStream('deflate-raw')
    : new DecompressionStream('deflate-raw');
  const w = S.writable.getWriter();
  w.write(bytes); w.close();
  const chunks = [];
  const r = S.readable.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    chunks.push(value);
  }
  let n = 0; for (const c of chunks) n += c.length;
  const out = new Uint8Array(n);
  let p = 0; for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

// Objeto -> string curta (comprime quando o ambiente suportar; senao cai pro base64 do JSON).
export async function encodeBlob(obj) {
  const raw = enc.encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') {
    try { return MAGIC + '1' + b64urlEncode(await squeeze(raw, true)); }
    catch { /* cai pro fallback abaixo */ }
  }
  return MAGIC + '0' + b64urlEncode(raw);
}

// string -> objeto. Lanca se o texto nao for um código válido do Botequei.
export async function decodeBlob(str) {
  const s = String(str || '').trim();
  if (s.slice(0, 2) !== MAGIC || s.length < 4) throw new Error('código inválido');
  const flag = s[2];
  const bytes = b64urlDecode(s.slice(3));
  const raw = flag === '1' ? await squeeze(bytes, false) : bytes;
  const obj = JSON.parse(dec.decode(raw));
  if (!obj || typeof obj !== 'object') throw new Error('código inválido');
  return obj;
}
