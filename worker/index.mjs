// Worker da Cloudflare — a porta de entrada do adaptador CF. Papel de roteador, nada mais:
// /signaling vai pro Durable Object DA SALA (uma instância por mesa, worker/room-do.mjs);
// /turn troca os secrets por credenciais TURN efêmeras; o resto é asset estático (servido
// pela própria Cloudflare — com run_worker_first, só as duas rotas acordam o Worker).
// O contrato é IDÊNTICO ao do adaptador Node (server/node.mjs): mesmo cliente, mesma resposta.

import { clean, turnCredentials } from '../server/core.mjs';
import { RoomDO } from './room-do.mjs';
export { RoomDO };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};
const json = (data, code = 200) =>
  new Response(JSON.stringify(data), { status: code, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/signaling')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      const room = clean(url.searchParams.get('room'));
      if (room === '') return json({ error: 'room obrigatorio' }, 400);
      // idFromName: mesmo nome de sala ⇒ mesmo DO, no mundo todo — a "mesa" mora num lugar só
      return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request);
    }

    if (url.pathname.endsWith('/turn')) return turn(env);

    return env.ASSETS.fetch(request);
  },
};

// HMAC-SHA1 → base64 via WebCrypto (o Worker não tem node:crypto; o adaptador Node usa createHmac).
async function hmacBase64(secret, msg) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
  let s = ''; for (let i = 0; i < sig.length; i++) s += String.fromCharCode(sig[i]);
  return btoa(s);
}

// TURN: credenciais efêmeras. Duas fontes, nesta ORDEM (a 1ª configurada vence):
//   1) coturn SELF-HOSTED (sem lock-in): TURN_URL (var pública) + TURN_SECRET (secret) — a
//      credencial (HMAC-SHA1) sai daqui mesmo, sem chamar terceiro. TURN_TTL opcional.
//   2) Cloudflare Calls: CF_TURN_KEY_ID + CF_TURN_API_TOKEN (a API responde 201; o cliente
//      espera 200 → normaliza, mesmo ajuste do adaptador Node).
// Nenhuma configurada → 204 → o app cai pro STUN.
async function turn(env) {
  // 1) coturn no próprio servidor do André: mesmo padrão use-auth-secret do adaptador Node.
  if (env.TURN_URL && env.TURN_SECRET) {
    const creds = await turnCredentials(env.TURN_URL, env.TURN_SECRET, parseInt(env.TURN_TTL, 10), Date.now(), hmacBase64);
    return new Response(JSON.stringify(creds), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  // 2) Cloudflare Calls.
  const keyId = env.CF_TURN_KEY_ID, token = env.CF_TURN_API_TOKEN;
  if (!keyId || !token) return new Response(null, { status: 204 });
  const ttl = parseInt(env.CF_TURN_TTL, 10) > 0 ? parseInt(env.CF_TURN_TTL, 10) : 86400;
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl }),
      signal: AbortSignal.timeout(5000),
    });
    const body = r.ok ? await r.text() : '';
    if (!body) return new Response(null, { status: 204 });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch { return new Response(null, { status: 204 }); }
}
