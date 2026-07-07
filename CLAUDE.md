# CLAUDE.md — Botequei

Contador de consumo de boteco: **PWA mobile-first, peer-to-peer (WebRTC), sem servidor de
dados**. Cada celular registra consumo (+1 num toque, −1 no toque longo) e tudo sincroniza em
tempo real entre os navegadores. UI **100% traduzível** (pt/en/es via `js/i18n.js`; idioma
padrão Auto segue o navegador).

## Regras de ouro (valem pra TODA mudança, sem exceção)
- **GUI/UX primeiro**: sempre buscar a melhor experiência — mobile-first, mínimo de toques,
  preview ao vivo, feedback imediato. Ação óbvia > botão extra (ex.: tocar num emoji volta
  pro emoji — não precisa de botão "voltar"). Overlays seguem o padrão `.sheet`; antes de
  commitar, pergunte "como isso fica MELHOR pro usuário?".
- **i18n sempre**: TODA string de UI (shell, toasts, templates, aria, placeholder) nasce em
  `js/i18n.js` nas TRÊS línguas via `t(chave)`. Removeu UI? Remova as chaves órfãs. A
  auditoria trava paridade no CI — detalhes na seção de convenções.
- **Consistência em tudo**: a mesma feature aparece em TODOS os pontos de entrada — menu "…"
  ↔ grid de jogos ↔ atalhos da mesa (já escapou o Truco do menu uma vez). Adicionou
  jogo/feature/tela? VARRA os pontos de entrada e os padrões visuais (mesmos botões, mesmos
  gestos, mesmas molduras). Grep é seu amigo. E rótulo repetido tem UMA fonte de verdade:
  os jogos usam as chaves `*.title` tanto no menu quanto no grid (já escapou um
  "🂠 🂠 Truco" quando cada lado carregava o próprio emoji) — o e2e-liso compara
  menu ↔ grid e trava divergência no CI.
- **Não perder o que já temos**: cada evolução PRESERVA o que existe — rode unit + audit +
  a suíte e2e antes de commitar; toda feature nova ganha assert de e2e (auto-descoberto);
  nunca remover/alterar comportamento existente sem pedido explícito; mexeu em algo
  compartilhado (helper, evento, CSS), grep quem mais usa e confira um a um.

## Rodar / testar
- **Servidor local:** `node server/node.mjs` (serve tudo; precisa só de **Node 18+**, sem
  npm/banco; envs `PORT`/`HOST`, `NO_WS=1` desliga o WebSocket pra testar o fallback).
- **Alvo Cloudflare local:** `npx wrangler dev --persist-to ../wrangler-state` (workerd em
  `:8787`, sem conta; o `--persist-to` FORA do repo é obrigatório — assets na raiz + estado
  do miniflare dentro dela = loop infinito de reload do watcher).
- **Unit, sem dependências:** `node tests/reducer.test.mjs`, `node tests/features.test.mjs`,
  `node tests/stats.test.mjs` (estatísticas de vida + liga + catálogo) e `node tests/core.test.mjs`
  (núcleo da sala de sinalização).
- **Auditoria estática (sem deps):** `node tests/audit.mjs` — confere grafo de import/export
  (arquivo existe **e** exporta o nome, evitando o "does not provide an export named …"), o shell
  do `sw.js` + `CACHE`, o array `IDS` do `ui.js` e as chaves de i18n. Descobre os arquivos
  sozinha (lê `js/` e `tests/`), então cresce junto do projeto.
- **E2E (2–3 navegadores, WebRTC real):** `npm i playwright-core && node tests/e2e.mjs`
  (usa o Chromium do ambiente; variáveis `BASE` e `CHROME`). Também `tests/e2e-ws.mjs`
  (transporte: default asserta WebSocket; `EXPECT_POLL=1` contra servidor `NO_WS=1` asserta o
  fallback; inclui interop socket↔polling), `tests/e2e-reconnect.mjs` (reconexão),
  `tests/e2e-offline.mjs` (pareamento por QR/código com o signaling desligado) e
  `tests/e2e-features.mjs` (cardápio da mesa, PAYFOR e estatísticas).
