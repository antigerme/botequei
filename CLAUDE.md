# CLAUDE.md — Botequei

Contador de consumo de boteco: **PWA mobile-first, peer-to-peer (WebRTC), sem servidor de
dados**. Cada celular registra consumo (+1 num toque, −1 no toque longo) e tudo sincroniza em
tempo real entre os navegadores. UI **100% traduzível** (pt/en/es via `js/i18n.js`; idioma
padrão Auto segue o navegador).

## Regras de ouro (valem pra TODA mudança, sem exceção)
- **GUI/UX primeiro, com M3+HIG de régua SEMPRE**: toda mudança de UI segue Material 3 +
  Human Interface Guidelines por padrão (tokens, alvos ≥48px, Dynamic Type, switches, sheets —
  detalhes na convenção "Design tokens & a11y"), sem trocar a pele de lousa. Mobile-first,
  mínimo de toques, preview ao vivo, feedback imediato. Ação óbvia > botão extra (ex.: tocar
  num emoji volta pro emoji — não precisa de botão "voltar"). Overlays seguem o padrão
  `.sheet`; o menu "…" é GRADE de tiles 2 colunas (padrão share-sheet — lista empilhada de
  19 itens era um monstro); antes de commitar, pergunte "como isso fica MELHOR pro usuário?".
- **i18n sempre**: TODA string de UI (shell, toasts, templates, aria, placeholder) nasce em
  `js/i18n.js` nas TRÊS línguas via `t(chave)`. Removeu UI? Remova as chaves órfãs. A
  auditoria trava paridade no CI — detalhes na seção de convenções.
- **Consistência em tudo**: a mesma feature aparece em TODOS os pontos de entrada e some de
  TODOS quando sai. Adicionou/removeu jogo/feature/tela? VARRA os pontos de entrada e os padrões
  visuais (mesmos botões, mesmos gestos, mesmas molduras). Grep é seu amigo. **Os JOGOS moram no
  grid do chip "🎮 Jogos"** — casa ÚNICA deles (não se repetem no menu "…", que é enxuto: a
  faxina tirou de lá). O rótulo tem UMA fonte de verdade (as chaves `*.title` — já escapou um
  "🂠 🂠 Truco" quando cada lado carregava o próprio emoji); o e2e-liso trava o grid com os 3
  jogos, sem emoji dobrado, E que nenhum jogo vaze de volta pro menu.
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
  `node tests/stats.test.mjs` (estatísticas de vida + liga + catálogo), `node tests/core.test.mjs`
  (núcleo da sala de sinalização) e `node tests/contrast.test.mjs` (**trava WCAG AA**: lê o
  `styles.css` de verdade e mede o contraste dos temas — mudou cor, ele re-mede sozinho).
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
- **CI (GitHub Actions, `.github/workflows/ci.yml`):** roda 1× por leva, **no PR** (a main não
  re-roda: a proteção de branch — require up to date + status checks — garante que todo squash
  que entra é a MESMA árvore que o PR testou; `workflow_dispatch` roda sob demanda). Roda **lint**
  (`node --check` + ESLint só de correção via `npx eslint .`, config em `eslint.config.mjs`),
  **auditoria** (`tests/audit.mjs`), **unit** e **e2e em DOIS alvos**: servidor Node (suíte
  completa + fallback `NO_WS`) e `wrangler dev` (amostra e2e + e2e-ws + e2e-features +
  e2e-reconnect — o reconnect exercita presença TTL/caixa-postal do DO, o mais
  adapter-específico; jogos/UI/a11y são idênticos em qualquer servidor). Unit e
  e2e são **auto-descobertos**: qualquer `tests/*.test.mjs` (unit) e `tests/e2e*.mjs` (e2e)
  entram sozinhos — só seguir a convenção de nome ao criar um teste novo. **Anti-runner-frio**:
  suíte e2e que falha no CI re-roda 1× (`::warning` marca o flake no run; 2 falhas seguidas =
  vermelho real; nenhum assert afrouxa) — flake RECORRENTE ganha endurecimento no teste
  (esperar ESTADO com teto generoso, nunca sono fixo). `workflow_dispatch` re-roda a main
  sob demanda (botão "Run workflow"/API). **Promessa de casa**: toda mudança que exigir um
  clique do André no GitHub (Settings, proteção de branch, lista de required checks, secrets…)
  SEMPRE chega com o passo a passo junto, no PR e na conversa — exemplo clássico: **renomear um
  job no `ci.yml` exige atualizar a lista de required checks na proteção da branch `main`**
  (senão o merge trava esperando um check que nunca mais reporta); PR que renomeia job avisa
  em destaque.

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
  **Crédito/promessa** (evento `PLEDGE` — "banco uma rodada / N garrafas") é como se banca a mesa:
  o `settle(state)` (FONTE ÚNICA da conta) acerta no ESTADO FINAL — rodada de item pessoal cobre
  **1 de cada** no escopo com teto `min(1, consumido de verdade)`; garrafa da mesa reivindica
  `min(N prometido, bolo aberto)`. Assim "pago só o que foi bebido" e o −1 do toque longo NÃO deixa
  **dinheiro fantasma** (o "Dinheiro B": pré-marcar unidade não sobrevivia ao −1); determinístico
  (promessas em ordem ts→eventId) → converge (regra de ouro). `userMoney`/`sharePool`/
  `coveredCount`/`paidCount`/`summary` LEEM do `settle`; o fechar a conta ganha o quadro **🎁 quem
  bancou o quê**. `PLEDGE`/`settle` é o **único** mecanismo de dinheiro-com-dono — o caminho antigo
  `payer`/`covered`/`paid` foi REMOVIDO (o app ainda não está em produção; sem compat de versão).
  O `PROFILE` também leva o **nível** (liga) e a **foto** (miniatura 128px, dataURL ≤20k chars,
  validada por `cleanPhoto` na entrada E na saída do fio — emoji é o fallback eterno). `SONG` (jukebox) **acumula**
  (não é LWW) — a fila de músicas da mesa (teto de 500 + `title`/`url` coados na ENTRADA do reducer).
  ⚠️ **Higiene P2P no reducer** (irmã do `cleanPhoto`): todo dado do fio que vira dinheiro/render
  é coado na ENTRADA — `cleanItemDef` no `ITEM` força `price`/`g` a número finito ≥0 com teto e
  corta textos (peer bugado mandava `price` string/negativo/Infinity e a conta de TODOS virava
  "R$NaN"/negativa/∞, e PERSISTIA no log; os sinks `(it.price||0)*n` da comanda/`sharePool` não
  têm guarda-verdade). Coage, não rejeita — item legítimo passa intacto. O `receiveBye`/`receiveGone`
  têm gate de identidade COMPLETO (só valem pelo canal do próprio dono — `fx.from === fromId`);
  o `seenFx` (dedup de fx de jogo) tem TETO FIFO de 4000 (flood não incha memória). E a carta de
  truco (`truCardHTML`) faz `esc()` no naipe do fio — sem isso a vira/mão eram XSS que exfiltrava
  o localStorage.
