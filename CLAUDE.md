# CLAUDE.md — Botequei

Contador de consumo de boteco: **PWA mobile-first, peer-to-peer (WebRTC), sem servidor de
dados**. Cada celular registra consumo (+1 num toque, −1 no toque longo) e tudo sincroniza em
tempo real entre os navegadores. UI em **pt-BR** (com pt/en/es via `js/i18n.js`; toasts seguem
em pt-BR).

## Rodar / testar
- **Servidor local:** `php -S 0.0.0.0:8000` (serve tudo; precisa só de **PHP 8.x**, sem npm/banco).
- **Unit, sem dependências:** `node tests/reducer.test.mjs`, `node tests/features.test.mjs` e
  `node tests/stats.test.mjs` (ritmo/BAC + estatísticas de vida).
- **Auditoria estática (sem deps):** `node tests/audit.mjs` — confere grafo de import/export
  (arquivo existe **e** exporta o nome, evitando o "does not provide an export named …"), o shell
  do `sw.js` + `CACHE`, o array `IDS` do `ui.js` e as chaves de i18n. Descobre os arquivos
  sozinha (lê `js/` e `tests/`), então cresce junto do projeto.
- **E2E (2–3 navegadores, WebRTC real):** `npm i playwright-core && node tests/e2e.mjs`
  (usa o Chromium do ambiente; variáveis `BASE` e `CHROME`). Também `tests/e2e-reconnect.mjs`
  (reconexão), `tests/e2e-offline.mjs` (pareamento por QR/código com o signaling desligado) e
  `tests/e2e-features.mjs` (roleta sincronizada, cutucada, PAYFOR e estatísticas).
- **CI (GitHub Actions, `.github/workflows/ci.yml`):** em todo PR/push pro `main` roda **lint**
  (`node --check` + ESLint só de correção via `npx eslint .`, config em `eslint.config.mjs`),
  **auditoria** (`tests/audit.mjs`) + `php -l`, **unit** e **e2e**. Unit e e2e são
  **auto-descobertos**: qualquer `tests/*.test.mjs` (unit) e `tests/e2e*.mjs` (e2e) entram
  sozinhos — só seguir a convenção de nome ao criar um teste novo.

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
- **Efeitos efêmeros (não entram no log)** via `mesh.sendFx` → `onFx`. Os de **jogo** (dominó/
  purrinha) levam `mid` e são **repassados com dedup** (gossip via `gameFx`/`seenFx`) pra toda
  jogada chegar em todos mesmo se a malha não estiver completa (4 pessoas = 6 links); os demais
  (reações etc.) são disparo único. Tipos: brinde, reação, **roleta**
  ("quem paga a próxima" — o iniciador sorteia e manda `{entrants,winner}`, todos animam igual e
  convergem), **cutucar/desafiar** (`to`/`from`, só o alvo reage), **cerimônia** (mostrar troféus
  pra mesa), **chamar o garçom** (`waiter`), **rodada de água** (`water`) e **carta da mesa**
  (`card` — deck de desafios). Nada disso persiste.
- **Purrinha (jogo P2P honesto)** (`js/purrinha.js`, puro): sem "banca" central, cada um esconde a
  mão. **Três modos**, escolhidos por quem inicia (tela "como quer jogar?"): **por palitos (3-2-1)**
  — cada um começa com 3 palitos (estoque **público**; mão ≤ estoque, teto do palpite = soma dos
  estoques — todo peer valida no reveal); quem crava **descarta 1** e **fala primeiro na próxima**;
  quem zera **se livra**; o último com palitos paga (`sticksNext`/`poolsTotal`/`clampHandTo`);
  **clássica** — lacre só da mão por rodada (`makeHandCommit`), palpite **falado em turno** (girando
  a partir do starter, **sem repetir número** — `validGuessTo`/`guessOrder`), quem crava **se livra**
  e sai (`classicRound`/`nextRound`), o último paga; e **rápida** — 1 rodada, mão+palpite no mesmo
  lacre `SHA-256(mão:palpite:segredo)`, abre junto e quem chuta mais longe paga (`resolve`). Em
  todos, todo peer **confere** os lacres e **apura igual** (determinístico → converge). Fases fx:
  `invite`(+`mode`)/`commit`/`reveal` (rápida), `hcommit`/`guess`/`hreveal` (por turnos, com `rd` e
  buffer p/ fx adiantado)/`cancel`. Efêmero, não entra no log. Dropout não trava (portões re-checam
  no `onMeshChange`).
- **Dominó (jogo P2P)** (`js/domino.js`, puro): dobra-seis de boteco (sem compra). As **mãos são
  privadas** — o dono da mesa embaralha e entrega a mão de cada um **só pra ele** via canal direto
  (`mesh.sendTo(id, {k:'fx',fx})`, não pelo broadcast); as **jogadas são públicas** (`kind:'domino'`,
  fases `deal`/`play`/`pass`/`reveal`/`cancel`) e **todo peer valida** com `legalMoves`/`place` (o
  tabuleiro é reconstruído igual em todos). Bate quem esvazia a mão; se trancar (todos passam), cada
  um revela a mão e ganha a menor soma (`pipCount`). Trust: só o embaralho confia em quem dá as
  cartas (igual na vida real); durante a partida, trapaça não cola. Pedras desenhadas com pips no
  `ui.js` (carroça atravessada; tabuleiro quebra linha, sem scroll). Efêmero, não entra no log.
