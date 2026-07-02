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
  O `PROFILE` também leva o **nível** (liga) pra galera ver no placar. `SONG` (jukebox) **acumula**
  (não é LWW) — a fila de músicas da mesa.
- **Efeitos efêmeros (não entram no log)** via `mesh.sendFx` → `onFx`: brinde, reação, **roleta**
  ("quem paga a próxima" — o iniciador sorteia e manda `{entrants,winner}`, todos animam igual e
  convergem), **cutucar/desafiar** (`to`/`from`, só o alvo reage), **cerimônia** (mostrar troféus
  pra mesa), **chamar o garçom** (`waiter`), **rodada de água** (`water`) e **carta da mesa**
  (`card` — deck de desafios). Nada disso persiste.
- **Competição & coach (puro)**: `js/tournament.js` (placar acumulado por pessoa entre noites —
  pontos por aparecer + hidratar, não por beber mais), `js/deck.js` (cartas de desafio) e o coach
  em `js/stats.js` (`projectAt` = previsão de ritmo até a meia-noite, `coachTips`). Mãos livres:
  `devicemotion` soma +1 ao chacoalhar (settings `shake`).
- **Clima & cuidado**: `js/music.js` (trilha lo-fi **procedural** via WebAudio, sem arquivo — igual
  ao `sound.js` — + `spectrum()` pro visualizador do "modo festa"). "Cuida do fulano" deriva o ritmo
  de um peer do log compartilhado (`paceInfo`, sem expor BAC); "me leva pra casa" usa GPS → WhatsApp.
- **Presença ao vivo**: `render()` desenha a barra de avatares (self + peers, `mesh.peers()`);
  `onMeshChange` faz o diff de quem entrou/saiu (toast) e o placar mostra a qualidade da conexão
  por pessoa (host/srflx/relay). Tocar num nome no placar abre a **comanda** daquela pessoa.
- **Cardápio por categoria**: `catalog.js` (`cat` + `CATEGORIES`/`catOf`); itens custom levam
  `cat`/`note` no def do evento `ITEM` (⚠️ ao editar preço, faça `makeItem({...it, price})` pra
  não perder `g`/`cat`/`note`).
- **Consciência & estatísticas (puro)**: `js/stats.js` (ritmo, linha do tempo, teor alcoólico por
  Widmark — peso/sexo locais, **não é bafômetro** —, `lastDrinkAt`/`hydration`/`driveVerdict`) e
  `js/lifestats.js` (média/recorde/mês/favorita/streak + `monthlyTrend`/`weekdayInsight`/`retro`/
  `topMate`). Gramas de álcool no `catalog.js` (`g`). A tela "🛟 Tô de boa?" cruza BAC + última
  dose + hidratação e oferece chamar carro (Uber/99) / contato de confiança (WhatsApp).
- **Liga & desafios (puro)**: `js/league.js` — `levelFor` (XP = rodadas×10 + noites×30 → nível),
  `weeklyChallenges` (semana atual + noite em curso) e `seasonAward` (troféu do mês).
- **Modo bar**: `store.saveBarMenu`/`getBarMenu` guardam o cardápio (defs de `ITEM`) pra reusar;
  ao abrir "mesa do bar" com código fixo, o app re-emite os `ITEM` salvos.
- **Persistência:** só `localStorage` (`js/store.js`; histórico por mesa com meus itens, gasto,
  duração e **`mates`** — quem estava na mesa, p/ o "com quem você mais bebeu"; `exportAll`/
  `importAll` = backup JSON; `saveBarMenu`/`getBarMenu` = cardápio do bar). Nada central.
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
- `js/stats.js` — ritmo/linha do tempo/BAC/última dose/hidratação (puro) · `js/lifestats.js` — estatísticas de vida + streak + retrô (puro) · `js/league.js` — nível/XP/desafios/troféu (puro)
- `js/achievements.js` — badges, MVP e **cerimônia de troféus** (puro) · `js/share.js` — cards canvas (recap/conta/cerimônia/retrô)
- `js/sound.js` — efeitos (WebAudio) · `js/music.js` — trilha lo-fi procedural + espectro (WebAudio, fora do puro)
- `js/tournament.js` — placar acumulado da galera (puro) · `js/deck.js` — cartas de desafio (puro)
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
  cache** após atualizar assets. Os ES modules não têm hash no nome: se o CDN servir um `.js`
  velho junto de um novo, o app quebra com `does not provide an export named …`. Por isso o
  `.htaccess.example` manda `Cache-Control: no-cache` p/ html/js/css/sw (revalida sempre) e o
  `sw.js` faz `cache.add(new Request(u,{cache:'reload'}))` no install (fura o cache ao instalar).
- **BAC é estimativa local, não bafômetro** — sempre com o aviso de não dirigir; peso/sexo ficam só no aparelho.
- Ao mexer no `ui.js`, todo id novo precisa entrar no array `IDS` (senão `ui.init` quebra ao amarrar o listener).
- Ao adicionar `js/*.js` do shell, atualize a lista do `sw.js` **e** bump o `CACHE` (`botequei-vN`).
- O SW **não** chama `skipWaiting` no install: a versão nova espera o usuário tocar em "Atualizar"
  (o app manda `SKIP_WAITING` e recarrega no `controllerchange`). Só bump de `CACHE` dispara o aviso.
- Antes de commitar mudança de lógica, rode os unit (`reducer`/`features`/`stats`) e o `tests/e2e.mjs`.
