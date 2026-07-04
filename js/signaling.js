// Cliente de sinalizacao: fala com /signaling por polling HTTP e, em paralelo, tenta
// PROMOVER a conexao para WebSocket (mesma rota, upgrade). Abriu o socket → o polling para
// (o servidor passa a empurrar peers/mensagens na hora); caiu → o polling religa sozinho no
// mesmo instante e o socket re-tenta com backoff. Ou seja: WS e o turbo, polling e o chao —
// atras de proxy corporativo que corta WebSocket, tudo segue funcionando igual.
// Serve SO para o handshake WebRTC (troca de offer/answer/ICE) e descoberta de peers.
// Depois que os DataChannels abrem, o consumo nao passa mais por aqui.

export class Signaling {
  constructor(room, self) {
    this.room = room;
    this.self = self;
    this.url = new URL('signaling', location.href).href;
    this.polling = false;
    this._timer = null;
    this.interval = 1000;
    this._ws = null;        // socket VIVO (so depois do onopen)
    this._wsDelay = 2000;   // backoff do retry de WS (2s → 30s)
    this._wsTimer = null;
    this._hb = null;        // heartbeat do socket (ping a cada 25s)
    this._lastRx = 0;       // ultimo dado recebido pelo socket (detector de zumbi)
    this._watch = null;     // watchdog do poke (pediu ping e nada voltou → derruba)
    this.onMessage = () => {};
    this.onPeers = () => {};
  }

  _u(action, params = {}) {
    const u = new URL(this.url);
    u.searchParams.set('action', action);
    u.searchParams.set('room', this.room);
    for (const k in params) u.searchParams.set(k, params[k]);
    return u.href;
  }

  async _post(action, body) {
    const r = await fetch(this._u(action), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json().catch(() => ({}));
  }

  // Registra presenca (so o id opaco) e devolve os peers ja presentes.
  async join() {
    try {
      const j = await this._post('join', { peer: this.self });
      return j.peers || [];
    } catch {
      return [];
    }
  }

  // Envia uma mensagem de sinalizacao para outro peer: pelo socket se estiver aberto
  // (entrega na hora), senao pela caixa-postal HTTP (o poll do outro lado drena).
  async send(to, type, payload) {
    if (this._ws && this._ws.readyState === 1) {
      try { this._ws.send(JSON.stringify({ to, type, payload })); return; } catch { /* cai pro HTTP */ }
    }
    try { await this._post('send', { from: this.self, to, type, payload }); } catch { /* ignore */ }
  }

  start(onMessage, onPeers) {
    if (onMessage) this.onMessage = onMessage;
    if (onPeers) this.onPeers = onPeers;
    this.polling = true;
    this._transport('poll');
    this._gen = (this._gen || 0) + 1;
    this._loop(this._gen);
    this._tryWS();
  }

  // gen invalida loops antigos: sem isso, pokes concorrentes (visibilitychange+focus+online)
  // criariam varias cadeias de polling paralelas.
  async _loop(gen) {
    if (!this.polling || gen !== this._gen) return;
    try {
      const r = await fetch(this._u('poll', { peer: this.self }));
      const j = await r.json();
      if (Array.isArray(j.peers)) this.onPeers(j.peers);
      if (Array.isArray(j.messages)) for (const m of j.messages) this.onMessage(m);
      this.interval = 1000;
    } catch {
      this.interval = Math.min(4000, this.interval + 500); // backoff em erro de rede
    }
    if (this.polling && gen === this._gen) this._timer = setTimeout(() => this._loop(gen), this.interval);
  }

  stop() {
    this.polling = false;
    this._gen = (this._gen || 0) + 1; // invalida qualquer loop em voo
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this._wsTimer) { clearTimeout(this._wsTimer); this._wsTimer = null; }
    if (this._watch) { clearTimeout(this._watch); this._watch = null; }
    if (this._hb) { clearInterval(this._hb); this._hb = null; }
    const ws = this._ws; this._ws = null;
    if (ws) { try { ws.close(); } catch { /* já era */ } }
  }