- **CI (GitHub Actions, `.github/workflows/ci.yml`):** em todo PR/push pro `main` roda **lint**
  (`node --check` + ESLint só de correção via `npx eslint .`, config em `eslint.config.mjs`),
  **auditoria** (`tests/audit.mjs`), **unit** e **e2e em DOIS alvos**: servidor Node (suíte
  completa + fallback `NO_WS`) e `wrangler dev` (amostra e2e + e2e-ws + e2e-features). Unit e
  e2e são **auto-descobertos**: qualquer `tests/*.test.mjs` (unit) e `tests/e2e*.mjs` (e2e)
  entram sozinhos — só seguir a convenção de nome ao criar um teste novo.

## Arquitetura (essencial)
- **Sem framework, sem build.** HTML + CSS + JS puro (ES modules). Não introduzir bundler/toolchain.
- **WebRTC full-mesh** (`js/mesh.js`): cada peer conecta a todos. Anti-glare: quem tem `peerId`
  menor cria a offer. Sem hub central — resiliente à saída de qualquer um. **Reconexão
  automática**: heartbeat (`ping`) detecta queda; o iniciador re-oferta e o outro reconstrói ao
  receber a offer; `wake()` (chamado no `visibilitychange`/`online`) reconecta e re-sincroniza ao
  desbloquear a tela.
- **Sinalização** (rota `/signaling`): só troca SDP/ICE; guarda só o id opaco do peer — nunca
  consumo/histórico/participantes — e sai do fluxo após o handshake. **Um núcleo, dois
  adaptadores**: as regras da sala (presença TTL 15s, caixa-postal FIFO 120s com entrega
  exatamente-1×, `clean()` de ids) vivem PURAS em `server/core.mjs` (testadas em
  `tests/core.test.mjs`); em volta, `server/node.mjs` (VM: um arquivo, zero deps, estáticos +
  WebSocket RFC 6455 à mão) e `worker/` (Cloudflare: Worker roteador + **Durable Object por
  sala** com Hibernation API — socket aberto É presença; alarms só pro próximo vencimento).
  **Mudou o contrato? Mexa no núcleo** — os dois herdam; e2e (Node) + e2e-cf (wrangler) pegam
  divergência. O cliente (`js/signaling.js`) começa por polling e **promove a WebSocket** na
  mesma rota (abriu → poll pausa e o servidor empurra; caiu → poll religa NA HORA + retry
  2s→30s; `poke()` tem watchdog de 3s contra socket zumbi pós-sono). Interop garantida: peer
  de socket e peer de polling convivem na mesma sala (entrega = socket aberto do destinatário
  OU caixa-postal que o poll drena).
- **Fallback offline (sem servidor)** (`js/handshake.js` + `js/scan.js`): sem internet, o
  handshake WebRTC é trocado **fora de banda** por QR/copia-e-cola — offer/answer com os ICE
  candidates já embutidos (não-trickle; `iceServers: []` → host candidates de LAN/hotspot).
  Reaproveita o mesmo DataChannel/gossip/anti-entropy; 1 QR por pessoa (quem chega pareia com 1
  peer e converge). Peers manuais ficam fora da reconexão via signaling (re-pareia com novo QR).
- **Estado por eventos (CRDT PN-Counter)** (`js/events.js`): eventos imutáveis
  `{type,user,item,ts,eventId}`. Total = soma (comutativa → converge). Dedup por `eventId`.
  Anti-entropy no join (troca o log completo, em **lotes de 64 eventos** — mensagem única
  estouraria o teto do DataChannel com o log grande) + gossip (repassa eventos novos). LWW (ts→eventId)
  p/ ITEM/PROFILE/TABLE/HAPPYHOUR/nomes e **PAYFOR** ("eu pago pra fulano", chave `from\x00to`).
  O `PROFILE` também leva o **nível** (liga) e a **foto** (miniatura 128px, dataURL ≤20k chars,
  validada por `cleanPhoto` na entrada E na saída do fio — emoji é o fallback eterno). `SONG` (jukebox) **acumula**
  (não é LWW) — a fila de músicas da mesa.
