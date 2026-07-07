# 🍺 Botequei — Guia de Arquitetura

**Pra quem está chegando agora** (dev novo ou sessão nova de IA): este é o tour guiado do
sistema. O [CLAUDE.md](../CLAUDE.md) é o manual de OPERAÇÃO (regras, comandos, gotchas);
este arquivo é o de ENTENDIMENTO (por que as coisas são como são). O
[README.md](../README.md) é a vitrine (o que é, como rodar, como fazer deploy).

## A ideia em uma frase

Cada celular da mesa roda o app inteiro; os navegadores conversam **direto entre si**
(WebRTC), o estado é uma **lista de eventos imutáveis** que todo mundo soma do próprio
jeito e chega no mesmo número (CRDT), e **nenhum servidor vê dado nenhum** — o servidor
só apresenta um navegador ao outro e sai de cena.

## O fluxo de um "+1" (entenda isso e você entendeu o app)

```
 dedo toca o card "Chopp"                         (ui.js: gesto de toque curto)
   → H.onAdd('chopp')                             (ui.js dispara o handler do app.js)
     → makeAdd() cria o EVENTO imutável           (events.js: {type:'ADD', user, item, ts, eventId})
       → emitLocal(ev):                           (app.js)
           1. applyEvent(state, ev)               (events.js: reducer — soma no total)
           2. store.saveEvents(room, log)         (store.js: localStorage, com debounce)
           3. mesh.broadcast({k:'ev', ev})        (mesh.js: manda pra TODOS os DataChannels)
             → cada peer recebe, DEDUPLICA por eventId, aplica no reducer DELE
               e repassa pra quem ainda não viu   (gossip — funciona com malha incompleta)
   → render()                                     (app.js lê o estado e manda view-models pra ui.js)
```

Somar é comutativo ⇒ a ordem de chegada não importa ⇒ **todo mundo converge**. Quem entra
atrasado recebe o log inteiro no aperto de mão (anti-entropy, em lotes de 64 eventos) e
chega no mesmo estado.

**Itens compartilhados** (garrafa 600/litrão/torre, `share:1` no catálogo) usam o MESMO
evento ADD — o que muda é a leitura: o dinheiro deles não pendura em quem tocou
(`userMoney` pula, `sharePool` junta o bolo da mesa e `shareSplit` decide quem racheia na
conta — motorista fora por padrão), e o corpo é medido pelo **copo** (`copo`, `cup:1`,
R$0 e g>0): a zona "🥂 meu copo" dentro do card marca a dose PESSOAL que alimenta
BAC/estatísticas. Recipiente = dinheiro da mesa; copo = corpo de quem bebeu.

**A mesa nasce vazia**: o catálogo (`DEFAULT_ITEMS`) é um baralho de SUGESTÕES — item só
vira card quando alguém o adiciona (chip de 1 toque → evento `ITEM` → sincroniza). A
regra de leitura em `allItems()` (app.js) é "está na mesa = tem def no estado OU contagem
> 0" — o segundo lado preserva mesas antigas e cobre rodada de item que o receptor ainda
não tinha. A área "monte o cardápio" fica no miolo até o primeiro gole da noite.

## O mapa das camadas

```
┌─────────────────────────── navegador de CADA pessoa ───────────────────────────┐
│  index.html + styles.css   shell e temas (auto/claro/escuro/neon/retrô)        │
│  ui.js          APRESENTAÇÃO: telas/overlays/gestos; recebe view-model,        │
│                 dispara H.* — não sabe o que é CRDT nem WebRTC                 │
│  app.js         ORQUESTRADOR: único que conhece todo mundo; handlers H.*,      │
│                 render(), protocolos dos jogos, boot                           │
│  ── lógica pura (testável em Node, sem DOM): ──────────────────────────────    │
│  events.js      eventos + reducer (a VERDADE da mesa)                          │
│  lifestats/league/achievements  derivados e diversão                           │
│  purrinha/domino/truco  motores dos jogos (commit-reveal, validação, apuração) │
│  pix/handshake/i18n     BR Code · codec offline · dicionário pt/en/es          │
│  ── infraestrutura local: ─────────────────────────────────────────────────    │
│  mesh.js        malha WebRTC full-mesh + reconexão + gossip + sendTo/sendFx    │
│  signaling.js   cliente da sala (polling→WebSocket com fallback automático)    │
│  store/settings/identity  localStorage (log, histórico, preferências, id)      │
│  sw.js          PWA offline + atualização automática coordenada pelo app       │
└─────────────────────────────────────────────────────────────────────────────────┘
                    │ /signaling (SÓ SDP/ICE — id opaco, mais nada)
                    ▼
   UM protocolo, UM núcleo puro, DOIS adaptadores:
   server/core.mjs      Room pura: presença TTL 15s, caixa-postal FIFO 120s,
                        entrega exatamente-1×, clean() de ids  ← MUDOU O CONTRATO? É AQUI
   server/node.mjs      VM (zero deps): estáticos + polling + WebSocket RFC 6455 à mão + /turn
   worker/index.mjs +   Cloudflare: roteador + Durable Object POR MESA (Hibernation API;
   worker/room-do.mjs   socket aberto É presença; alarms só pro próximo vencimento)
```

## Os três "correios" (quando cada um é usado)

1. **Evento CRDT** (`{k:'ev'}` no DataChannel) — consumo, perfil, itens, mesa, PAYFOR,
   jukebox. **Permanente**: entra no log, persiste, converge. Criou tipo novo? Nasce em
   `events.js` (factory + case no reducer) e o `tests/features.test.mjs` ganha assert.