- **Efeitos efêmeros (não entram no log)** via `mesh.sendFx` → `onFx`. Os de **jogo** (dominó/
  purrinha) levam `mid` e são **repassados com dedup** (gossip via `gameFx`/`seenFx`) pra toda
  jogada chegar em todos mesmo se a malha não estiver completa (4 pessoas = 6 links); os demais
  (reações etc.) são disparo único. Tipos: brinde, reação, **cerimônia** (mostrar troféus
  pra mesa), **chamar o garçom** (`waiter`, opcionalmente com `item`+`n` da rodada paga) e
  **tchau** (`bye` — o botão sair anuncia a saída; é a ÚNICA fonte do toast "👋 saiu") e
  **fechou-o-app** (`gone` — pagehide, best-effort e SILENCIOSO: só arruma a barra após a
  graça de 45s). Nada disso persiste. ⚠️ **Higiene P2P nos fx que abrem UI** (`fxAllowed` no
  `app.js`): cerimônia/garçom/cutucada/desafio passam por um **estrangulador por tipo** (janela
  mínima entre disparos — 3s na cerimônia, 900ms nos demais) e o nome do autor é coado
  (`fromNameOf`, ≤24 chars) — sem isto um peer malicioso floodava a mesa com overlays de troféu ou
  toasts de garçom. O **Brinde não tem chip próprio na barra**: o 🍻 dentro de "Reagir" (`openReact`)
  dispara o brinde de verdade (3‑2‑1 na tela de todos) — ação óbvia > botão extra.
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
  Pedras desenhadas com pips no `ui.js`. O tabuleiro é uma **SERPENTINA de mesa real ANCORADA na
  ABERTURA** (`snakeLayout` em `domino.js`, PURA/testada, sem DOM): a maior carroça (abertura) fica no
  **MEIO** e **não sai mais do lugar**; os **dois braços** crescem pra fora dela — o de índice maior
  desce serpenteando, o de índice menor sobe. Assim jogar numa ponta **NÃO re-flui** o tabuleiro
  (pedra colocada fica **PARADA** — relativo à âncora); só **girar** o aparelho (muda a largura)
  re-arruma (foi o pedido do André: "não ficar movendo as peças", "só refluir ao girar"). Regras da
  mesa: pedras **coladas** casando pip (deitadas), **buchas ATRAVESSADAS** (em pé, a linha passa reto)
  quando cabem na corrida; vira a **quina com 2 pedras EM PÉ**. A corrida **NUNCA termina numa bucha**
  (a bucha deitada é alta e encaixaria **torta** na quina — era o "6/5 na bucha errado") — a bucha da
  fronteira vira a **1ª pedra em pé da quina** (aí **ALINHA**); decisão de virar é **estável** (reserva
  L pra próxima, exista-ou-não). **Serpenteia pra caber na LARGURA em tamanho CHEIO — NUNCA encolhe a
  pedra** (só serpenteia mais); cresce em **altura** e o `ui.js` (`domFitBoard`) deixa o feltro
  **ROLAR** por dentro (`overflow:auto`, a mão fica sempre embaixo, rola até a última jogada) — mede a
  caixa de **conteúdo** real do feltro (desconta o padding, não o `clientWidth` cru) e passa a **âncora**
  (índice da abertura) pro layout. O unit trava geometria (pip casa em toda junta, sem sobrepor, cabe
  na largura cheia, buchas em pé, âncora no meio) **+ ESTABILIDADE** (crescer a corrente numa ponta não
  move nenhuma pedra já posta — regressão do André) e o e2e confere serpentina + **não-encolhe** (scale
  1) + re-fluxo ao girar.
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
- **Mãos livres (puro)**: `devicemotion` soma +1 ao chacoalhar o celular (settings `shake`,
  item mais consumido via `topItem`).
