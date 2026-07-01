# 🍺 Botequei

**Contador de consumo pro boteco — registre a rodada em 1 toque, em tempo real, sem servidor central de dados.**

Ninguém mais perde a conta de quantas cervejas rolaram. Cada pessoa usa o próprio
celular, tudo sincroniza direto **entre os navegadores (peer-to-peer via WebRTC)** e
**nenhum dado de consumo passa ou fica guardado em servidor**.

---

## Como funciona (arquitetura)

- **PWA** em HTML + CSS + **JavaScript puro** (ES modules), sem framework nem build.
- **WebRTC `RTCDataChannel`** em **malha completa** (_full-mesh_): cada celular conecta a
  todos os outros da mesa. Não há hub central — se qualquer um sair (inclusive quem criou a
  mesa), os demais continuam.
- **`signaling.php`** (arquivo único, sem framework, sem banco) só ajuda os navegadores a se
  acharem no começo: troca `offer`/`answer`/ICE por _polling_ HTTP, usando arquivos
  temporários com TTL curto que se apagam sozinhos. Depois que a conexão P2P sobe, ele **sai
  do fluxo** — nunca vê nem guarda consumo, histórico ou participantes.
- **Estado por eventos (CRDT PN-Counter)**: cada `+1`/`-1` é um evento imutável e idempotente.
  O total é a **soma dos eventos**; como somar é comutativo, todo mundo **converge para o mesmo
  número** mesmo com atraso, reenvio ou duplicata. Deduplicação por `eventId`.
- **Anti-entropy + gossip**: ao conectar, os peers trocam o log completo (quem chega atrasado
  recebe todo o histórico da mesa); eventos novos são reencaminhados, então funcionam mesmo se
  a malha não estiver 100% completa.
- **Persistência**: só **localStorage** no próprio aparelho (retomar sessão + histórico de mesas).
- **Diagnóstico de conexão**: a lista "Na mesa" mostra como cada um está ligado — 🟢 direto,
  🟡 via STUN ou 🟠 via relay (TURN) — lendo o par de candidatos do `getStats()` em tempo real.

```
navegador A  ⇄  navegador B          (consumo trafega SÓ aqui, P2P)
     ⇅            ⇅
        signaling.php  ← só no aperto de mão inicial (SDP/ICE), nada é guardado
```

## Rodando localmente

Precisa só de **PHP** (8.x). Nenhum `npm install`, nenhum banco.

```bash
php -S 0.0.0.0:8000
# abra http://localhost:8000
```

Para testar com 2 celulares na **mesma Wi-Fi**: descubra o IP da máquina
(ex.: `192.168.0.10`), rode `php -S 0.0.0.0:8000` e acesse `http://192.168.0.10:8000`
nos celulares. Um cria a mesa, os outros escaneiam o QR.

## Como usar

1. Ponha seu apelido e toque **Criar mesa**.
2. Toque em **MESA** pra mostrar o **QR Code** (ou copie o link).
3. A turma escaneia com a câmera do celular → entra na hora.
4. **1 toque** no card = +1. **Toque longo** = −1. Vibra e anima na hora.
5. **🥴 Modo bebedeira**: tela gigante, um botão só, pra quando a noite avançar.

## Deploy

É um site estático + um `signaling.php`. Sobe em **qualquer hospedagem com PHP**
(Apache/Nginx + PHP-FPM, hospedagem compartilhada barata). Basta copiar os arquivos.

### Checklist de deploy
1. **Copie TODOS os arquivos, inclusive a pasta `icons/`.** (Se os ícones derem 404, o favicon e
   o ícone de instalação do PWA quebram — foi o tropeço mais comum.)
2. **`.htaccess`**: copie de `.htaccess.example`. Ele já **desliga o `mod_pagespeed`** (que pode
   quebrar ES modules / service worker) e, se for usar TURN, é onde vão as credenciais (`SetEnv`).
3. **HTTPS ligado** (Cloudflare já resolve). Não force `http→https` na origem se estiver em
   Cloudflare **Flexible** (gera loop de redirecionamento).
4. **Atrás do Cloudflare, purgue o cache** após cada atualização de assets (o CF pode cachear
   inclusive um 404 antigo de `icons/` ou uma versão velha do `sw.js`).