- **Efeitos efêmeros (não entram no log)** via `mesh.sendFx` → `onFx`. Os de **jogo** (dominó/
  purrinha) levam `mid` e são **repassados com dedup** (gossip via `gameFx`/`seenFx`) pra toda
  jogada chegar em todos mesmo se a malha não estiver completa (4 pessoas = 6 links); os demais
  (reações etc.) são disparo único. Tipos: brinde, reação, **cerimônia** (mostrar troféus
  pra mesa) e **chamar o garçom** (`waiter`). Nada disso persiste.
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
  no `onMeshChange`). **Piscada ≠ saiu**: a malha derruba `rec.ready` NA HORA numa piscada de rede
  (tela apaga, wifi↔4G), então o portão da rodada usa `purrOnline` com **graça** (`PURR_GRACE_MS`,
  `purrSeenAt`) — presente-mas-piscou segura o portão (senão avançava sem o lacre dele e as pontas
  divergiam); saiu de verdade cai depois da graça (`armPurrGrace` re-checa quando ela vence).
- **Dominó (jogo P2P)** (`js/domino.js`, puro): dobra-seis de boteco (sem compra). As **mãos são
  privadas** — o dono da mesa embaralha e entrega a mão de cada um **só pra ele** via canal direto
  (`mesh.sendTo(id, {k:'fx',fx})`, não pelo broadcast); as **jogadas são públicas** (`kind:'domino'`,
  fases `deal`/`play`/`pass`/`skip`/`reveal`/`noshow`/`cancel`) e **todo peer valida** com
  `legalMoves`/`place` (o tabuleiro é reconstruído igual em todos). Bate quem esvazia a mão; se
  trancar (todos passam), cada um revela a mão e ganha a menor soma (`pipCount`). **Ausente não
  trava**: dono da vez offline por 20s → o peer online de menor id emite `skip` (vira passe; aceito
  só se a vez ainda é dele → converge); tranca sem a mão de quem caiu → `noshow` apura entre as
  abertas; auditoria/handshake têm teto (badge "incompleta" / dono re-embaralha). Trust: só o
  embaralho confia em quem dá as cartas (igual na vida real); durante a partida, trapaça não cola.
  Pedras desenhadas com pips no `ui.js`. O tabuleiro é uma **SERPENTINA de mesa real**
  (`snakeLayout` em `domino.js`, PURA/testada, sem DOM): pedras **coladas** casando pip (deitadas;
  indo pra esquerda vão `flip`), **buchas ATRAVESSADAS** (em pé, a linha passa reto — nunca ramifica,
  é bloco/dobra-seis), e a cobra **vira a quina descendo com 2 pedras em pé** — **bucha nunca vira
  quina** (entra reto antes). Cresce **↓ no retrato / → na paisagem**; escala só como último recurso
  (mesa cheíssima) pra nunca ficar ilegível. O `ui.js` posiciona as pedras em absoluto a partir do
  `snakeLayout` e re-flui no resize/rotação (`domFitBoard`); o unit `snakeLayout` trava a geometria
  (24 pedras, sem sobrepor, buchas em pé, retrato mais alto que paisagem) e o e2e confere a virada de
  quina num celular.
  Efêmero, não entra no log — e **fechar (✕) só minimiza**: o jogo segue, um pill na mesa traz de
  volta; encerrar pra todos é botão explícito com confirmação (o `cancel` leva `from` → toast diz
  quem encerrou). Consumo/conta de quem saiu não mudam: eventos são CRDT permanentes (a pessoa
  segue na conta; PAYFOR cobre; voltando no mesmo aparelho, reassume a identidade).
