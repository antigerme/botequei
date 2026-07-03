// i18n leve (sem lib): dicionário pt/en/es + t(key) + applyI18n() que troca o texto dos
// elementos com [data-i18n] e o placeholder dos com [data-i18n-ph]. Cobre o "shell" visível
// (home, configurações, menu, títulos). Mensagens dinâmicas (toasts) seguem em pt-BR por ora.

const DICT = {
  pt: {
    tagline: 'Ninguém mais perde a conta da rodada.',
    'name.label': 'Seu apelido na mesa', 'name.ph': 'ex: André',
    create: 'Criar mesa', 'code.ph': 'código', join: 'Entrar',
    offline: '📴 Entrar sem internet', stats: '📊 Meus números', retro: '🎞️ Retrô', bar: '🍺 Modo bar',
    install: '📲 Instalar o app', seal: '🔒 Seus dados nunca saem dos celulares · P2P',
    recent: 'Mesas recentes',
    'set.title': 'Configurações', 'set.theme': 'Tema', 'set.bigfont': '🔎 Fonte grande',
    'set.sound': '🔊 Sons', 'set.nudges': '🐢 Avisos de ritmo', 'set.shake': '📳 Chacoalhar pra +1 (mãos livres)',
    'set.lang': '🌎 Idioma', 'set.clear': '🗑️ Apagar dados locais',
    'menu.title': 'Mesa', 'passport': '🗺️ Passaporte',
    'welcome.title': 'Bem-vindo ao Botequei! 🍺',
  },
  en: {
    tagline: 'Nobody loses count of the round anymore.',
    'name.label': 'Your nickname', 'name.ph': 'e.g. Andre',
    create: 'Start a table', 'code.ph': 'code', join: 'Join',
    offline: '📴 Join without internet', stats: '📊 My numbers', retro: '🎞️ Recap', bar: '🍺 Bar mode',
    install: '📲 Install the app', seal: '🔒 Your data never leaves the phones · P2P',
    recent: 'Recent tables',
    'set.title': 'Settings', 'set.theme': 'Theme', 'set.bigfont': '🔎 Large font',
    'set.sound': '🔊 Sounds', 'set.nudges': '🐢 Pace nudges', 'set.shake': '📳 Shake to +1 (hands-free)',
    'set.lang': '🌎 Language', 'set.clear': '🗑️ Clear local data',
    'menu.title': 'Table', 'passport': '🗺️ Passport',
    'welcome.title': 'Welcome to Botequei! 🍺',
  },
  es: {
    tagline: 'Nadie pierde la cuenta de la ronda.',
    'name.label': 'Tu apodo', 'name.ph': 'ej: André',
    create: 'Crear mesa', 'code.ph': 'código', join: 'Entrar',
    offline: '📴 Entrar sin internet', stats: '📊 Mis números', retro: '🎞️ Resumen', bar: '🍺 Modo bar',
    install: '📲 Instalar la app', seal: '🔒 Tus datos nunca salen de los móviles · P2P',
    recent: 'Mesas recientes',
    'set.title': 'Configuración', 'set.theme': 'Tema', 'set.bigfont': '🔎 Fuente grande',
    'set.sound': '🔊 Sonidos', 'set.nudges': '🐢 Avisos de ritmo', 'set.shake': '📳 Agitar para +1 (manos libres)',
    'set.lang': '🌎 Idioma', 'set.clear': '🗑️ Borrar datos locales',
    'menu.title': 'Mesa', 'passport': '🗺️ Pasaporte',
    'welcome.title': '¡Bienvenido a Botequei! 🍺',
  },
};

let lang = 'pt';
export function resolveLang(pref) {
  if (pref === 'en' || pref === 'es' || pref === 'pt') return pref;
  try { const n = (navigator.language || 'pt').slice(0, 2); return DICT[n] ? n : 'pt'; } catch { return 'pt'; }
}
export function setLang(pref) { lang = resolveLang(pref); }
// t('chave', { name: 'Bia', n: 3 }) — interpola {name}/{n} depois de escolher a língua
export function t(key, vars) {
  let s = (DICT[lang] && DICT[lang][key]) || DICT.pt[key] || key;
  if (vars) for (const k of Object.keys(vars)) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.getAttribute('data-i18n')); });
  root.querySelectorAll('[data-i18n-ph]').forEach((n) => { n.setAttribute('placeholder', t(n.getAttribute('data-i18n-ph'))); });
  try { document.documentElement.lang = lang === 'pt' ? 'pt-BR' : lang; } catch { /* ignore */ }
}