5. Confira: `GET /signaling.php?action=peers&room=x` deve responder `{"peers":[]}`, e
   `GET /turn.php` deve dar `200` (TURN ligado) ou `204` (só STUN).

- **HTTPS é necessário** em produção (WebRTC e instalação de PWA exigem; `localhost` é isento).
- **STUN/TURN**: por padrão usa STUN público e conecta P2P direto na maioria das redes. Para
  redes restritas (NAT simétrico/CGNAT), há suporte **opcional** a **Cloudflare TURN** via
  `turn.php`, que lê a config de **`SetEnv`/variável de ambiente** ou de um **`.env`** — o token
  fica **só no servidor**, nunca no cliente nem no git. Escolha **uma** das formas:

  **a) `.htaccess` — mais fácil (Apache / hospedagem compartilhada).** Copie `.htaccess.example`
  para `.htaccess` e preencha. O Apache **não serve `.ht*`** por padrão, então o segredo não vaza:
  ```apache
  SetEnv CF_TURN_KEY_ID seu_key_id
  SetEnv CF_TURN_API_TOKEN seu_api_token
  # SetEnv CF_TURN_TTL 86400
  ```
  (Precisa de `AllowOverride` habilitado — padrão na maioria das hospedagens. O `turn.php` lê o
  `SetEnv` via `$_SERVER`, funcionando tanto em mod_php quanto em php-fpm.)

  **b) Variável de ambiente** (systemd, shell, ou `env[...]` no pool do php-fpm):
  ```bash
  export CF_TURN_KEY_ID=seu_key_id
  export CF_TURN_API_TOKEN=seu_api_token   # opcional: CF_TURN_TTL=86400
  ```

  **c) Arquivo `.env`** (copie de `.env.example`) — deixe-o **fora do docroot**; o `turn.php`
  procura em `../.env` primeiro. ⚠️ Um `.env` dentro do site **é servido pela web** (confirmado no
  `php -S`); se precisar deixá-lo junto, bloqueie (`<Files ".env"> Require all denied` no Apache,
  `location ~ /\.env { deny all; }` no nginx).

  Sem nenhuma config, `turn.php` responde `204` e o app segue **só com STUN**. O cliente busca as
  credenciais efêmeras em `js/app.js` → `loadIce()` e as passa ao `RTCPeerConnection`.

## Privacidade

O servidor **não conhece** mesas, consumos, histórico nem quem está na mesa. Ele só
intermedeia o aperto de mão inicial e esquece tudo (arquivos temporários com TTL). Todo o
estado vive nos navegadores.

## Estrutura

```
index.html            # shell do PWA
styles.css            # tema "boteco"
signaling.php         # sinalização WebRTC (arquivo único, sem banco)
turn.php              # (opcional) credenciais Cloudflare TURN via env var
manifest.webmanifest  # PWA
sw.js                 # service worker (offline / instalável)
icons/                # ícones (icon.svg + PNGs gerados)
js/
  app.js              # orquestrador (log, dedup, render, fluxos)
  events.js           # modelo de eventos + reducer (CRDT)
  mesh.js             # WebRTC full-mesh
  signaling.js        # cliente do signaling.php (polling)
  ui.js               # telas, cards, gestos, vibração, bebedeira
  store.js            # persistência local
  identity.js         # id do cliente + apelido + código da mesa
  catalog.js          # itens padrão (bebidas + petiscos)
  qr.js               # geração de QR (lib local MIT)
  vendor/qrcode.js    # qrcode-generator (MIT, Kazuhiko Arase)
tools/gen_icons.php   # gera os PNGs dos ícones (build, opcional)
tests/                # testes (ver abaixo)
```

## Testes

- **Unitário do reducer** (sem dependências):
  ```bash
  node tests/reducer.test.mjs
  ```
- **Ponta a ponta (2 navegadores, sincronização real via WebRTC)** — opcional, usa Chromium:
  ```bash
  php -S 127.0.0.1:8000 &          # servidor
  npm i playwright-core            # driver (browsers já instalados no ambiente)
  node tests/e2e.mjs               # cria mesa, entra, valida +1/-1 e anti-entropy
  ```