- **Mesa verificada** (sempre ativa — o dominó abre direto nela; as regras do jogo não mudam,
  só o embaralho é auditável): endurece o embaralho do dominó com
  **commit-to-deck + corte coletivo** (`verifyDeal` em `domino.js`, puro/testado). Handshake antes
  do jogo (fases `vsetup`/`vseed`/`vgo`/`vseedrev`/`vdeal`/`vhand`): todos lacram um seed
  (commit-reveal) → o **corte coletivo** σ sai dos seeds; o dono lacra o baralho **antes** de ver σ
  (não mira num baralho favorável) e entrega cada mão com um lacre que o dono confere na hora. No
  fim (`vopen`/`vopenhand`), o baralho é revelado e **todos auditam** (lacre bate, é permutação das
  28, corte confere, mãos batem) — trapaça no deal é **pega** (badge 🔒✅/🚫). Só o dono ainda vê
  as mãos (tirar isso = mental poker, pesado demais). Jogadas de jogo vão por **gossip com dedup**
  (`gameFx`) pra chegar em todos mesmo com malha incompleta (4 pessoas = 6 links).
- **Truco (jogo P2P, 3 variantes)** (`js/truco.js` puro + protocolo no `app.js`): partida de
  placar corrido (12/24) em MÃOS; cada mão tem embaralho do dealer da vez com commit do
  baralho + corte coletivo (seeds commit-reveal, fases `thseal`/`thseed`/`thgo`/`thseedrev`)
  e **lacre POR CARTA** (`tdeal` publica commits por posição; a mão vai privada via `sendTo`
  em `thand`; cada `tplay` revela {carta,salt} e TODO peer valida na hora). Apostas por
  `traise`/`tresp`/`trespclose` (o PROPONENTE fecha após graça de 1,2s no 2v2 — resposta da
  dupla é CRDT max: fold<accept<raise). Mão de onze/dez via `tonze` (só o time da regra).
  Fim de partida: `topen` abre master+baralho de cada mão e todos auditam (badge 🔒✅/🚫).
  `tcancel` com `from`; ✕ minimiza (pill, padrão dos outros jogos). Estado da mão =
  reducer determinístico do motor (`reduceT`) — evento fora de hora morre igual em todos.
  Gaúcha completa: ENVIDO/REAL ENVIDO/FLOR na 1ª vaza (`tenvido`/`trealenvido`/`tenvresp`/
  `tflor`); aceite → cada um AUTO-DECLARA os pontos (`tenvpoints`, sem input) e o placar anda;
  a PROVA sai na auditoria do fim: a declaração é conferida contra a mão realmente dada
  (cantou o que a mão não sustenta → 🚫 com nome).
- **Bots / turma virtual** (`js/bots.js` puro + condutor no `app.js`): pra jogar sozinho no bar
  esperando a turma chegar. Um bot é um **peer LOCAL** — quem INICIA o jogo (`iHost`) hospeda os
  bots no próprio aparelho e emite as jogadas deles pelo MESMO protocolo fx (commit-reveal, lacre
  por carta, auditoria); solo é o caso degenerado (mesh com zero peers, fx aplicado localmente).
  Elenco FIXO (`BOT_ROSTER`: Zé da Esquina/Seu Bigode/Dona Cida/Careca — ids `bot-*`, pt-BR como o
  deck; `profOf` resolve do elenco, todo aparelho igual, zero sync). Cérebros PUROS por jogo (rng
  semeável): purrinha (mão triangular + palpite que foge de repetido), dominó (descarta peso/segura
  número escasso), truco (força por `cardPower`; cobre barato/sacrifica; aceita/corre/blefa).
  Condutor central: `botDelay` (agenda com delay humano 0,9–2,6s, dedup por chave) + `botsXxxAct()`
  chamado após cada mudança de estado (olha a fase, joga a vez do bot). **No dominó/truco o host dá
  as cartas mesmo quando o dealer da vez é bot** (guarda as mãos deles em memória, nunca saem do
  fio; pré-lacra os seeds do handshake) — `truActDealer`/`dvSeedGate`. Bot NÃO bebe, não entra em
  conta/presença/estatística: só existe DENTRO do jogo (checks `isBot` em `purrOnline`/`domOnlineIds`/
  `truOnlineHas` o tratam como sempre-online → dropout não trava). ⚠️ `pend.resp`/`envido.resp` do
  truco são chaveados por ID de jogador (não por time). Pra CHECAR se o time respondeu, `order.some`
  basta; mas pra AGENDAR o(s) bot(s) do envido no 2v2, agende **TODO** bot do time que ainda não
  respondeu (o motor fecha o fold só com as DUAS respostas — `order.forEach`, não `find` do 1º; senão
  a mão trava). `botsTrucoAct` também roda no `onMeshChange` (re-age quando a presença muda), como
  purrinha/dominó. Setup: chip "🤖 Chamar a turma" (0–3) em cada jogo; sozinho já vem 1.
