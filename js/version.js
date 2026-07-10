// Versão do Botequei — serial no padrão de zona DNS (RFC 1912): YYYYMMDDnn.
// AAAA-MM-DD de quando saiu + nn = revisão do dia (01, 02, …). Cresce sempre, se compara
// como número e, diferente de um "v82", diz DE QUANDO é a versão só de olhar.
// FONTE ÚNICA: o CACHE do sw.js usa ESTE serial ('botequei-' + VERSION) e a auditoria
// (tests/audit.mjs) trava a paridade — bump de versão é mexer AQUI e no sw.js juntos.
export const VERSION = '2026071003';

// '2026071001' → '2026.07.10-01' (pra gente ler; o serial cru fica pras máquinas)
export function verLabel(v) {
  const s = String(v);
  return `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}-${s.slice(8, 10)}`;
}
