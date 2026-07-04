// Servidor do Botequei pra VM própria (Red Hat/CentOS, Debian, o que for) — UM arquivo,
// ZERO dependências (nada de npm install): Node 20+ e pronto. Faz tudo que o deploy simples
// precisa: serve os arquivos do app, a sinalização (polling E WebSocket) e o TURN.
//
//   node server/node.mjs                  # sobe em http://0.0.0.0:8000
//   PORT=8080 node server/node.mjs        # porta customizada
//   NO_WS=1 node server/node.mjs          # desliga o WebSocket (teste do fallback p/ polling)
//
// Produção: systemd + nginx/certbot na frente (HTTPS é obrigatório pra PWA/WebRTC) — o
// passo a passo completo, com SELinux e firewalld, está no README. O WebSocket aqui é
// RFC 6455 escrito à mão (handshake SHA-1 + frames com unmask), mantendo o espírito
// dependência-zero que o antigo signaling.php tinha.
//
// O CÉREBRO da sala (TTLs, caixa-postal, listas) vive em server/core.mjs — o MESMO núcleo
// que o Durable Object da Cloudflare usa. Mudou regra de protocolo? Muda lá, os dois herdam.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Room, clean, MAX_BODY } from './core.mjs';

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const PORT = Number(process.env.PORT) || 8000;
const HOST = process.env.HOST || '0.0.0.0';
const NO_WS = process.env.NO_WS === '1';

// ---- salas em memória (mesma auto-cura do velho /tmp: reinício = mesh re-oferta em ~10s) ----
const rooms = new Map();   // room -> Room (núcleo puro)
const sockets = new Map(); // room -> Map<peer, ws> — socket aberto É presença
const roomOf = (name) => { let r = rooms.get(name); if (!r) { r = new Room(); rooms.set(name, r); } return r; };
const socksOf = (name) => { let s = sockets.get(name); if (!s) { s = new Map(); sockets.set(name, s); } return s; };
const wsPeers = (name) => [...socksOf(name).keys()];
function sweep(now) { // coleta salas mortas de vez em quando (barato; roda a cada request)
  for (const [name, r] of rooms) {
    r.gc(now);
    if (r.idle(now, wsPeers(name)) && socksOf(name).size === 0) { rooms.delete(name); sockets.delete(name); }
  }
}

// entrega: socket aberto do destinatário → push na hora; senão → caixa-postal (poll pega)
function deliver(roomName, msg, now) {
  const sock = socksOf(roomName).get(msg.to);
  if (sock) { try { wsSend(sock, JSON.stringify({ t: 'msg', ...msg })); return; } catch { /* caiu: caixa */ } }
  roomOf(roomName).push(msg, now);
}
function broadcastPeers(roomName, now) {
  const r = roomOf(roomName);
  for (const [peer, sock] of socksOf(roomName)) {
    try { wsSend(sock, JSON.stringify({ t: 'peers', peers: r.peersFor(peer, now, wsPeers(roomName)) })); } catch { /* close cuida */ }
  }
}

// ---- HTTP: sinalização (mesmo contrato de sempre, agora em /signaling) + /turn ----
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};
const sendJSON = (res, data, code = 200) =>
  res.writeHead(code, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(data));

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > MAX_BODY) return {}; }
  try { const j = JSON.parse(raw); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}