- **Mãos livres (puro)**: `devicemotion` soma +1 ao chacoalhar o celular (settings `shake`).
- **Clima**: `js/music.js` (trilha lo-fi **procedural** via WebAudio, sem arquivo — igual
  ao `sound.js` — + `spectrum()` pro visualizador do "modo festa").
- **Presença ao vivo**: `render()` desenha a barra de avatares (self + peers, `mesh.peers()`);
  `onMeshChange` faz o diff de quem entrou/saiu com **histerese** (`diffPresence`): quem some entra
  em 45s de graça (fica 💤 esmaecido na barra, sem toast) — tela apagada/elevador não vira "saiu";
  só depois da graça toasta "👋 saiu" (e "🙌 voltou" na volta); "entrou!" só na 1ª vez da sessão.
  O placar mostra a qualidade da conexão por pessoa (host/srflx/relay). Tocar num nome no placar
  abre a **comanda** daquela pessoa.
- **Cardápio por categoria**: `catalog.js` (`cat` + `CATEGORIES`/`catOf`); itens custom levam
  `cat`/`note` no def do evento `ITEM` (⚠️ ao editar preço, faça `makeItem({...it, price})` pra
  não perder `g`/`cat`/`note`/`share`). **Itens compartilhados** (`share:1` — garrafa 600
  [id `cerveja`, mantido por compat], litrão, torre): pedido é DA MESA — g=0 (não entra nas
  estatísticas de quem tocou), dinheiro vai pro bolo (`sharePool`) e racheia na conta via `shareSplit`
  (puro: motorista fora por padrão, toggle "todos", fallback se só tem motorista; a caixinha
  da conta tira qualquer um do racha). **Garrafa com dono** (`payer` no evento ADD/REMOVE):
  perdeu o jogo ou bancou a rodada → a unidade SAI do bolo (`sharePool` exclui) e cai
  inteira na conta do pagador (`userMoney` soma; `paidCount` pro detalhe). O contador da
  mesa NÃO muda. Entradas: menu "💸 Pagar uma rodada" e toast no aparelho do PERDEDOR
  (purrinha ×3, dominó 2p, truco — é oferta, não automação; sem item da mesa no cardápio,
  não oferece). **SEM contagem de copo** — contar copo é mesquinharia
  (decisão de produto): o card compartilhado é só o contador DA MESA; consumo pessoal vem só
  de item individual. O item `copo` (`cup:1`) segue no catálogo APENAS por compat de mesas
  antigas (nada o emite; `isCup` filtra de cards/rodada/editor; `tableTotal` segue excluindo
  `cup` pra log velho não contar dobrado). `userTotal`/`userMoney`/`summary` aceitam
  `resolveItem` e excluem share do pessoal.
  **Cardápio da mesa** (ex-"Preços", `menu-prices`): cada item aceita **marca/apelido**
  (`brand` no def, LWW — `itemLabel` prioriza) e **esconder** (`off` no def — cards/rodada/
  contador gigante filtram; a lista do editor mostra esmaecido pra reativar; contagens e
  conta não mudam). Duas marcas do mesmo formato ao mesmo tempo = criar item custom.
  **A mesa nasce LIMPA (e o ➕ também)**: SEM chips de sugestão em lugar nenhum — a tela
  vazia mostra só o convite + botão "➕ Montar o cardápio", e o overlay ➕ item abre DIRETO
  no formulário (Nome já focado; todo item nasce dali, com "da mesa" pro compartilhado).
  `DEFAULT_ITEMS` segue como DADO de compat — `resolveItem`/rótulos `t('item.'+id)` pra
  mesas antigas, modo bar e afins — não como UI. `allItems` só devolve item com def no
  state OU contagem > 0 (a 2ª regra preserva mesas antigas e rodada de item que o peer não
  tinha). Com o 1º item no cardápio o convite some e o "+ item" assume; o passo 1 do tour
  aponta pro botão quando não há cards.
