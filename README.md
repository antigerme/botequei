# 🍺 Botequei

**Contador de consumo pro boteco — registre a rodada em 1 toque, em tempo real, sem servidor central de dados.**

Ninguém mais perde a conta de quantas cervejas rolaram. Cada pessoa usa o próprio
celular, tudo sincroniza direto **entre os navegadores (peer-to-peer via WebRTC)** e
**nenhum dado de consumo passa ou fica guardado em servidor**.

---

## Como funciona (arquitetura)

> 🧭 Vai mexer no código? O tour guiado completo pra quem chega — fluxo de dados, camadas,
> onde mexer pra cada tipo de mudança — está em [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

- **PWA** em HTML + CSS + **JavaScript puro** (ES modules), sem framework nem build.
- **WebRTC `RTCDataChannel`** em **malha completa** (_full-mesh_): cada celular conecta a
  todos os outros da mesa. Não há hub central — se qualquer um sair (inclusive quem criou a
  mesa), os demais continuam.
- **Sinalização** (rota `/signaling`) só ajuda os navegadores a se acharem no começo: troca
  `offer`/`answer`/ICE. O cliente começa por _polling_ HTTP (funciona em qualquer rede) e, em
  paralelo, **promove a conexão pra WebSocket** na mesma rota (entrega instantânea); se o
  socket cair (proxy corporativo, rede zoada), o polling reassume sozinho. Depois que a
  conexão P2P sobe, a sinalização **sai do fluxo** — nunca vê nem guarda consumo, histórico
  ou participantes.
- **Um protocolo, um núcleo, dois servidores.** As regras da sala (presença com TTL,
  caixa-postal com entrega exatamente-uma-vez) vivem num módulo **puro e testado**
  (`server/core.mjs`). Em volta dele há **dois adaptadores finos**, e você escolhe onde rodar:
  - ☁️ **Cloudflare Workers** (`worker/`) — site servido pela borda + um **Durable Object por
    mesa** (WebSockets com Hibernation API: escala e hiberna de graça);
  - 🖥️ **Qualquer VM/servidor com Node** (`server/node.mjs`) — um único arquivo, **zero
    dependências** (sem `npm install`), com WebSocket RFC 6455 escrito à mão.

  Sem lock-in: o mesmo repo, o mesmo cliente e o mesmo contrato nos dois. Mudou o protocolo?
  Mexa no núcleo — os dois herdam.
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
      /signaling   ← só no aperto de mão inicial (SDP/ICE), nada é guardado
   (WebSocket com fallback automático pra polling — mesma rota)
```

## Rodando localmente

Precisa só de **Node 18+**. Nenhum `npm install`, nenhum banco.

```bash
node server/node.mjs
# abra http://localhost:8000
```

Para testar com 2 celulares na **mesma Wi-Fi**: descubra o IP da máquina
(ex.: `192.168.0.10`), rode `node server/node.mjs` e acesse `http://192.168.0.10:8000`
nos celulares. Um cria a mesa, os outros escaneiam o QR.

Variáveis úteis: `PORT`/`HOST` (padrão `8000`/`0.0.0.0`) e `NO_WS=1` (desliga o WebSocket
pra testar o fallback de polling).

Prefere simular a Cloudflare? `npx wrangler dev --persist-to ../wrangler-state` sobe o
worker localmente em `http://localhost:8787` (sem conta; o `--persist-to` fora do repo evita
que o estado local dispare o watcher de assets).

## Como usar

1. Ponha seu apelido e toque **Criar mesa**.
2. Toque em **MESA** pra mostrar o **QR Code** (ou copie o link).
3. A turma escaneia com a câmera do celular → entra na hora.
4. **1 toque** no card = +1. **Toque longo** = −1. Vibra e anima na hora.
5. **🔢 Contador gigante**: tela enorme, um botão só, pra quando a noite avançar.

## Deploy

Dois caminhos oficiais — mesmo repo, mesmo app. Escolha um (ou os dois).

### ☁️ Opção 1 — Cloudflare Workers (grátis, sem servidor pra cuidar)

O `wrangler.jsonc` já descreve tudo (pense nele como o antigo `.htaccess`): o site inteiro
vira asset estático servido pela borda, e as rotas `/signaling` e `/turn` acordam o Worker.
Cada mesa vira um **Durable Object** — os WebSockets usam a Hibernation API, então mesa
parada não gasta nada. **Funciona no plano free** (o `new_sqlite_classes` da config é
exatamente o exigido lá).

**Pelo painel (recomendado):**
1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** →
   **Connect to Git** → escolha este repositório.
2. Confirme o deploy (se o painel pedir um comando, é `npx wrangler deploy`; não há build).
3. Pronto — cada `git push` na `main` redeploya sozinho.

**Pela linha de comando:** `npx wrangler deploy` (ele lê o `wrangler.jsonc` e sobe tudo).

**TURN (opcional, pra redes restritas):** no painel do Worker → **Settings → Variables and
Secrets**, crie os **secrets** `CF_TURN_KEY_ID` e `CF_TURN_API_TOKEN` (ou
`npx wrangler secret put CF_TURN_KEY_ID` etc.). Sem eles, `/turn` responde `204` e o app
segue só com STUN — funciona na maioria das redes.

> Curiosidade anti-lock-in: o runtime dos Workers ([workerd](https://github.com/cloudflare/workerd))
> é open source — o mesmo `worker/` roda fora da Cloudflare se um dia você quiser.

### 🖥️ Opção 2 — VM própria (Red Hat, CentOS, Alma, Rocky…)

Um processo Node, zero dependências. Do zero ao ar:

```bash
# 1) pacotes
sudo dnf install -y nodejs git

# 2) código
sudo git clone https://github.com/antigerme/botequei /opt/botequei

# 3) teste rápido (Ctrl+C pra parar)
node /opt/botequei/server/node.mjs
curl 'http://localhost:8000/signaling?action=peers&room=x'   # → {"peers":[]}
```

**Como serviço (systemd)** — crie `/etc/systemd/system/botequei.service`:

```ini
[Unit]
Description=Botequei (sinalizacao + site)
After=network-online.target
Wants=network-online.target

[Service]
User=nobody
WorkingDirectory=/opt/botequei
ExecStart=/usr/bin/node /opt/botequei/server/node.mjs
Restart=always
Environment=PORT=8000
# TURN opcional (mesmos nomes da Cloudflare):
# Environment=CF_TURN_KEY_ID=seu_key_id
# Environment=CF_TURN_API_TOKEN=seu_token

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now botequei
```

**HTTPS na frente (nginx + certbot)** — obrigatório em produção (WebRTC/PWA exigem; só
`localhost` é isento). O detalhe que não pode faltar é o repasse do **upgrade de WebSocket**:

```nginx
server {
    server_name seu.dominio;
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;   # sem estas duas linhas o WebSocket
        proxy_set_header Connection "upgrade";    # não passa (o app cai pro polling)
        proxy_set_header Host $host;
    }
}
```

```bash
sudo dnf install -y nginx certbot python3-certbot-nginx
sudo systemctl enable --now nginx
sudo certbot --nginx -d seu.dominio        # emite e renova o certificado

# firewall
sudo firewall-cmd --permanent --add-service=http --add-service=https
sudo firewall-cmd --reload

# SELinux: deixa o nginx conectar no serviço local (e o proxy funcionar)
sudo setsebool -P httpd_can_network_connect 1
```

**Smoke test:** `curl 'https://seu.dominio/signaling?action=peers&room=x'` → `{"peers":[]}`,
e `curl -o /dev/null -w '%{http_code}' https://seu.dominio/turn` → `200` (TURN configurado)
ou `204` (só STUN). Abra o site em dois celulares e crie uma mesa. 🍻

## Privacidade

O servidor **não conhece** mesas, consumos, histórico nem quem está na mesa. Ele só
intermedeia o aperto de mão inicial e esquece tudo (presença e recados têm TTL de
segundos, só em memória). Todo o estado vive nos navegadores.

## Estrutura

```
index.html            # shell do PWA
styles.css            # tema "boteco"
manifest.webmanifest  # PWA
sw.js                 # service worker (offline / instalável)
icons/  fonts/        # ícones e fontes (commitados, estáveis)
js/                   # o app inteiro (ES modules, sem build)
  app.js  ui.js  mesh.js  signaling.js  events.js  ...
server/
  core.mjs            # NÚCLEO puro da sala (presença TTL + caixa-postal) — compartilhado
  node.mjs            # adaptador VM: estáticos + /signaling (polling+WS) + /turn, sem deps
worker/
  index.mjs           # adaptador Cloudflare: roteador (assets / DO da sala / turn)
  room-do.mjs         # Durable Object da sala (Hibernation API, alarms)
wrangler.jsonc        # config da Cloudflare (assets, DO, migrations, vars)
_headers              # cache dos assets na CF (espelha as regras do server/node.mjs)
.assetsignore         # o que NÃO sobe como asset (server/, tests/, configs…)
tests/                # unit (*.test.mjs) + e2e Playwright (e2e*.mjs) + audit.mjs
```

## Testes

- **Unitários** (sem dependências): `node tests/reducer.test.mjs`, `tests/core.test.mjs`,
  `tests/features.test.mjs`, `tests/stats.test.mjs`…
- **Auditoria estática**: `node tests/audit.mjs` (imports/exports, shell do SW, i18n ×3).
- **Ponta a ponta (navegadores reais, WebRTC de verdade)** — usa Chromium:
  ```bash
  node server/node.mjs &               # servidor
  npm i playwright-core                # driver (browsers já instalados no ambiente)
  node tests/e2e.mjs                   # mesa, +1/-1, anti-entropy
  node tests/e2e-ws.mjs                # transporte WebSocket + interop com polling
  NO_WS=1 node server/node.mjs &       # e o fallback:
  EXPECT_POLL=1 node tests/e2e-ws.mjs  # tudo funciona só no polling
  ```
- **Contra a Cloudflare local**: `npx wrangler dev --persist-to ../wrangler-state` e rode os
  mesmos e2e com `BASE=http://127.0.0.1:8787`.

O CI (GitHub Actions) roda tudo isso nos dois alvos — servidor Node **e** `wrangler dev` —
em todo PR.
