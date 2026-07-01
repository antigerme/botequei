// Malha WebRTC full-mesh: cada peer conecta a todos os outros por RTCDataChannel.
// Sem hub central -> se qualquer um (inclusive quem criou a mesa) sair, os demais seguem.
//
// Mensagens no fio (JSON):
//   { k:'ev',    ev }              -> um evento de dominio (ADD/REMOVE/ITEM)
//   { k:'sync',  events:[...] }    -> anti-entropy: log completo ao abrir a conexao
//   { k:'hello', name }            -> troca de apelido
//
// Anti-glare: dos dois lados, so o de peerId MENOR cria a offer (regra deterministica).

import { Signaling } from './signaling.js';

const DEFAULT_ICE = [{ urls: 'stun:stun.l.google.com:19302' }];

export class Mesh {
  constructor(opts) {
    this.room = opts.room;
    this.self = opts.selfId;
    this.name = opts.name || '';
    this.ice = opts.iceServers || DEFAULT_ICE;
    this.onEvent = opts.onEvent || (() => {});
    this.onPeersChange = opts.onPeersChange || (() => {});
    this.onStatus = opts.onStatus || (() => {});
    this.getSyncPayload = opts.getSyncPayload || (() => []);
    this.conns = new Map(); // peerId -> rec
    this.sig = new Signaling(this.room, this.self); // signaling nao carrega apelido
  }

  async start() {
    const existing = await this.sig.join();
    for (const p of existing) this._ensure(p.peer);
    this.sig.start((m) => this._onSignal(m), (list) => this._onPeers(list));
    this.onPeersChange();
    this.onStatus();
  }

  _onPeers(list) {
    for (const p of list) {
      if (p.peer === this.self) continue;
      if (!this.conns.get(p.peer)) this._ensure(p.peer); // apelido chega via 'hello' P2P
    }
  }

  _ensure(peerId) {
    const found = this.conns.get(peerId);
    if (found) return found;
    return this._create(peerId, '', this.self < peerId);
  }

  _create(peerId, name, initiator) {
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const rec = { pc, dc: null, name: name || '', ready: false, remoteSet: false, pendingIce: [], initiator };
    this.conns.set(peerId, rec);

    pc.onicecandidate = (e) => { if (e.candidate) this.sig.send(peerId, 'ice', e.candidate); };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'failed' || st === 'closed' || st === 'disconnected') {
        rec.ready = false;
        this.onPeersChange();
        this.onStatus();
      }
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
      this._raw(peerId, { k: 'hello', name: this.name });
      this._raw(peerId, { k: 'sync', events: this.getSyncPayload() }); // anti-entropy
      this.onPeersChange();
      this.onStatus();
    };
    dc.onclose = () => { rec.ready = false; this.onPeersChange(); this.onStatus(); };
    dc.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.k === 'ev') this.onEvent(msg.ev, peerId);
      else if (msg.k === 'sync' && Array.isArray(msg.events)) { for (const ev of msg.events) this.onEvent(ev, peerId); }
      else if (msg.k === 'hello') { rec.name = msg.name || rec.name; this.onPeersChange(); }
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

  peers() {
    const out = [];
    for (const [id, rec] of this.conns) out.push({ user: id, name: rec.name, online: rec.ready });
    return out;
  }

  connectedCount() {
    let n = 0;
    for (const rec of this.conns.values()) if (rec.ready) n++;
    return n;
  }

  close() {
    this.sig.leave();
    this.sig.stop();
    for (const rec of this.conns.values()) { try { rec.pc.close(); } catch { /* ignore */ } }
    this.conns.clear();
  }
}