- **Estatísticas de vida (puro)**: `js/lifestats.js` (média/recorde/mês/favorita/streak +
  `monthlyTrend`/`weekdayInsight`/`retro`/`topMate`) — a tela "📊 Meus números". Gramas de álcool
  no `catalog.js` (`g`, usado só pra marcar item alcoólico na rodada/exclusão do motorista).
- **Liga & desafios (puro)**: `js/league.js` — `levelFor` (XP = rodadas×10 + noites×30 → nível),
  `weeklyChallenges` (semana atual + noite em curso) e `seasonAward` (troféu do mês).
- **Modo bar**: `store.saveBarMenu`/`getBarMenu` guardam o cardápio (defs de `ITEM`) pra reusar;
  ao abrir "mesa do bar" com código fixo, o app re-emite os `ITEM` salvos.
- **Alcance & cara**: `js/i18n.js` (dicionário pt/en/es COMPLETO — shell, toasts e templates —
  com `t(chave, vars)` interpolando `{name}`/`{n}` e `applyI18n` sobre `[data-i18n]`/
  `[data-i18n-ph]`/`[data-i18n-aria]`/`[data-i18n-title]`/`[data-i18n-html]`; idioma padrão
  **auto** pelo navegador); temas **auto/dark/light/neon/retro**
  (`resolveTheme`/`applyTheme` em `ui.js`, paletas via CSS vars em `body.neon`/`body.retro`);
  **molduras** de avatar por nível da liga (`frameClass` → `.fr-silver`/`.fr-gold`); **passaporte**
  de botecos (`store.getCheckins`/`addCheckin` — check-in local, GPS opcional, só no aparelho);
  **foto da noite** (só preview/compartilhar via Web Share — nada é salvo/enviado); **guia de
  boas-vindas** no 1º uso (sem nome/histórico/convite; 1× só — flag `welcomeSeen` no
  `store.getFlag`/`setFlag`) e **tour guiado** de 4 paradas na 1ª mesa (`ui.startTour`, flag
  `tourSeen`; spotlight + balão, avança no toque, "pular" sempre à mão).
- **Persistência:** só `localStorage` (`js/store.js`; histórico por mesa com meus itens, gasto,
  duração e **`mates`** — quem estava na mesa, p/ o "com quem você mais bebeu"; `exportAll`/
  `importAll` = backup JSON; `saveBarMenu`/`getBarMenu` = cardápio do bar;
  `getCheckins`/`addCheckin` = passaporte de botecos). Nada central.
- **Acessibilidade**: diálogos com `role="dialog"`/foco preso/ESC (`setupA11y` em `ui.js`),
  `:focus-visible`, `prefers-reduced-motion` (corta confete/animações), rótulos ARIA.
- **TURN opcional** (rota `/turn`, nos dois adaptadores): credenciais efêmeras da Cloudflare,
  lidas dos envs `CF_TURN_KEY_ID`/`CF_TURN_API_TOKEN`/`CF_TURN_TTL` (VM: `Environment=` do
  systemd; CF: Secrets do painel/`wrangler secret put`). Token **só no servidor**. Sem config →
  204 → STUN. A API responde **201** e o `loadIce()` espera 200 → os adaptadores normalizam.

