# CLAUDE.md — Botequei

Contador de consumo de boteco: **PWA mobile-first, peer-to-peer (WebRTC), sem servidor de
dados**. Cada celular registra consumo (+1 num toque, −1 no toque longo) e tudo sincroniza em
tempo real entre os navegadores. UI em **pt-BR**.

## Rodar / testar
- **Servidor local:** `php -S 0.0.0.0:8000` (serve tudo; precisa só de **PHP 8.x**, sem npm/banco).
- **Unit, sem dependências:** `node tests/reducer.test.mjs`, `node tests/features.test.mjs` e
  `node tests/stats.test.mjs` (ritmo/BAC + estatísticas de vida).
- **E2E (2–3 navegadores, WebRTC real):** `npm i playwright-core && node tests/e2e.mjs`
  (usa o Chromium do ambiente; variáveis `BASE` e `CHROME`). Também `tests/e2e-reconnect.mjs`
  (reconexão), `tests/e2e-offline.mjs` (pareamento por QR/código com o signaling desligado) e
  `tests/e2e-features.mjs` (roleta sincronizada, cutucada, PAYFOR e estatísticas).

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
- **Fallback offline (sem servidor)** (`js/handshake.js` + `js/scan.js`): sem internet, o
  handshake WebRTC é trocado **fora de banda** por QR/copia-e-cola — offer/answer com os ICE
  candidates já embutidos (não-trickle; `iceServers: []` → host candidates de LAN/hotspot).
  Reaproveita o mesmo DataChannel/gossip/anti-entropy; 1 QR por pessoa (quem chega pareia com 1
  peer e converge). Peers manuais ficam fora da reconexão via signaling (re-pareia com novo QR).
- **Estado por eventos (CRDT PN-Counter)** (`js/events.js`): eventos imutáveis
  `{type,user,item,ts,eventId}`. Total = soma (comutativa → converge). Dedup por `eventId`.
  Anti-entropy no join (troca o log completo) + gossip (repassa eventos novos). LWW (ts→eventId)
  p/ ITEM/PROFILE/TABLE/HAPPYHOUR/nomes e **PAYFOR** ("eu pago pra fulano", chave `from\x00to`).
- **Efeitos efêmeros (não entram no log)** via `mesh.sendFx` → `onFx`: brinde, reação, **roleta**
  ("quem paga a próxima" — o iniciador sorteia e manda `{entrants,winner}`, todos animam igual e
  convergem), **cutucar/desafiar** (`to`/`from`, só o alvo reage), **cerimônia** (mostrar troféus
  pra mesa) e **chamar o garçom** (`waiter`). Nada disso persiste — é só show ao vivo.
- **Presença ao vivo**: `render()` desenha a barra de avatares (self + peers, `mesh.peers()`);
  `onMeshChange` faz o diff de quem entrou/saiu (toast) e o placar mostra a qualidade da conexão
  por pessoa (host/srflx/relay). Tocar num nome no placar abre a **comanda** daquela pessoa.
- **Cardápio por categoria**: `catalog.js` (`cat` + `CATEGORIES`/`catOf`); itens custom levam
  `cat`/`note` no def do evento `ITEM` (⚠️ ao editar preço, faça `makeItem({...it, price})` pra
  não perder `g`/`cat`/`note`).
- **Consciência & estatísticas (puro)**: `js/stats.js` (ritmo da última hora, linha do tempo e
  estimativa de teor alcoólico por Widmark — precisa de peso/sexo locais; **não é bafômetro**) e
  `js/lifestats.js` (média/recorde/mês/favorita/streak + conquistas de vida + `monthlyTrend`/
  `weekdayInsight`), derivados do log / do histórico local. Gramas de álcool no `catalog.js` (`g`).
- **Persistência:** só `localStorage` (`js/store.js`; histórico enxuto por mesa com meus itens,
  gasto e duração; `exportAll`/`importAll` fazem backup JSON). Nada central.
- **Acessibilidade**: diálogos com `role="dialog"`/foco preso/ESC (`setupA11y` em `ui.js`),
  `:focus-visible`, `prefers-reduced-motion` (corta confete/animações), rótulos ARIA.
- **TURN opcional** (`turn.php`): credenciais efêmeras da Cloudflare, lidas de env var /
  `$_SERVER` (Apache `SetEnv`) / `.env`. Token **só no servidor**. Sem config → responde 204 → STUN.

## Mapa de arquivos
- `index.html` — shell (telas via seções `.screen`)
- `js/app.js` — orquestrador (log, dedup, render, fluxos criar/entrar, `loadIce()`)
- `js/mesh.js` — WebRTC full-mesh + reconexão automática (heartbeat/`wake()`) + indicador de conexão (host/srflx/relay via `getStats()`)
- `js/signaling.js` — cliente do `signaling.php` (polling)
- `js/handshake.js` — codec do offer/answer offline (deflate + base64url; puro/isomórfico)
- `js/scan.js` — leitor de QR por câmera (BarcodeDetector + jsQR); só no fluxo offline
- `js/events.js` — eventos + reducer (CRDT, inclui PAYFOR). **Mantém-se puro** (testável em Node, sem DOM/localStorage no topo)
- `js/stats.js` — ritmo/linha do tempo/BAC (puro) · `js/lifestats.js` — estatísticas de vida + streak (puro)
- `js/achievements.js` — badges, MVP e **cerimônia de troféus** (puro) · `js/share.js` — cards canvas (recap/conta/cerimônia)
- `js/ui.js` — telas, cards, gestos (+1 toque / −1 toque longo), vibração, modo bebedeira, overlays (ritmo/roleta/cutucar/cerimônia/números/conta)
- `js/store.js`, `js/identity.js`, `js/catalog.js` (itens + gramas de álcool), `js/qr.js`, `js/vendor/qrcode.js` + `js/vendor/jsqr.js` (libs MIT; jsQR é lazy, fora do shell do SW)
- `signaling.php`, `turn.php` — servidor mínimo (handshake / credenciais TURN)
- `tools/gen_icons.php` — gera os PNGs de `icons/` (build; **não expor na web**)
- `tests/` — `reducer.test.mjs` + `features.test.mjs` + `stats.test.mjs` (unit) · `e2e.mjs` / `e2e-reconnect.mjs` / `e2e-offline.mjs` / `e2e-features.mjs` (Playwright)

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
- **BAC é estimativa local, não bafômetro** — sempre com o aviso de não dirigir; peso/sexo ficam só no aparelho.
- Ao mexer no `ui.js`, todo id novo precisa entrar no array `IDS` (senão `ui.init` quebra ao amarrar o listener).
- Ao adicionar `js/*.js` do shell, atualize a lista do `sw.js` **e** bump o `CACHE` (`botequei-vN`).
- O SW **não** chama `skipWaiting` no install: a versão nova espera o usuário tocar em "Atualizar"
  (o app manda `SKIP_WAITING` e recarrega no `controllerchange`). Só bump de `CACHE` dispara o aviso.
- Antes de commitar mudança de lógica, rode os unit (`reducer`/`features`/`stats`) e o `tests/e2e.mjs`.