- **Hub do "Você" (avatar)** (`ui.openMe`, overlay `#overlay-me`): junta o que é PESSOAL num lugar
  só — 👤 perfil, 📊 números, 🎞️ retrô, 🗺️ passaporte, ⚙️ configurações (cada item abre o overlay
  que JÁ existe; padrão de troca do menu). DUAS portas, o mesmo hub: o **avatar no canto da home**
  (`#btn-me`, no lugar do antigo ⚙️) e **tocar no SEU rosto na barra de presença** (`.pres-me`/
  `data-self`) — por isso a barra agora SEMPRE mostra você, mesmo sozinho na mesa (o clique no self
  vai pro hub, no resto da barra vai pro placar). Números/Retrô só aparecem com histórico (espelha o
  antigo `#home-extras`); Perfil/Passaporte/Config sempre. Regra da casa: **hub = EU, "…" = A MESA**
  — perfil/números/config SAÍRAM do menu "…" (o e2e-me trava que não voltam). `renderHome`/
  `renderPresence` pintam o avatar reusando a pele `.pres-av`; o tour "📊 A mesa viva" aponta pro `.pres-me`.
- **Presença ao vivo (serena)**: `render()` desenha a barra de avatares (self + peers,
  `mesh.peers()`); queda de conexão **NUNCA vira toast** — quem cai fica 💤 esmaecido na barra pelo
  tempo que for (tela apagada/elevador não é "saiu") e a volta é silenciosa; **"👋 saiu" só existe
  no tchau EXPLÍCITO**: o botão sair manda o fx `bye` antes do `mesh.close()` e o `receiveBye`
  toasta e tira a pessoa da barra (presença é MOSTRADA, não anunciada — padrão Docs/Figma).
  **O bye é AUTORITATIVO**: `receiveBye` derruba a conexão de quem saiu NA HORA (`mesh.dropUser`,
  só se o fx veio pelo canal do PRÓPRIO dono — bye forjado não desconecta os outros); sem isso o
  pc dele ficava "online" zumbi por até 12s (o close() remoto nem sempre chega) e QUALQUER
  mudança na malha nessa janela (alguém entrando…) fazia o `diffPresence` apagar o `saidBye`
  ("voltou!") — quem saiu ressuscitava na barra como 💤 fantasma (pegou no CI; o e2e-mesa-viva
  trava a regressão com teardown neutralizado + join na janela, e a sonda `window.__presDbg`
  vira raio-x nos erros de espera de presença). "entrou!" só na 1ª vez da sessão. **Memória do 💤**: o avatar caído ganha o RELÓGIO de há
  quanto tempo está fora (`awayLabel` — "12min"/"1h" na barra e no placar; a comanda diz "fora
  desde HH:MM"); **fechar o app** manda um `gone` best-effort no `pagehide` — se não voltar na
  graça de 45s (reload/atualização de SW voltam antes), sai da barra EM SILÊNCIO; e 💤 por 1h+
  sai da barra sozinho (`AWAY_HIDE_MS` — bateria/app morto à força não avisam). Em todos os
  casos a pessoa segue no placar/conta e reentra na barra na hora se reconectar (aí o "entrou!"
  volta a valer). ⚠️ A barra é do APP, não do transporte: a malha DELETA o registro de quem
  sumiu do signaling com conexão ruim (GC no `mesh.js`) — o `renderPresence` completa a barra
  pelo `awaySince` pra o 💤 não evaporar antes da hora. **Tela acesa na mesa**: Screen Wake
  Lock segura a tela
  enquanto a mesa está aberta (`settings.keepAwake`, ligado de fábrica; switch nas configs) —
  `acquireWakeLock` no entrar/`visibilitychange` (o sistema solta sozinho ao esconder a aba),
  release no sair/switch; sem suporte, falha em silêncio. ⚠️ **Idempotência dos fluxos async**
  (fechar corridas): a re-malha carrega um **selo de geração** (`meshGen`) — o `loadIce()` é async,
  então só a ÚLTIMA `restartMesh` da sala vigente aplica (troca de sala no meio descarta o ICE que
  chega tarde), e `startMesh` fecha a malha anterior antes de abrir a nova; `acquireWakeLock` tem
  trava de "em voo" (+ solta o lock se a mesa já fechou enquanto o `await` corria); o `shake` e o
  `tour` armam UMA vez (flag) pra não empilhar handler/timer; e o `tryAudit` re-checa `dom` após
  cada `await` (a partida pode ter encerrado no meio da auditoria). O placar mostra a qualidade da
  conexão por pessoa (host/srflx/relay). Tocar num nome no placar abre a **comanda** daquela pessoa.
- **Cardápio por categoria**: `catalog.js` (`cat` + `CATEGORIES`/`catOf`); itens custom levam
  `cat`/`note` no def do evento `ITEM` (⚠️ ao editar preço, faça `makeItem({...it, price})` pra
  não perder `g`/`cat`/`note`/`share`). **Itens compartilhados** (`share:1` — garrafa 600
  [id `cerveja`, mantido por compat], litrão, torre): pedido é DA MESA — g=0 (não entra nas
  estatísticas de quem tocou), dinheiro vai pro bolo (`sharePool`) e racheia na conta via `shareSplit`
  (puro: motorista fora por padrão, toggle "todos", fallback se só tem motorista; a caixinha
  da conta tira qualquer um do racha). **Garrafa com dono** (`payer` no evento ADD/REMOVE):
  perdeu o jogo ou bancou a rodada → a unidade SAI do bolo (`sharePool` exclui) e cai
  inteira na conta do pagador (`userMoney` soma; `paidCount` pro detalhe). O contador da
  mesa NÃO muda. Entradas: o chip **💸 Rodada** no dock da mesa e o toast no aparelho do PERDEDOR
  (purrinha ×3, dominó 2p, truco — é oferta, não automação). **A "Rodada" do dock É "pagar uma
  rodada"** (o 🍻 Rodada plano — que só somava +1 pra cada um SEM dono — saiu: num item da mesa
  fazia o MESMO que tocar no card, e num pessoal era registro confuso; a casa única virou o dock,
  `btn-rodada` → `onPayRound`): item PESSOAL (chopp/dose/refri) = UM pra cada pessoa online
  (motorista fora se alcoólico); item DA MESA (share) = UMA unidade só (o card dela já é coletivo).
  Escolha em `payChoices` (= `drinkItems`, com selo "da mesa" nos share) e alvos em `roundTargets`.
  **Pagar item pessoal** = "cada um bebeu; você paga":
  cada online ganha +1 no CONSUMO, mas o dinheiro é TODO do pagador — o reducer guarda um mapa
  **`covered`** (`user\x00item` → unidades que OUTRO pagou) e o `userMoney` DESCONTA o covered do
  consumidor (bebeu, não paga; `coveredCount` mostra "na conta de quem pagou" na comanda — **com
  TETO no consumo real**, pois um REMOVE comum (−1 do toque longo, sem `payer`) baixa o `counts` mas
  não o `covered`, então sem o cap o display mentiria "×2 pago" com só 1 na mesa; o desfazer da
  rodada paga carrega o `payer` e baixa os dois em par). `payer`
  entra no ADD de cada um (motorista pulado). Item da mesa segue como a garrafa com dono. **Escopo
  do jogo**: pagar rodada vindo de um JOGO paga só pros JOGADORES, não a mesa toda — `offerLoserPay`
  leva os ids do jogo (`purr.entrants`/`dom.order`/`truco.order`) e `roundTargets(def, scope)` os usa
  (bot fora, que não bebe; motorista fora se alcoólico). O núcleo é `roundTargetIds` (puro no
  `events.js`, irmão do `shareSplit`, testado). Do DOCK (💸 Rodada, sem jogo) segue a mesa online. **Chamar o
  garçom** sai sozinho ao 💸 PAGAR a rodada (fx `waiter` com `item`+`n` → "🔔 fulano pediu: 2× Chopp"
  na mesa toda; efêmero, higiene P2P no `receiveWaiter`). **SEM contagem de copo** — contar copo é mesquinharia
  (decisão de produto): o card compartilhado é só o contador DA MESA; consumo pessoal vem só
  de item individual. O item `copo` (`cup:1`) segue no catálogo APENAS por compat de mesas
  antigas (nada o emite; `isCup` filtra de cards/rodada/editor; `tableTotal` segue excluindo
  `cup` pra log velho não contar dobrado). `userTotal`/`userMoney`/`summary` aceitam
  `resolveItem` e excluem share do pessoal.
  **Cardápio da mesa** (ex-"Preços", `menu-prices`): cada item aceita **marca/apelido**
  (`brand` no def, LWW — `itemLabel` prioriza), **descrição** (`note` no def, LWW — nasce
  no ➕ como "Descrição (opcional)" e é editável aqui; o card mostra como legenda — caso
  "Skoll" + "Garrafa 600ml") e **esconder** (`off` no def — cards/rodada/
  contador gigante filtram; a lista do editor mostra esmaecido pra reativar; contagens e
  conta não mudam). Duas marcas do mesmo formato ao mesmo tempo = criar item custom.
  **A mesa nasce LIMPA (e o ➕ também)**: SEM chips de sugestão em lugar nenhum — a tela
  vazia mostra só o convite + botão "➕ Montar o cardápio", e o overlay ➕ item abre DIRETO
  no formulário (Nome já focado; todo item nasce dali, com "da mesa" pro compartilhado).
  `DEFAULT_ITEMS` segue como DADO de compat — `resolveItem`/rótulos `t('item.'+id)` pra
  mesas antigas e afins — não como UI. `allItems` só devolve item com def no
  state OU contagem > 0 (a 2ª regra preserva mesas antigas e rodada de item que o peer não
  tinha). Com o 1º item no cardápio o convite some e o "+ item" assume; o passo 1 do tour
  aponta pro botão quando não há cards.
