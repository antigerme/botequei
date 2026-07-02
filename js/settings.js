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
  weightKg: 0,       // peso p/ estimativa de teor alcoólico (0 = não estima; tudo local)
  sex: '',           // 'm'/'f' p/ constante de Widmark ('' = usa média)
  nudges: true,      // avisos de ritmo ("bora uma água?")
  tipPct: 10,        // gorjeta padrão na hora de fechar a conta
  lang: 'pt',        // idioma do shell ('pt'|'en'|'es'|'auto')
  responsa: false,   // modo responsa: nudges mais firmes e limiares menores
  trustName: '',     // contato de confiança (nome) — pra pedir carona / avisar
  trustPhone: '',    // contato de confiança (telefone, só dígitos) — WhatsApp/ligação
  carApp: 'uber',    // app de carro preferido ('uber' | '99')
  domVerified: false, // dominó "mesa verificada": embaralho auditável (commit-to-deck + corte coletivo)
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
