// Configuracoes locais (localStorage) — preferencias do proprio aparelho.

const K = 'botequei.settings';
const DEFAULTS = {
  theme: 'auto',     // padrão de fábrica: AUTO (segue o prefers-color-scheme do sistema, igual ao lang); 'dark'/'light' = escolha manual nas ⚙️
  bigFont: false,    // acessibilidade
  sound: true,       // efeitos sonoros
  keepAwake: true,   // na mesa, segura a tela acesa (Wake Lock) — celular apagando = presença "piscando"
  geo: true,         // deixar o app usar a localização pros SEUS botecos (passaporte/GPS). Liga de
                     // fábrica = o 1º uso pede a permissão; recusou → vira false sozinho (não insiste)
  pixKey: '',        // chave PIX do recebedor (pra dividir a conta)
  pixCity: '',       // cidade do recebedor (BR Code)
  tipPct: 10,        // gorjeta padrão na hora de fechar a conta
  lang: 'auto',      // idioma ('auto' segue o navegador; 'pt'|'en'|'es' = escolha manual)
  dev: false,        // modo desenvolvedor (diário técnico local; destrava com 7 toques na versão)
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