- **Estatísticas de vida (puro)**: `js/lifestats.js` (média/recorde/mês/favorita/streak +
  `monthlyTrend`/`weekdayInsight`/`retro`/`topMate` + `botecoProfiles`) — a tela "📊 Meus números". Gramas de álcool
  no `catalog.js` (`g`, usado só pra marcar item alcoólico na rodada/exclusão do motorista).
- **Perfil do boteco (puro)**: `botecoProfiles(history, checkins, menus, keyOf)` no `lifestats.js`
  cruza histórico + check-ins + cardápios salvos por lugar (chave = `store.botecoKey`, injetada pra
  o módulo seguir puro): visitas (check-ins), gasto (Σ myMoney), bebida favorita, última visita,
  GPS, tem-cardápio. No **passaporte**, cada lugar vira botão → **ficha do boteco** (`ui.openBoteco`,
  overlay `#overlay-boteco`, reusa `.comanda-*`/`.sheet-sub`) com stats + cardápio salvo + **"📓
  Carregar numa mesa nova"** (`onBotecoLoadNew` cria mesa, nomeia e re-emite os defs como o
  `onLoadBoteco`). Linha do passaporte com cardápio salvo ganha selo **📓**. Nome da favorita vem do
  cardápio salvo (o histórico só guarda o id). Tudo local. Entrou no `tests/stats.test.mjs` + `tests/e2e-boteco-perfil.mjs`.
