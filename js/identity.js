// Identidade local do usuario: um clientId estavel (por navegador) + apelido.
// Guardado em localStorage. O clientId serve de peerId no WebRTC e de prefixo dos eventIds.

const K_ID = 'botequei.cid';
const K_NAME = 'botequei.name';

function rid(n = 9) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (let i = 0; i < n; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}

let _cid = null;
export function clientId() {
  if (_cid) return _cid;
  _cid = localStorage.getItem(K_ID);
  if (!_cid) {
    _cid = rid(9);
    localStorage.setItem(K_ID, _cid);
  }
  return _cid;
}

export function getName() {
  return localStorage.getItem(K_NAME) || '';
}

export function setName(name) {
  const clean = (name || '').trim().slice(0, 20);
  localStorage.setItem(K_NAME, clean);
  return clean;
}

// Codigo curto para a "mesa" (fácil de digitar / codificar em QR).
export function newRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sem 0/O/1/I p/ evitar confusao
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  let s = '';
  for (let i = 0; i < 4; i++) s += alphabet[bytes[i] % alphabet.length];
  return s;
}