  // Forca uma atualizacao imediata (ex.: ao voltar do bloqueio de tela).
  // Com socket: cutuca com um ping e ARMA UM WATCHDOG — send() em socket morto nao lanca
  // no navegador (descarta em silencio), entao "nada voltou em 3s" e o unico sinal de
  // zumbi pos-sono; o watchdog derruba e o polling reassume na hora. Sem socket: poll
  // imediato + re-tenta o WS do zero.
  poke() {
    if (!this.polling) return;
    const ws = this._ws;
    if (ws && ws.readyState === 1) {
      const asked = Date.now();
      try { ws.send('ping'); } catch { this._wsDown(ws); return; }
      if (this._watch) clearTimeout(this._watch);
      this._watch = setTimeout(() => {
        this._watch = null;
        if (this._ws === ws && this._lastRx < asked) this._wsDown(ws);
      }, 3000);
      return;
    }
    this.interval = 1000;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this._gen = (this._gen || 0) + 1;
    this._loop(this._gen);
    if (this._wsTimer) { clearTimeout(this._wsTimer); this._wsTimer = null; }
    this._wsDelay = 2000;
    this._tryWS();
  }

  // keepalive: entrega mesmo se a aba estiver fechando (por isso sempre HTTP, nunca socket).
  leave() {
    try {
      fetch(this._u('leave'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({ peer: this.self }),
      });
    } catch { /* ignore */ }
  }

  // ---- transporte WebSocket (promocao oportunista; polling e o fallback eterno) ----

  _tryWS() {
    if (this._ws || !this.polling || typeof WebSocket === 'undefined') return;
    let ws;
    try {
      const u = new URL(this.url);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      u.searchParams.set('room', this.room);
      u.searchParams.set('peer', this.self);
      ws = new WebSocket(u.href);
    } catch { this._wsRetry(); return; }
    ws.onopen = () => {
      if (!this.polling) { try { ws.close(); } catch { /* ignore */ } return; }
      this._ws = ws;
      this._wsDelay = 2000; // abriu → backoff volta ao começo pra próxima queda
      this._lastRx = Date.now();
      this._transport('ws');
      // pausa o loop de polling: o servidor agora EMPURRA peers e mensagens pelo socket
      this._gen = (this._gen || 0) + 1;
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      this._hb = setInterval(() => {
        if (this._ws !== ws) return;
        // todo ping tem pong: sem NADA recebido ha 60s (2+ batidas), o socket e zumbi
        if (Date.now() - this._lastRx > 60000) { this._wsDown(ws); return; }
        try { ws.send('ping'); } catch { this._wsDown(ws); }
      }, 25000);
    };
    ws.onmessage = (ev) => {
      if (this._ws !== ws || typeof ev.data !== 'string') return;
      this._lastRx = Date.now();
      if (ev.data === 'pong') return;
      let j; try { j = JSON.parse(ev.data); } catch { return; }
      if (j.t === 'peers' && Array.isArray(j.peers)) this.onPeers(j.peers);
      else if (j.t === 'msg') this.onMessage(j);
    };
    ws.onclose = () => this._wsDown(ws);
    ws.onerror = () => this._wsDown(ws);
  }

  // Socket caiu (ou nem chegou a abrir): religa o polling IMEDIATAMENTE — o proximo poll
  // drena da caixa-postal o que o socket perdeu — e agenda nova tentativa com backoff.
  _wsDown(ws) {
    try { ws.close(); } catch { /* ignore */ }
    const wasLive = this._ws === ws;
    if (wasLive) {
      this._ws = null;
      if (this._hb) { clearInterval(this._hb); this._hb = null; }
      if (this._watch) { clearTimeout(this._watch); this._watch = null; }
    }
    if (!this.polling) return;
    if (wasLive) {
      this._transport('poll');
      this.interval = 1000;
      this._gen = (this._gen || 0) + 1;
      this._loop(this._gen);
    }
    this._wsRetry();
  }

  _wsRetry() {
    if (!this.polling || this._ws || this._wsTimer) return;
    this._wsTimer = setTimeout(() => { this._wsTimer = null; this._tryWS(); }, this._wsDelay);
    this._wsDelay = Math.min(30000, this._wsDelay * 2);
  }

  // Hook de observabilidade (o e2e assevera 'ws' ou 'poll'; nao e API do app).
  _transport(mode) {
    try { window.__sigTransport = mode; } catch { /* fora do browser */ }
  }
}