- **Liga & desafios (puro)**: `js/league.js` — `levelFor` (XP = rodadas×10 + noites×30 → nível),
  `weeklyChallenges` (semana atual + noite em curso) e `seasonAward` (troféu do mês).
- **Alcance & cara**: `js/i18n.js` (dicionário pt/en/es COMPLETO — shell, toasts e templates —
  com `t(chave, vars)` interpolando `{name}`/`{n}` e `applyI18n` sobre `[data-i18n]`/
  `[data-i18n-ph]`/`[data-i18n-aria]`/`[data-i18n-title]`/`[data-i18n-html]`; idioma padrão
  **auto** pelo navegador); temas **auto/dark/light**
  (`resolveTheme`/`applyTheme` em `ui.js`; neon/retro foram aposentados — valor antigo gravado
  cai no claro);
  **molduras** de avatar por nível da liga (`frameClass` → `.fr-silver`/`.fr-gold`); **passaporte**
  de botecos (`store.getCheckins`/`addCheckin` — check-in local, GPS opcional, só no aparelho);
  **foto da noite** (só preview/compartilhar via Web Share — nada é salvo/enviado); **guia de
  boas-vindas** no 1º uso (1× só — flag `welcomeSeen` no `store.getFlag`/`setFlag`): SAUDAÇÃO
  leve — card de DEMONSTRAÇÃO tocável (treina toque=+1/segurar=−1) e "Bora!" que SOLTA na home
  (apelido/criar mesa moram SÓ lá — o funil que engolia a tela inicial morreu); e **Tour do
  Botequei** por TRILHAS (`tourTrails` no `app.js`, motor em `ui.startTour`): 🍺 O básico
  (roda sozinho na 1ª mesa — flag `tourSeen`; no fim pergunta o tema) · 💸 A conta · 🎮 A
  diversão · 📊 A mesa viva — 4 paradas cada; parada com `pre` ABRE a tela de verdade (clique
  real no menu/jogos), o motor parte da mesa LIMPA a cada parada (`closeOverlays`) e espera a
  âncora ficar visível (ausente = pula); **"🎓 Tour do Botequei"** no menu "…" abre o índice
  de trilhas com ✓ nas concluídas (flags `tourDone_*`); spotlight + balão, bolinhas de
  progresso, toque avança, re-posiciona ao girar, "pular" sempre à mão.