## Mapa de arquivos
- `index.html` — shell (telas via seções `.screen`)
- `js/app.js` — orquestrador (log, dedup, render, fluxos criar/entrar, `loadIce()`)
- `js/mesh.js` — WebRTC full-mesh + reconexão automática (heartbeat/`wake()`) + indicador de conexão (host/srflx/relay via `getStats()`)
- `js/signaling.js` — cliente da rota `/signaling` (polling + promoção a WebSocket com fallback)
- `js/handshake.js` — codec do offer/answer offline (deflate + base64url; puro/isomórfico)
- `js/scan.js` — leitor de QR por câmera (BarcodeDetector + jsQR); só no fluxo offline
- `js/events.js` — eventos + reducer (CRDT, inclui PAYFOR). **Mantém-se puro** (testável em Node, sem DOM/localStorage no topo)
- `js/lifestats.js` — estatísticas de vida + streak + retrô (puro) · `js/league.js` — nível/XP/desafios/troféu (puro)
- `js/achievements.js` — badges, MVP e **cerimônia de troféus** (puro) · `js/share.js` — cards canvas (recap/conta/cerimônia/retrô; recap e conta desenham a FOTO de perfil redonda quando tem)
- `js/sound.js` — efeitos (WebAudio) · `js/music.js` — trilha lo-fi procedural + espectro (WebAudio, fora do puro)
- `js/purrinha.js` — jogo da purrinha: commit-reveal (SHA-256) + apuração determinística (puro)
- `js/truco.js` — motor do truco (paulista/mineira/gaúcha, puro): hierarquias, vazas com parda e cascata, escadas de aposta (TRUCO→…), `mergeResponses` (resposta da dupla, CRDT max), mão de onze/dez/ferro, envido/flor, deal lacrado POR CARTA (`cardSalt`/`cardCommitT`/`verifyPlayReveal`/`verifyHandAudit`) e reducer determinístico `newTrucoHand`/`reduceT` (protocolo/UI chegam no T2)
- `js/domino.js` — jogo de dominó: baralho/deal/encaixe/abertura/bater/trancar (puro)
- `js/bots.js` — turma virtual: elenco fixo + cérebros puros (purrinha/dominó/truco, rng semeável) + delay humano — o condutor mora no `app.js`
- `js/i18n.js` — dicionário pt/en/es + `applyI18n` sobre o shell (puro)
- `js/ui.js` — telas, cards, gestos (+1 toque / −1 toque longo), vibração, modo bebedeira, temas (auto/dark/light/neon/retro), i18n do shell, molduras por nível, overlays (cerimônia/números/conta/passaporte/foto/boas-vindas)
- `js/store.js`, `js/identity.js`, `js/catalog.js` (itens + gramas de álcool), `js/qr.js`, `js/vendor/qrcode.js` + `js/vendor/jsqr.js` (libs MIT; jsQR é lazy, fora do shell do SW)
- `server/core.mjs` — NÚCLEO puro da sala de sinalização (presença TTL + caixa-postal + `clean`; compartilhado pelos dois adaptadores) · `server/node.mjs` — adaptador VM (estáticos + `/signaling` polling+WS + `/turn`; zero deps, envs `PORT`/`HOST`/`NO_WS`)
- `worker/index.mjs` — adaptador Cloudflare (roteador: assets / DO da sala / turn) · `worker/room-do.mjs` — Durable Object da sala (Hibernation API + alarms)
- `wrangler.jsonc` — config da CF (assets na raiz, `run_worker_first`, DO + migrations `new_sqlite_classes`) · `.assetsignore` — o que NÃO sobe como asset · `_headers` — cache dos assets na CF (espelha as regras do `server/node.mjs`)
- `tests/` — `reducer.test.mjs` + `features.test.mjs` + `stats.test.mjs` + `core.test.mjs` (unit) · `audit.mjs` (auditoria estática pura) · `e2e.mjs` / `e2e-ws.mjs` / `e2e-reconnect.mjs` / `e2e-offline.mjs` / `e2e-features.mjs` (Playwright)
- `.github/workflows/ci.yml` — CI (lint/auditoria/unit/e2e nos DOIS alvos: Node e wrangler dev; unit+e2e auto-descobertos) · `eslint.config.mjs` — ESLint só de correção (dev/CI; o app segue buildless)
- `docs/ARQUITETURA.md` — tour guiado pra quem chega (fluxo do +1, camadas, os três "correios", onde mexer pra cada mudança). **Documentação viva**: mudou a arquitetura, atualize no MESMO PR.

