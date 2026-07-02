// Gera o "Pix Copia e Cola" (BR Code / EMV MPM) no proprio navegador — sem servidor.
// Usado pra dividir a conta: cada devedor recebe uma cobranca PIX pro recebedor.

// TLV: id(2) + tamanho(2, zero-pad) + valor
function tlv(id, value) {
  const v = String(value);
  return id + String(v.length).padStart(2, '0') + v;
}

// Remove acentos/nao-ASCII (o BR Code trafega em ASCII; o CRC e sobre esses bytes).
function ascii(s, upper) {
  const out = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '');
  return upper ? out.toUpperCase() : out;
}

// CRC16-CCITT (poly 0x1021, init 0xFFFF) — 4 hex maiusculos.
export function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

// { key, name, city, amount, txid, description } -> string do Pix Copia e Cola.
export function pixPayload({ key, name, city, amount, txid, description }) {
  const k = String(key || '').trim();
  const nm = ascii(name || 'Recebedor').slice(0, 25) || 'Recebedor';
  const ct = ascii(city || 'BRASIL').slice(0, 15) || 'BRASIL';
  const mai = tlv('00', 'br.gov.bcb.pix') + tlv('01', k) +
    (description ? tlv('02', ascii(description).slice(0, 40)) : '');
  const add = tlv('05', (txid ? ascii(txid) : '***').slice(0, 25) || '***');

  let p = '';
  p += tlv('00', '01');                 // payload format
  p += tlv('26', mai);                  // conta PIX
  p += tlv('52', '0000');               // MCC
  p += tlv('53', '986');                // moeda BRL
  if (amount != null && Number(amount) > 0) p += tlv('54', Number(amount).toFixed(2));
  p += tlv('58', 'BR');                  // pais
  p += tlv('59', nm);                    // nome do recebedor
  p += tlv('60', ct);                    // cidade
  p += tlv('62', add);                   // dados adicionais (txid)
  p += '6304';                           // id+len do CRC
  return p + crc16(p);
}
