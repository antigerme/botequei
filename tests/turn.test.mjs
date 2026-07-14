// Unit das credenciais TURN efêmeras (server/core.mjs `turnCredentials`) — o padrão coturn
// "use-auth-secret" (draft-uberti-behave-turn-rest) que deixa o André subir um TURN no PRÓPRIO
// servidor, sem depender da Cloudflare nem de terceiro nenhum. Relógio injetado (nada de sleep);
// o HMAC-SHA1 é o do node:crypto — o adaptador Node usa o MESMO, e o Worker usa WebCrypto, que
// produz o HMAC idêntico (RFC 2104), então este vetor trava os dois adaptadores.
import { turnCredentials } from '../server/core.mjs';
import { createHmac } from 'node:crypto';

let n = 0;
const ok = (cond, msg) => { if (!cond) { console.error('✗ ' + msg); process.exit(1); } console.log('  ✓ ' + msg); n++; };
const hmac = (s, m) => createHmac('sha1', s).update(m).digest('base64');

const SECRET = 'meu-segredo-do-coturn';
const NOW = 1_700_000_000_000; // ms → floor/1000 = 1_700_000_000 s

// ---- vetor determinístico: username = expiração unix; credential = base64(HMAC-SHA1(secret, username)) ----
{
  const c = await turnCredentials('turn:turn.exemplo.com:3478', SECRET, 3600, NOW, hmac);
  const srv = c.iceServers[0];
  ok(srv.username === '1700003600', 'username = floor(now/1000) + ttl (expiração unix em segundos)');
  ok(srv.credential === hmac(SECRET, '1700003600'), 'credential = base64(HMAC-SHA1(secret, username))');
  ok(Array.isArray(srv.urls) && srv.urls.length === 1 && srv.urls[0] === 'turn:turn.exemplo.com:3478', 'urls string vira array de 1');
  ok(Array.isArray(c.iceServers) && c.iceServers.length === 1, 'shape { iceServers:[{...}] } (o que o loadIce espera)');
}

// ---- ida-e-volta: a credencial FECHA contra o mesmo secret (o que o coturn faz no login) ----
{
  const s = (await turnCredentials('turn:h:3478', SECRET, 100, NOW, hmac)).iceServers[0];
  ok(hmac(SECRET, s.username) === s.credential, 'a credencial confere contra o secret certo');
  ok(hmac('outro-secret', s.username) !== s.credential, 'secret errado NÃO confere (credencial é específica do secret)');
}

// ---- múltiplas URLs por vírgula (turn: e turns:) viram lista; espaços aparados; array passa direto ----
{
  const c = await turnCredentials(' turn:h:3478 , turns:h:5349 ', SECRET, 3600, NOW, hmac);
  ok(c.iceServers[0].urls.length === 2 && c.iceServers[0].urls[1] === 'turns:h:5349', 'TURN_URL com vírgula vira várias urls, sem espaço');
  const c2 = await turnCredentials(['turn:a:3478', '', 'turns:b:5349'], SECRET, 3600, NOW, hmac);
  ok(c2.iceServers[0].urls.length === 2 && c2.iceServers[0].urls[0] === 'turn:a:3478', 'array de urls passa direto (sem os vazios)');
}

// ---- TTL torto cai no default de 1 dia (env bugado não deixa o peer sem TURN) ----
{
  const base = Math.floor(NOW / 1000);
  ok((await turnCredentials('turn:h', SECRET, NaN, NOW, hmac)).iceServers[0].username === String(base + 86400), 'ttl NaN → default 86400');
  ok((await turnCredentials('turn:h', SECRET, -5, NOW, hmac)).iceServers[0].username === String(base + 86400), 'ttl negativo → default 86400');
  ok((await turnCredentials('turn:h', SECRET, 0, NOW, hmac)).iceServers[0].username === String(base + 86400), 'ttl 0 → default 86400');
  ok((await turnCredentials('turn:h', SECRET, 7200.9, NOW, hmac)).iceServers[0].username === String(base + 7200), 'ttl fracionário é truncado');
}

console.log(`\n${n} asserts de credencial TURN (coturn use-auth-secret) passaram ✅`);