## Convenções / gotchas
- **URLs sempre relativas** (`new URL('signaling', location.href)`, `fetch('turn')`,
  convite via `location.origin`). Nunca hardcodar `http(s)://` — mantém funcionando atrás de
  proxy HTTPS (Cloudflare) e sem mixed content.
- **Mudou o protocolo de sinalização? Mexa no `server/core.mjs`** — os DOIS adaptadores
  (`server/node.mjs` e `worker/room-do.mjs`) herdam; os jobs e2e (Node) e e2e-cf (wrangler)
  pegam qualquer divergência de contrato. Nunca duplicar regra de sala num adaptador só.
- **Segredos nunca no git.** `.dev.vars` (wrangler local) e `.env` estão no `.gitignore`;
  na VM os secrets entram por `Environment=` do systemd, na CF por Secrets do painel.
- **HTTPS obrigatório** em produção (SW/PWA/WebRTC); `localhost` é isento. Na VM, o nginx na
  frente PRECISA repassar o upgrade (`proxy_set_header Upgrade/Connection`) — sem isso o WS
  não passa e o app fica no polling (funciona, mas sem o turbo).
- **`wrangler dev` sempre com `--persist-to` FORA do repo** (os assets são a raiz; estado do
  miniflare dentro dela = loop infinito de reload do watcher). Free plan exige
  `new_sqlite_classes` na migration do DO (já está no `wrangler.jsonc`).
- **Deploy CF = conectar o repo** (Workers & Pages → Create → Connect to Git) ou
  `npx wrangler deploy`; **deploy VM = clone + systemd** (README tem o passo a passo RHEL).
  Os ES modules não têm hash no nome: se um CDN servir um `.js` velho junto de um novo, o app
  quebra com `does not provide an export named …`. Por isso html/js/css/sw saem com
  `Cache-Control: no-cache` (o `_headers` na CF e o `server/node.mjs` na VM aplicam as MESMAS
  regras — mudou um, mude o outro) e o `sw.js` faz `cache.add(new Request(u,{cache:'reload'}))`
  no install (fura o cache ao instalar).
- Ao mexer no `ui.js`, todo id novo precisa entrar no array `IDS` (senão `ui.init` quebra ao amarrar o listener).
- **i18n total e sempre em paridade**: TODA string de UI (shell, toasts, templates, aria) nasce
  no dicionário de `js/i18n.js` nas **três** línguas via `t(chave, vars)` — a auditoria
  (`tests/audit.mjs`, roda no CI) falha se alguma língua ficar de fora ou sobrar chave. Conteúdo
  compartilhado via CRDT (nomes de itens CUSTOM, conquistas, cards de
  share) segue pt-BR por design: é DADO da mesa, não chrome — traduzir dessincronizaria os peers.
  EXCEÇÃO deliberada: item PADRÃO do catálogo viaja só pelo `id` e cada aparelho rotula via
  `t('item.'+id)` (`itemLabel` no `app.js`) — rótulo de item padrão é percepção local
  ("cerveja" europeia = chopp BR), o dado sincronizado (id+contagem) segue idêntico.
  Nos e2e, force `lang:'pt'` no addInitScript (o CI roda Chromium en-US e os asserts são pt).
  Cuidado clássico: `const t = algumaCoisa()` SOMBREIA o `t()` do i18n — renomeie o local.
- Ao adicionar `js/*.js` do shell, atualize a lista do `sw.js` **e** bump o `CACHE` (`botequei-vN`).
- O SW **não** chama `skipWaiting` no install — quem decide a hora é o **app**, e sozinho:
  versão nova instalada → o app aplica **automaticamente** (toast "atualizando…" → `SKIP_WAITING`
  → reload no `controllerchange`; o hash re-entra na mesa), **adiando** enquanto houver jogo
  rolando ou overlay aberto (re-checa a cada 5s). Na 1ª instalação o `controllerchange` do
  `clients.claim()` **não recarrega** (era o que piscava a tela no primeiro uso). Só bump de
  `CACHE` dispara o ciclo.
- Antes de commitar mudança de lógica, rode os unit (`reducer`/`features`/`stats`) e o `tests/e2e.mjs`.