- **Persistência:** só `localStorage` (`js/store.js`; histórico por mesa com meus itens, gasto,
  duração e **`mates`** — quem estava na mesa, p/ o "com quem você mais bebeu"; `exportAll`/
  `importAll` = backup JSON; `getCheckins`/`addCheckin` = passaporte de botecos). Nada central.
- **Cardápio por boteco (local, sem servidor):** o app LEMBRA o cardápio de cada lugar pra
  recarregar quando você volta (`saveBotecoMenu`/`getBotecoMenu`/`hasBotecoMenu`/`botecoKey` em
  `store.js`, chave `botequei.botecomenu`; normaliza pelo nome — minúsculo, sem acento). **Boteco
  da sessão** (`sessionBoteco` no `app.js`) = o **nome da mesa** OU, sem nome, o **último check-in
  ainda fresco** (≤6h) — assim o check-in do passaporte (que é da home) puxa o cardápio na mesa
  que você abrir em seguida. Ao **sair** (`leaveTable`), guarda os defs sob esse nome (mesa
  nomeada sobrescreve; mesa anônima só SEMEIA sob o check-in se ainda não há cardápio lá — nunca
  clobbera um boteco conhecido). Mesa vazia cujo boteco tem cardápio salvo mostra o CTA
  **"📓 Carregar cardápio do {nome} ({n})"** no empty-state (ao lado do "Montar o cardápio"): 1
  toque re-emite os itens como eventos `ITEM` (aparecem na mesa E espalham pra turma via CRDT) e
  nomeia a mesa. A mesa segue nascendo LIMPA — carregar é sempre explícito. Entra no backup de
  graça (chave `botequei.*`). Entrou no `js/store.test.mjs`.
  **Efeito de rede**: você entrou na mesa de ALGUÉM (join/convite → flag `sessionJoined`) e aprendeu
  um cardápio novo pela sincronização → o toast do `leaveTable` vira **"📓 Você agora conhece o
  cardápio do {nome}!"** (só quando joined E ainda não conhecia; quem CRIA a mesa vê o "guardado"
  de sempre). **Gerenciar cardápios salvos** (na ficha do boteco, `ui.openBoteco`): **✏️ Renomear
  lugar** (`store.renameBoteco` — renomeia o LUGAR INTEIRO: cardápio salvo + check-ins do passaporte
  + títulos do histórico, pra a ficha seguir agregando sob o novo nome) e **🗑️ Apagar cardápio**
  (`store.deleteBotecoMenu` — só o cardápio; check-ins/histórico ficam, com confirmação). Renomear/
  apagar re-renderizam a ficha + o passaporte por baixo (`openPassportView`/`openBotecoFicha`).
  **Sugestão por GPS (opt-in)**: sem check-in fresco, o `sessionBoteco` ainda cai no `gpsBoteco` —
  ao **criar** a mesa, `maybeSuggestByGps` (só se a permissão de localização JÁ foi concedida, nunca
  pergunta na hora) pega a posição e o `nearestBoteco` (puro, haversine, raio 250m em `lifestats.js`)
  acha o boteco mais perto onde você já fez check-in; tem cardápio salvo → o CTA aparece sozinho.
  **Re-conferir preço**: ao carregar um cardápio COM preço, o toast vira ação **"revisar preços"**
  (`ui.actionToast`) que abre o Cardápio da mesa (os preços são os da última visita — podem ter mudado).
