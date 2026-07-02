// Malha WebRTC full-mesh: cada peer conecta a todos os outros por RTCDataChannel.
// Sem hub central -> se qualquer um (inclusive quem criou a mesa) sair, os demais seguem.
//
// Mensagens no fio (JSON):
//   { k:'ev',    ev }              -> evento de dominio (ADD/REMOVE/ITEM)
//   { k:'sync',  events:[...] }    -> anti-entropy: log completo ao (re)conectar
//   { k:'hello', name }            -> troca de apelido
//   { k:'ping' }                   -> heartbeat (detecta peer caido antes do timeout do ICE)
//
// Anti-glare / reconexao: dos dois lados, so o de peerId MENOR cria a offer (regra
// deterministica). Quando cai, o iniciador RE-oferta e o outro lado RECONSTROI ao receber a offer.

import { Signaling } from './signaling.js';

const DEFAULT_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];
const TICK_MS = 3000;    // heartbeat + verificacao de saude
const STALE_MS = 12000;  // sem sinal do peer por tanto tempo -> considera caido
const RETRY_MS = 3000;   // cooldown entre tentativas de reconexao
const STUCK_MS = 10000;  // handshake que nunca completou -> tenta de novo

export class Mesh {
  constructor(opts) {
    this.room = opts.room;
    this.self = opts.selfId;
    this.name = opts.name || '';
    this.ice = opts.iceServers || DEFAULT_ICE;
    this.onEvent = opts.onEvent || (() => {});
    this.onPeersChange = opts.onPeersChange || (() => {});
    this.onStatus = opts.onStatus || (() => {});
    this.onFx = opts.onFx || (() => {}); // efeitos efemeros (reacoes, brinde) — nao persistem
    this.getSyncPayload = opts.getSyncPayload || (() => []);
    this.conns = new Map();     // peerId -> rec
    this._retryAt = new Map();  // peerId -> ts da ultima tentativa de reconexao
    this._present = null;       // Set de peers vistos no ultimo poll do signaling
    this._timer = null;
    this.sig = new Signaling(this.room, this.self); // signaling nao carrega apelido
  }

  async start() {
    const existing = await this.sig.join();
    for (const p of existing) this._ensure(p.peer);
    this.sig.start((m) => this._onSignal(m), (list) => this._onPeers(list));
    this._timer = setInterval(() => this._tick(), TICK_MS);
    this.onPeersChange();
    this.onStatus();
  }

  // Chamado quando a aba volta a ficar visivel (desbloqueou o celular) ou a rede voltou.
  wake() {
    this.sig.poke();                       // forca um poll imediato do signaling
    for (const id of [...this.conns.keys()]) this._maybeConnect(id);
    for (const [id, rec] of this.conns) {  // re-sincroniza o que estiver aberto (catch-up)
      if (rec.dc && rec.dc.readyState === 'open') this._raw(id, { k: 'sync', events: this.getSyncPayload() });
    }
    this.onStatus();
  }

  _onPeers(list) {
    this._present = new Set(list.map((p) => p.peer));
    for (const p of list) {
      if (p.peer === this.self) continue;
      this._maybeConnect(p.peer);
    }
  }

  // (Re)conecta se necessario. So o iniciador (id menor) dirige a reconexao;
  // o outro lado reconstroi ao receber a offer (ver _onSignal).
  _maybeConnect(peerId) {
    const rec = this.conns.get(peerId);
    if (!rec) { this._ensure(peerId); return; }
    if (this.self >= peerId) return; // nao-iniciador espera a offer
    const st = rec.pc && rec.pc.connectionState;
    const dead = st === 'failed' || st === 'closed';
    const stuck = !rec.everReady && Date.now() - rec.createdAt > STUCK_MS;
    if (dead || stuck) this._retry(peerId);
  }