async function signaling(req, res, url) {
  if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();
  const roomName = clean(url.searchParams.get('room'));
  if (roomName === '') return sendJSON(res, { error: 'room obrigatorio' }, 400);
  const now = Date.now();
  sweep(now);
  const room = roomOf(roomName);
  const action = url.searchParams.get('action') || '';
  const body = req.method === 'POST' ? await readBody(req) : {};

  if (action === 'join') {
    const peer = clean(body.peer);
    if (peer === '') return sendJSON(res, { error: 'peer obrigatorio' }, 400);
    room.touch(peer, now);
    broadcastPeers(roomName, now);
    return sendJSON(res, { ok: true, peers: room.peersFor(peer, now, wsPeers(roomName)) });
  }
  if (action === 'peers') return sendJSON(res, { peers: room.peersAll(now, wsPeers(roomName)) });
  if (action === 'send') {
    const from = clean(body.from), to = clean(body.to);
    const type = typeof body.type === 'string' ? body.type : '';
    if (from === '' || to === '' || type === '') return sendJSON(res, { error: 'from/to/type obrigatorios' }, 400);
    deliver(roomName, Room.msg(from, to, type, body.payload, now), now);
    return sendJSON(res, { ok: true });
  }
  if (action === 'poll') {
    const peer = clean(url.searchParams.get('peer'));
    if (peer === '') return sendJSON(res, { error: 'peer obrigatorio' }, 400);
    const isNew = !room.live(now, wsPeers(roomName)).has(peer);
    room.touch(peer, now);
    if (isNew) broadcastPeers(roomName, now); // avisa quem está de socket que chegou gente
    return sendJSON(res, { messages: room.drain(peer), peers: room.peersFor(peer, now, wsPeers(roomName)) });
  }
  if (action === 'leave') {
    const peer = clean(body.peer);
    if (peer !== '') { room.drop(peer); broadcastPeers(roomName, now); }
    return sendJSON(res, { ok: true });
  }
  return sendJSON(res, { error: 'acao desconhecida' }, 400);
}

// TURN: credenciais efêmeras da Cloudflare (a API é um HTTPS público — a VM chama igual).
// Sem os envs → 204 → o app cai pro STUN. A API responde 201; o cliente espera 200 → normaliza.
async function turn(res) {
  const keyId = process.env.CF_TURN_KEY_ID, token = process.env.CF_TURN_API_TOKEN;
  if (!keyId || !token) return res.writeHead(204).end();
  const ttl = parseInt(process.env.CF_TURN_TTL, 10) > 0 ? parseInt(process.env.CF_TURN_TTL, 10) : 86400;
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl }),
      signal: AbortSignal.timeout(5000),
    });
    const body = r.ok ? await r.text() : '';
    if (!body) return res.writeHead(204).end();
    return res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(body);
  } catch { return res.writeHead(204).end(); }
}

// ---- arquivos estáticos (papel que o php -S/Apache fazia) ----
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
// revalida sempre o que é shell (ES modules sem hash — mesma regra do _headers da Cloudflare)
const NO_CACHE = new Set(['.html', '.js', '.mjs', '.css', '.webmanifest']);
// o que NUNCA sai pela web (equivalente do antigo bloqueio no .htaccess)
const PRIVATE = /^\/(server|worker|tests|tools|node_modules|\.)|\.(jsonc|md|example)$|^\/(eslint\.config\.mjs|_headers|\.assetsignore|\.gitignore|package(-lock)?\.json)$/;

async function statics(req, res, url) {
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  if (PRIVATE.test(path) || path.includes('..')) return res.writeHead(404).end('não tem');
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) return res.writeHead(404).end('não tem');
  try {
    const st = await stat(file);
    if (st.isDirectory()) return statics(req, res, new URL(url.pathname + '/', url));
    const ext = extname(file).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': NO_CACHE.has(ext) ? 'no-cache' : 'public, max-age=604800',
    };
    if (req.method === 'HEAD') return res.writeHead(200, headers).end();
    res.writeHead(200, headers).end(await readFile(file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('não tem');
  }
}