- **Acessibilidade**: diálogos com `role="dialog"`/foco preso/ESC (`setupA11y` em `ui.js`),
  `:focus-visible`, `prefers-reduced-motion` (corta confete/animações), rótulos ARIA.
- **Convenções de plataforma (PWA em Android/iOS)**: o app tem **identidade própria** (lousa/boteco),
  mas respeita o que importa — `viewport-fit=cover` + `env(safe-area-inset-*)` (notch/barra de gestos),
  `100dvh` (mata o bug do 100vh no Safari), metas `apple-mobile-web-app-*`, `prefers-color-scheme`,
  inputs ≥16px (sem zoom no iOS) e alvos de toque ≥44px (`.sheet-close`). **Voltar (Android) / swipe
  de voltar (iOS) fecha o overlay** em vez de sair: uma **PILHA de overlays** (`overlayStack` no
  `ui.js`) empurra UM estado de histórico por overlay aberto e o `popstate` fecha **só o TOPO** —
  overlay empilhado (recortar a foto SOBRE o perfil) some sozinho e o de baixo fica (antes um
  marcador ÚNICO fazia o voltar fechar TODOS de uma vez, perdendo o apelido não salvo). Fechar por
  ✕/ESC/arrastar chama `closeOverlays` (fecha TUDO: esvazia a pilha e desfaz os N estados via
  `history.go(-N)` com guard, sem re-disparar o nosso fechamento); o foco volta pro overlay de baixo
  ao fechar o topo, ou pra origem quando fecha tudo. O e2e-plataforma trava as DUAS regressões
  (comum: voltar fecha o menu; empilhado: voltar fecha o recorte e o perfil sobrevive).
  ⚠️ **Atribuir `location.hash` é NAVEGAÇÃO** (dispara `popstate`) — o `enterTable` escreve o
  `#/mesa?room=…` ANTES de abrir qualquer overlay; se escrever depois, o `popstate` da navegação
  cai no handler do "voltar fecha overlay" e ENGOLE o convite recém-aberto (era o bug do convite
  que piscava e fechava sozinho ao criar a mesa; o e2e-plataforma trava a regressão). **iOS
  não dispara `beforeinstallprompt`** → o `boot` mostra o "📲 Instalar" quando é iPhone e não está
  standalone; tocar cai no `toast.installHint` ("Compartilhar → Adicionar à Tela").
  **Foto de perfil = captura NATIVA do sistema**: "📷 Trocar foto" é um `<input type=file accept=image/*>`
  SEM `capture` → o SO monta o sheet (câmera OU galeria no cel; arquivo no desktop). O `capture=user`
  saiu — no cel ele PULAVA o sheet nativo e no desktop era ignorado (abria só o seletor de arquivo,
  reclamação real do André no laptop). Como o seletor do DESKTOP não tem câmera, o perfil ganha um
  "📸 Webcam" (só em `min-width:900px` + `getUserMedia`) que abre a câmera ao vivo (`openCam`/`shootCam`
  no `ui.js`, MESMO motor do QR de `scan.js`); o frame cai no MESMO recorte (`startCrop`) e a stream é
  desligada em TODO fechamento (`stopCam` no `closeOverlays`, ✕/ESC/voltar — câmera nunca fica zumbi).
  QR **não** tem equivalente nativo na web → segue com o leitor ao vivo do `scan.js`.
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
- `js/events.js` — eventos + reducer (CRDT, inclui PAYFOR) + `roundToCents` (rateio da conta em centavos por largest-remainder — a soma das partes fecha EXATO o total, sem sumir centavo no R$10÷3). **Mantém-se puro** (testável em Node, sem DOM/localStorage no topo)
- `js/lifestats.js` — estatísticas de vida + streak + retrô (puro) · `js/league.js` — nível/XP/desafios/troféu (puro)
- `js/achievements.js` — badges, MVP e **cerimônia de troféus** (puro) · `js/share.js` — cards canvas (recap/conta/cerimônia/retrô; recap e conta desenham a FOTO de perfil redonda quando tem)
- `js/sound.js` — efeitos (WebAudio)
- `js/purrinha.js` — jogo da purrinha: commit-reveal (SHA-256) + apuração determinística (puro)
- `js/truco.js` — motor do truco (paulista/mineira/gaúcha, puro): hierarquias, vazas com parda e cascata, escadas de aposta (TRUCO→…), `mergeResponses` (resposta da dupla, CRDT max), mão de onze/dez/ferro, envido/flor, deal lacrado POR CARTA (`cardSalt`/`cardCommitT`/`verifyPlayReveal`/`verifyHandAudit`) e reducer determinístico `newTrucoHand`/`reduceT` (protocolo/UI chegam no T2)
- `js/domino.js` — jogo de dominó: baralho/deal/encaixe/abertura/bater/trancar (puro)
- `js/bots.js` — turma virtual: elenco fixo + cérebros puros (purrinha/dominó/truco, rng semeável) + delay humano — o condutor mora no `app.js`
- `js/i18n.js` — dicionário pt/en/es + `applyI18n` sobre o shell (puro)
- `js/ui.js` — telas, cards, gestos (+1 toque / −1 toque longo), vibração, temas (auto/dark/light), i18n do shell, molduras por nível, overlays (cerimônia/números/conta/passaporte/foto/boas-vindas)
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
- **Design tokens & a11y (M3+HIG, sem trocar a pele)**: fonte de UI é sempre **rem** (Dynamic
  Type — o app segue a fonte do sistema; px de fonte SÓ em arte de jogo: cartas de truco/pips).
  Texto novo usa os papéis `--fs-*`; raio usa `--r-*`; movimento usa `--t-*`/`--ease-*` (tudo no
  `:root`). Texto sobre âmbar usa `--on-gold` (o "on-primary" — nunca hardcodar #241400). Cor de
  tema PASSA WCAG AA — `tests/contrast.test.mjs` mede o `styles.css` de verdade e trava no CI
  (mudou paleta, rode). Alvos de toque **≥48px** (só a arte de carta fica menor). Mudou a cor
  sólida do body de um tema? Atualize `THEME_CHROME` no `ui.js` (meta `theme-color` +
  `color-scheme` acompanham o tema). Toast é `role=status` (leitor de tela anuncia); alvos têm
  `touch-action: manipulation`; números-herói usam `min(Xrem, Yvw)` pra escalar sem estourar.
  "Fonte grande" escala a RAIZ (`html.bigfont`) — não estilize tamanho por elemento pra ela.
  **Sheets têm alcinha + arrastar-pra-fechar** (`setupSheetSwipe` no `ui.js` cria a `.sheet-grab`
  em todo sheet — JOGOS ficam fora via `NO_SWIPE`: o ✕ deles minimiza; desktop ≥900px esconde).
  **Liga/desliga de efeito imediato é SWITCH** (`role="switch"` no checkbox + pele `.check
  input[role="switch"]`); escolha de formulário/seleção segue checkbox (ex.: "da mesa" no ➕).
  **Todo input visível tem rótulo** (label associado ou aria) — o e2e-a11y varre e TRAVA no CI;
  placeholder é só exemplo ("ex: …"), nunca o rótulo.
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
- **Versão = serial de zona DNS (RFC 1912), `YYYYMMDDnn`** (data + revisão do dia): a fonte
  única é `js/version.js` (`VERSION`), o `CACHE` do `sw.js` é `botequei-` + o MESMO serial e a
  auditoria trava a paridade/formato. Bump de versão = mexer nos DOIS juntos. O rodapé das
  ⚙️ Configurações mostra "🍺 Botequei 2026.07.10-01" (`verLabel`) e TOCAR confere atualização
  na hora (`onCheckUpdate` → `reg.update()`; achou → auto-update assume; não achou → "na
  última"; sem rede → diz a versão). Ao adicionar `js/*.js` do shell, atualize a lista do
  `sw.js` **e** bump o serial.
- O SW **não** chama `skipWaiting` no install — quem decide a hora é o **app**, e sozinho:
  versão nova instalada → o app aplica **automaticamente** (toast "atualizando…" → `SKIP_WAITING`
  → reload no `controllerchange`; o hash re-entra na mesa), **adiando** enquanto houver jogo
  rolando ou overlay aberto (re-checa a cada 5s). Na 1ª instalação o `controllerchange` do
  `clients.claim()` **não recarrega** (era o que piscava a tela no primeiro uso). Só bump de
  `CACHE` dispara o ciclo.
- Antes de commitar mudança de lógica, rode os unit (`reducer`/`features`/`stats`) e o `tests/e2e.mjs`.