  _retry(peerId) {
    const last = this._retryAt.get(peerId) || 0;
    if (Date.now() - last < RETRY_MS) return; // cooldown
    this._retryAt.set(peerId, Date.now());
    const rec = this.conns.get(peerId);
    if (rec) { try { rec.pc.close(); } catch { /* ignore */ } this.conns.delete(peerId); }
    this._ensure(peerId); // recria; se self<peer, ja envia a offer
    this.onPeersChange();
    this.onStatus();
  }

  _ensure(peerId) {
    const found = this.conns.get(peerId);
    if (found) return found;
    return this._create(peerId, '', this.self < peerId);
  }

  _create(peerId, name, initiator) {
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const rec = {
      pc, dc: null, name: name || '', ready: false, everReady: false,
      remoteSet: false, pendingIce: [], initiator, connType: null,
      createdAt: Date.now(), lastSeen: Date.now(),
    };
    this.conns.set(peerId, rec);

    pc.onicecandidate = (e) => { if (e.candidate) this.sig.send(peerId, 'ice', e.candidate); };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'failed' || st === 'closed') { rec.ready = false; this._maybeConnect(peerId); }
      else if (st === 'disconnected') { rec.ready = false; } // pode recuperar; heartbeat/poll cuidam
      this.onPeersChange();
      this.onStatus();
    };

    if (initiator) {
      this._setupDC(peerId, pc.createDataChannel('botequei', { ordered: true }));
      this._makeOffer(peerId);
    } else {
      pc.ondatachannel = (e) => this._setupDC(peerId, e.channel);
    }
    return rec;
  }

  async _makeOffer(peerId) {
    const rec = this.conns.get(peerId);
    if (!rec) return;
    try {
      await rec.pc.setLocalDescription(await rec.pc.createOffer());
      this.sig.send(peerId, 'offer', rec.pc.localDescription);
    } catch { /* ignore */ }
  }

  async _onSignal(m) {
    if (!m || m.from === this.self) return;
    const from = m.from;
    let rec = this.conns.get(from);
    try {
      if (m.type === 'offer') {
        // (re)conexao: se o pc ja foi usado ou esta quebrado, recria limpo antes de aplicar
        const st = rec && rec.pc.connectionState;
        const reuse = rec && (rec.remoteSet || st === 'failed' || st === 'closed' || rec.pc.signalingState !== 'stable');
        if (reuse) { try { rec.pc.close(); } catch { /* ignore */ } this.conns.delete(from); rec = null; }
        if (!rec) rec = this._create(from, '', false);
        await rec.pc.setRemoteDescription(m.payload);
        rec.remoteSet = true;
        await this._flushIce(rec);
        await rec.pc.setLocalDescription(await rec.pc.createAnswer());
        this.sig.send(from, 'answer', rec.pc.localDescription);
      } else if (m.type === 'answer') {
        if (!rec) return;
        await rec.pc.setRemoteDescription(m.payload);
        rec.remoteSet = true;
        await this._flushIce(rec);
      } else if (m.type === 'ice') {
        if (!rec) return;
        if (rec.remoteSet) { try { await rec.pc.addIceCandidate(m.payload); } catch { /* ignore */ } }
        else rec.pendingIce.push(m.payload);
      }
    } catch { /* handshake fora de ordem: ignora, proxima tentativa resolve */ }
  }

  async _flushIce(rec) {
    while (rec.pendingIce.length) {
      try { await rec.pc.addIceCandidate(rec.pendingIce.shift()); } catch { /* ignore */ }
    }
  }

  _setupDC(peerId, dc) {
    const rec = this.conns.get(peerId);
    if (!rec) return;
    rec.dc = dc;
    dc.onopen = () => {
      rec.ready = true;
      rec.everReady = true;
      rec.lastSeen = Date.now();
      this._retryAt.delete(peerId);
      this._raw(peerId, { k: 'hello', name: this.name });
      this._raw(peerId, { k: 'sync', events: this.getSyncPayload() }); // anti-entropy
      this.onPeersChange();
      this.onStatus();
    };
    dc.onclose = () => { rec.ready = false; this.onPeersChange(); this.onStatus(); };
    dc.onmessage = (e) => {
      rec.lastSeen = Date.now();
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.k === 'ev') this.onEvent(msg.ev, peerId);
      else if (msg.k === 'sync' && Array.isArray(msg.events)) { for (const ev of msg.events) this.onEvent(ev, peerId); }
      else if (msg.k === 'hello') { rec.name = msg.name || rec.name; this.onPeersChange(); }
      else if (msg.k === 'fx') this.onFx(msg.fx, peerId);
      // 'ping' so serve pra atualizar lastSeen (feito acima)
    };
  }

  _raw(peerId, obj) {
    const rec = this.conns.get(peerId);
    if (rec && rec.dc && rec.dc.readyState === 'open') {
      try { rec.dc.send(JSON.stringify(obj)); } catch { /* ignore */ }
    }
  }

  // Envia para todos os canais abertos (opcionalmente exceto um) — usado no gossip.
  broadcast(obj, exceptId) {
    const s = JSON.stringify(obj);
    for (const [id, rec] of this.conns) {
      if (id === exceptId) continue;
      if (rec.dc && rec.dc.readyState === 'open') { try { rec.dc.send(s); } catch { /* ignore */ } }
    }
  }

  sendTo(id, obj) { this._raw(id, obj); }

  // Efeito efemero (reacao, brinde, cutucada) para todos — nao entra no log.
  sendFx(fx) { this.broadcast({ k: 'fx', fx }); }

  peers() {
    const out = [];
    for (const [id, rec] of this.conns) {
      out.push({
        user: id, name: rec.name, online: rec.ready, conn: rec.connType,
        state: rec.pc ? rec.pc.connectionState : 'closed',
      });
    }
    return out;
  }

  connectedCount() {
    let n = 0;
    for (const rec of this.conns.values()) if (rec.ready) n++;
    return n;
  }

  // Timer periodico: heartbeat, deteccao de peer caido, limpeza de quem saiu, tipo de conexao.
  async _tick() {
    let changed = false;
    const now = Date.now();

    for (const [id, rec] of [...this.conns]) {
      // heartbeat
      if (rec.dc && rec.dc.readyState === 'open') this._raw(id, { k: 'ping' });

      const st = rec.pc && rec.pc.connectionState;
      const bad = st === 'failed' || st === 'closed' || st === 'disconnected';

      // peer que saiu (sumiu do signaling) e ja nao esta saudavel -> remove da malha
      if (this._present && !this._present.has(id) && bad) {
        try { rec.pc.close(); } catch { /* ignore */ }
        this.conns.delete(id);
        this._retryAt.delete(id);
        changed = true;
        continue;
      }

      // sem sinal ha muito tempo (celular travou, wi-fi caiu) -> considera caido e reconecta
      if (rec.everReady && now - rec.lastSeen > STALE_MS) {
        if (rec.ready) { rec.ready = false; changed = true; }
        if (this.self < id) this._retry(id); // iniciador puxa a reconexao
      }

      // classifica o tipo de conexao (host/srflx/relay)
      if (rec.ready) {
        const t = await this._readConnType(rec.pc);
        if (t && t !== rec.connType) { rec.connType = t; changed = true; }
      }
    }

    if (changed) { this.onPeersChange(); this.onStatus(); }
  }

  async _readConnType(pc) {
    try {
      const stats = await pc.getStats();
      let pairId = null;
      stats.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId; });
      let pair = pairId ? stats.get(pairId) : null;
      if (!pair) stats.forEach((r) => { if (!pair && r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) pair = r; });
      if (!pair) return null;
      const local = stats.get(pair.localCandidateId);
      const remote = stats.get(pair.remoteCandidateId);
      const types = [local && local.candidateType, remote && remote.candidateType];
      if (types.includes('relay')) return 'relay';
      if (types.includes('srflx') || types.includes('prflx')) return 'srflx';
      return 'host';
    } catch { return null; }
  }

  close() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this.sig.leave();
    this.sig.stop();
    for (const rec of this.conns.values()) { try { rec.pc.close(); } catch { /* ignore */ } }
    this.conns.clear();
  }
}