2. **Fx efêmero** (`mesh.sendFx`) — brinde, reação, cerimônia, garçom e
   TODAS as fases dos jogos. **Não persiste**; jogadas de jogo levam `mid` e são
   regossipadas com dedup (`gameFx`) pra alcançar todo mundo mesmo com malha incompleta.
3. **Canal direto** (`mesh.sendTo`) — segredo pra UMA pessoa: a mão do dominó/truco.
   Nunca no broadcast (senão a mesa inteira veria as cartas do outro).

## Decisões que parecem estranhas (e são de propósito)

- **Sem framework, sem build** — a "toolchain" é o navegador. Qualquer `git clone` roda.
  Não introduza bundler: o custo permanente supera o ganho pontual.
- **Conteúdo compartilhado fica em pt-BR** (nomes de itens CUSTOM, cartas, conquistas)
  mesmo com UI em 3 línguas: é DADO da mesa (viaja via CRDT) — se cada peer traduzisse,
  dessincronizava. **Exceção de propósito**: itens PADRÃO do catálogo viajam só pelo `id`
  (`chopp`, `cerveja`…), e cada aparelho mostra o nome via `t('item.'+id)` — na Europa a
  "cerveja" do brasileiro é o chopp deles, então o RÓTULO é percepção local (`itemLabel`
  em `app.js`), não dado. O que os peers sincronizam (id + contagem) continua idêntico.
  Se a mesa der uma **marca** ao item ("Original", no Cardápio da mesa), aí SIM vira dado
  da mesa (`brand` no def, LWW) e vence o rótulo local em todo lugar; `off` (esconder o
  item dos cards) segue o mesmo caminho.
- **Jogos confiam como na vida real**: quem embaralha é o dono da mesa; a MESA VERIFICADA
  (commit-to-deck + corte coletivo + auditoria no fim) pega trapaça no embaralho, e cada
  jogada é validada por TODOS os peers. O que não dá pra esconder sem "mental poker"
  (pesadíssimo), a auditoria expõe no fim — 🔒✅ ou 🚫 com nome.
- **Bot é um peer local** (`js/bots.js`): pra jogar sozinho no bar esperando a turma. Quem
  inicia hospeda os bots no próprio aparelho e emite as jogadas deles pelo MESMO protocolo
  (commit-reveal, auditoria) — nada de caminho especial. Solo é só o caso degenerado (mesh
  com zero peers). O elenco é um baralho FIXO (todo aparelho resolve `bot-ze` → Zé da Esquina,
  zero sync). O bot não bebe, não entra em conta/presença/estatística: existe só dentro do jogo.
- **A foto de perfil vira miniatura 128px** e viaja DENTRO do evento PROFILE (validada dos
  dois lados do fio) — P2P de verdade, sem upload pra lugar nenhum; o emoji é o fallback.

## Onde mexer pra cada tipo de mudança

| Quero…                       | Mexo em…                                                    |
|------------------------------|-------------------------------------------------------------|
| novo item/categoria padrão   | `js/catalog.js` (+ gramas de álcool se beber)               |
| novo dado sincronizado       | `js/events.js` (factory + reducer + unit) → `app.js` → `ui.js` |
| novo efeito social           | fx em `app.js` (sendFx/onFx) + overlay em `ui.js`/`index.html` |
| novo jogo                    | motor PURO em `js/<jogo>.js` + unit; protocolo por fx em `app.js`; UI; entradas no menu "…" E no grid |
| protocolo da sala            | `server/core.mjs` (os DOIS adaptadores herdam; e2e pega divergência) |
| visual/tema                  | `styles.css` (CSS vars por tema em `body.light/neon/retro`) |
| texto                        | `js/i18n.js` — SEMPRE nas três línguas                      |
| regra de negócio derivada    | módulo puro (`stats/league/...`) + unit                     |

Checklist de TODA mudança (as Regras de Ouro do CLAUDE.md): melhor UX possível → i18n ×3 →
consistência nos pontos de entrada → unit+audit+e2e verdes antes do commit → id novo no
`IDS` → mudou shell? bump do `CACHE` no sw.js.

## Testes: quem pega o quê

- **Unit (`tests/*.test.mjs`)** — lógica pura: reducer, jogos, stats, núcleo da sala.
  Auto-descobertos pelo CI; rodam com `node tests/x.test.mjs`, zero deps.
- **Auditoria (`tests/audit.mjs`)** — o "fiscal" estático: grafo import/export, shell do
  SW + CACHE, array IDS ↔ index.html, paridade i18n ×3. Pega o erro ANTES do navegador.
- **E2E (`tests/e2e*.mjs`)** — navegadores REAIS conversando por WebRTC de verdade: mesa,
  sync, reconexão, offline por QR, transporte ws/poll, jogos completos, foto de perfil.
  Auto-descobertos; rodam nos DOIS alvos no CI (servidor Node e wrangler dev).

## Deploy (resumo; passo a passo no README)

- **Cloudflare**: conectar o repo no painel → cada push na `main` publica. `wrangler.jsonc`
  é a config; assets saem da borda; `/signaling` vira Durable Object por mesa.
- **VM própria**: `node server/node.mjs` atrás de nginx+certbot (repassando o upgrade de
  WebSocket). Zero `npm install`.

*Documentação viva: mudou a arquitetura, atualize este arquivo no MESMO PR.*
