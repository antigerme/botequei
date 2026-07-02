// Configuracoes locais (localStorage) — preferencias do proprio aparelho.

const K = 'botequei.settings';
const DEFAULTS = {
  theme: 'auto',     // 'auto' segue o sistema (prefers-color-scheme); 'light'/'dark' = escolha manual
  bigFont: false,    // acessibilidade
  sound: true,       // efeitos sonoros
  limit: 0,          // meta pessoal de bebidas (0 = desligado)
  waterEvery: 0,     // lembrete de agua a cada N bebidas (0 = desligado)
  pixKey: '',        // chave PIX do recebedor (pra dividir a conta)
  pixCity: '',       // cidade do recebedor (BR Code)
};

export function getSettings() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(K)) || {}) }; }
  catch { return { ...DEFAULTS }; }
}

export function setSettings(patch) {
  const s = { ...getSettings(), ...patch };
  try { localStorage.setItem(K, JSON.stringify(s)); } catch { /* quota */ }
  return s;
}