- **Mesa verificada** (opcional, `settings.domVerified`): endurece o embaralho do dominó com
  **commit-to-deck + corte coletivo** (`verifyDeal` em `domino.js`, puro/testado). Handshake antes
  do jogo (fases `vsetup`/`vseed`/`vgo`/`vseedrev`/`vdeal`/`vhand`): todos lacram um seed
  (commit-reveal) → o **corte coletivo** σ sai dos seeds; o dono lacra o baralho **antes** de ver σ
  (não mira num baralho favorável) e entrega cada mão com um lacre que o dono confere na hora. No
  fim (`vopen`/`vopenhand`), o baralho é revelado e **todos auditam** (lacre bate, é permutação das
  28, corte confere, mãos batem) — trapaça no deal é **pega** (badge 🔒✅/🚫). Só o dono ainda vê
  as mãos (tirar isso = mental poker, pesado demais). Jogadas de jogo vão por **gossip com dedup**
  (`gameFx`) pra chegar em todos mesmo com malha incompleta (4 pessoas = 6 links).
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
- **Alcance & cara**: `js/i18n.js` (dicionário pt/en/es + `t`/`applyI18n` sobre `[data-i18n]`/
  `[data-i18n-ph]` — só o shell; toasts seguem pt-BR); temas **auto/dark/light/neon/retro**
  (`resolveTheme`/`applyTheme` em `ui.js`, paletas via CSS vars em `body.neon`/`body.retro`);
  **molduras** de avatar por nível da liga (`frameClass` → `.fr-silver`/`.fr-gold`); **passaporte**
  de botecos (`store.getCheckins`/`addCheckin` — check-in local, GPS opcional, só no aparelho);
  **foto da noite** (só preview/compartilhar via Web Share — nada é salvo/enviado) e **guia de
  boas-vindas** no 1º uso (sem nome nem histórico e sem convite pendente).
- **Persistência:** só `localStorage` (`js/store.js`; histórico por mesa com meus itens, gasto,
  duração e **`mates`** — quem estava na mesa, p/ o "com quem você mais bebeu"; `exportAll`/
  `importAll` = backup JSON; `saveBarMenu`/`getBarMenu` = cardápio do bar;
  `getCheckins`/`addCheckin` = passaporte de botecos). Nada central.
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
- `js/purrinha.js` — jogo da purrinha: commit-reveal (SHA-256) + apuração determinística (puro)
- `js/domino.js` — jogo de dominó: baralho/deal/encaixe/abertura/bater/trancar (puro)
- `js/i18n.js` — dicionário pt/en/es + `applyI18n` sobre o shell (puro)
- `js/ui.js` — telas, cards, gestos (+1 toque / −1 toque longo), vibração, modo bebedeira, temas (auto/dark/light/neon/retro), i18n do shell, molduras por nível, overlays (ritmo/roleta/cutucar/cerimônia/números/conta/passaporte/foto/boas-vindas)
- `js/store.js`, `js/identity.js`, `js/catalog.js` (itens + gramas de álcool), `js/qr.js`, `js/vendor/qrcode.js` + `js/vendor/jsqr.js` (libs MIT; jsQR é lazy, fora do shell do SW)
- `signaling.php`, `turn.php` — servidor mínimo (handshake / credenciais TURN)
- `tools/gen_icons.php` — gera os PNGs de `icons/` (build; **não expor na web**)
- `tests/` — `reducer.test.mjs` + `features.test.mjs` + `stats.test.mjs` (unit) · `audit.mjs` (auditoria estática pura) · `e2e.mjs` / `e2e-reconnect.mjs` / `e2e-offline.mjs` / `e2e-features.mjs` (Playwright)
- `.github/workflows/ci.yml` — CI (lint/auditoria/unit/e2e; unit+e2e auto-descobertos) · `eslint.config.mjs` — ESLint só de correção (dev/CI; o app segue buildless)

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
- **i18n sempre em paridade**: ao adicionar/renomear uma chave `data-i18n`, atualize as **três** línguas
  (`pt`/`en`/`es`) em `js/i18n.js` — a auditoria (`tests/audit.mjs`, roda no CI) falha se alguma ficar de fora
  ou sobrar. Toasts e mensagens dinâmicas seguem **pt-BR** de propósito (fora do i18n do shell).
- Ao adicionar `js/*.js` do shell, atualize a lista do `sw.js` **e** bump o `CACHE` (`botequei-vN`).
- O SW **não** chama `skipWaiting` no install: a versão nova espera o usuário tocar em "Atualizar"
  (o app manda `SKIP_WAITING` e recarrega no `controllerchange`). Só bump de `CACHE` dispara o aviso.
- Antes de commitar mudança de lógica, rode os unit (`reducer`/`features`/`stats`) e o `tests/e2e.mjs`.
