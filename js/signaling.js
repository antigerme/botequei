// Cliente de sinalizacao: fala com signaling.php por HTTP (polling curto).
// Serve SO para o handshake WebRTC (troca de offer/answer/ICE) e descoberta de peers.
// Depois que os DataChannels abrem, o consumo nao passa mais por aqui.

export class Signaling {
  constructor(room, self) {
    this.room = room;
    this.self = self;
    this.url = new URL('signaling.php', location.href).href;
    this.polling = false;
    this._timer = null;
    this.interval = 1000;
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

  // Enfileira uma mensagem de sinalizacao para outro peer.
  async send(to, type, payload) {
    try { await this._post('send', { from: this.self, to, type, payload }); } catch { /* ignore */ }
  }

  start(onMessage, onPeers) {
    if (onMessage) this.onMessage = onMessage;
    if (onPeers) this.onPeers = onPeers;
    this.polling = true;
    this._gen = (this._gen || 0) + 1;
    this._loop(this._gen);
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
  }

  // Forca um poll imediato (ex.: ao voltar do bloqueio de tela) e reseta o backoff.
  poke() {
    if (!this.polling) return;
    this.interval = 1000;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this._gen = (this._gen || 0) + 1;
    this._loop(this._gen);
  }

  // keepalive: entrega mesmo se a aba estiver fechando.
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
}