// ---- WebSocket RFC 6455 na mão (só o que a sinalização precisa: texto, ping/pong, close) ----
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function wsSend(sock, text) { // frame de texto, FIN=1, sem máscara (servidor → cliente)
  const data = Buffer.from(text, 'utf8');
  let header;
  if (data.length < 126) header = Buffer.from([0x81, data.length]);
  else if (data.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(data.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(data.length), 2); }
  sock.write(Buffer.concat([header, data]));
}
function wsFrame(sock, opcode, payload = Buffer.alloc(0)) {
  sock.write(Buffer.concat([Buffer.from([0x80 | opcode, payload.length]), payload]));
}
// parser incremental: devolve frames completos {op, data} e guarda o resto no buffer
function wsParse(state, chunk) {
  state.buf = Buffer.concat([state.buf, chunk]);
  const out = [];
  for (;;) {
    const b = state.buf;
    if (b.length < 2) break;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) break; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) break; len = Number(b.readBigUInt64BE(2)); off = 10; }
    if (len > MAX_BODY) { out.push({ op: 8 }); break; }           // frame gigante: fecha
    const maskOff = off, dataOff = off + (masked ? 4 : 0);
    if (b.length < dataOff + len) break;                          // frame incompleto: espera
    const data = Buffer.from(b.subarray(dataOff, dataOff + len)); // cópia (o buf muda embaixo)
    if (masked) { const mask = b.subarray(maskOff, maskOff + 4); for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3]; }
    state.buf = b.subarray(dataOff + len);
    out.push({ op, data });
  }
  return out;
}

function wsUpgrade(req, sock, url) {
  const roomName = clean(url.searchParams.get('room'));
  const peer = clean(url.searchParams.get('peer'));
  const key = req.headers['sec-websocket-key'];
  if (NO_WS || roomName === '' || peer === '' || !key) { sock.destroy(); return; }
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock.setNoDelay(true);

  const now = Date.now();
  const room = roomOf(roomName);
  const socks = socksOf(roomName);
  const old = socks.get(peer);
  if (old) { try { wsFrame(old, 8); old.destroy(); } catch { /* já era */ } } // reconexão substitui
  socks.set(peer, sock);
  room.pres.delete(peer); // saiu do regime de polling: o socket é a presença agora
  wsSend(sock, JSON.stringify({ t: 'peers', peers: room.peersFor(peer, now, wsPeers(roomName)) }));
  for (const m of room.drain(peer)) wsSend(sock, JSON.stringify({ t: 'msg', ...m })); // recados da reconexão
  broadcastPeers(roomName, now);

  const state = { buf: Buffer.alloc(0) };
  const bye = () => {
    if (socks.get(peer) !== sock) return; // já foi substituído por reconexão
    socks.delete(peer);
    room.touch(peer, Date.now()); // vira presença por TTL (~15s) — reconexão não perde a vaga
    broadcastPeers(roomName, Date.now());
  };
  sock.on('data', (chunk) => {
    for (const f of wsParse(state, chunk)) {
      if (f.op === 8) { try { wsFrame(sock, 8); } catch { /* fechando */ } sock.destroy(); bye(); return; }
      if (f.op === 9) { wsFrame(sock, 10, f.data); continue; }    // ping → pong
      if (f.op !== 1) continue;                                    // só texto interessa
      const text = f.data.toString('utf8');
      if (text === 'ping') { wsSend(sock, 'pong'); continue; }     // keepalive do app
      let m; try { m = JSON.parse(text); } catch { continue; }
      const to = clean(m.to), type = typeof m.type === 'string' ? m.type : '';
      if (to === '' || type === '') continue;
      deliver(roomName, Room.msg(peer, to, type, m.payload, Date.now()), Date.now());
    }
  });
  sock.on('close', bye);
  sock.on('error', () => { sock.destroy(); bye(); });
}

// ---- sobe tudo ----
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.endsWith('/signaling')) return signaling(req, res, url);
  if (url.pathname.endsWith('/turn')) return turn(res);
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
  return statics(req, res, url);
});
server.on('upgrade', (req, sock) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.endsWith('/signaling')) wsUpgrade(req, sock, url);
  else sock.destroy();
});
server.listen(PORT, HOST, () => {
  console.log(`🍺 Botequei no ar: http://${HOST}:${PORT}  (WebSocket ${NO_WS ? 'DESLIGADO — modo teste' : 'ligado'})`);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
