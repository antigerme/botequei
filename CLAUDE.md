# CLAUDE.md — Botequei

Contador de consumo de boteco: **PWA mobile-first, peer-to-peer (WebRTC), sem servidor de
dados**. Cada celular registra consumo (+1 num toque, −1 no toque longo) e tudo sincroniza em
tempo real entre os navegadores. UI em **pt-BR**.

## Rodar / testar
- **Servidor local:** `php -S 0.0.0.0:8000` (serve tudo; precisa só de **PHP 8.x**, sem npm/banco).
- **Unit (reducer), sem dependências:** `node tests/reducer.test.mjs`
- **E2E (2–3 navegadores, WebRTC real):** `npm i playwright-core && node tests/e2e.mjs`
  (usa o Chromium do ambiente; variáveis `BASE` e `CHROME`).

## Arquitetura (essencial)
- **Sem framework, sem build.** HTML + CSS + JS puro (ES modules). Não introduzir bundler/toolchain.
- **WebRTC full-mesh** (`js/mesh.js`): cada peer conecta a todos. Anti-glare: quem tem `peerId`
  menor cria a offer. Sem hub central — resiliente à saída de qualquer um. **Reconexão
  automática**: heartbeat (`ping`) detecta queda; o iniciador re-oferta e o outro reconstrói ao
  receber a offer; `wake()` (chamado no `visibilitychange`/`online`) reconecta e re-sincroniza ao
  desbloquear a tela.
- **Sinalização** (`signaling.php` + `js/signaling.js`): PHP único, sem banco. Só troca SDP/ICE
  por polling HTTP com caixa-postal em arquivos temporários (TTL). Guarda só o id opaco do peer —
  nunca consumo/histórico/participantes. Sai do fluxo após o handshake.
- **Estado por eventos (CRDT PN-Counter)** (`js/events.js`): eventos imutáveis
  `{type,user,item,ts,eventId}`. Total = soma (comutativa → converge). Dedup por `eventId`.
  Anti-entropy no join (troca o log completo) + gossip (repassa eventos novos).
- **Persistência:** só `localStorage` (`js/store.js`). Nada central.
- **TURN opcional** (`turn.php`): credenciais efêmeras da Cloudflare, lidas de env var /
  `$_SERVER` (Apache `SetEnv`) / `.env`. Token **só no servidor**. Sem config → responde 204 → STUN.

## Mapa de arquivos
- `index.html` — shell (telas via seções `.screen`)
- `js/app.js` — orquestrador (log, dedup, render, fluxos criar/entrar, `loadIce()`)
- `js/mesh.js` — WebRTC full-mesh + reconexão automática (heartbeat/`wake()`) + indicador de conexão (host/srflx/relay via `getStats()`)
- `js/signaling.js` — cliente do `signaling.php` (polling)
- `js/events.js` — eventos + reducer (CRDT). **Mantém-se puro** (testável em Node, sem DOM/localStorage no topo)
- `js/ui.js` — telas, cards, gestos (+1 toque / −1 toque longo), vibração, modo bebedeira
- `js/store.js`, `js/identity.js`, `js/catalog.js`, `js/qr.js`, `js/vendor/qrcode.js` (lib MIT)
- `signaling.php`, `turn.php` — servidor mínimo (handshake / credenciais TURN)
- `tools/gen_icons.php` — gera os PNGs de `icons/` (build; **não expor na web**)
- `tests/` — `reducer.test.mjs` (unit) + `e2e.mjs` (Playwright)

## Convenções / gotchas
- **URLs sempre relativas** (`new URL('signaling.php', location.href)`, `fetch('turn.php')`,
  convite via `location.origin`). Nunca hardcodar `http(s)://` — mantém funcionando atrás de
  proxy HTTPS (Cloudflare) e sem mixed content.
- **Segredos nunca no git.** `.env` e `.htaccess` estão no `.gitignore`; use os `*.example`.
- **HTTPS obrigatório** em produção (SW/PWA/WebRTC); `localhost` é isento.
- **Não rodar `mod_pagespeed`** sobre o app (pode quebrar ES modules / service worker) — o
  `.htaccess.example` já desliga.
- **Deploy = copiar TODOS os arquivos, inclusive `icons/`.** Atrás do Cloudflare, **purgue o
  cache** após atualizar assets.
- Antes de commitar mudança de lógica, rode `node tests/reducer.test.mjs` e o `tests/e2e.mjs`.
