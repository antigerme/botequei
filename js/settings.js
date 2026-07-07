// Configuracoes locais (localStorage) — preferencias do proprio aparelho.

const K = 'botequei.settings';
const DEFAULTS = {
  theme: 'light',    // padrão de fábrica: claro (kraft). 'auto' segue o sistema; o resto é escolha manual — o fim do tour pergunta a preferência
  bigFont: false,    // acessibilidade
  sound: true,       // efeitos sonoros
  pixKey: '',        // chave PIX do recebedor (pra dividir a conta)
  pixCity: '',       // cidade do recebedor (BR Code)
  tipPct: 10,        // gorjeta padrão na hora de fechar a conta
  lang: 'auto',      // idioma ('auto' segue o navegador; 'pt'|'en'|'es' = escolha manual)
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
