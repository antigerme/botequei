// Catalogo de itens: bebidas e petiscos. Os itens padrao sao conhecidos por todos os peers
// (hardcoded); itens personalizados sao sincronizados via eventos 'ITEM'.

export const DEFAULT_ITEMS = [
  { id: 'cerveja', emoji: '🍺', name: 'Cerveja', price: 0 },
  { id: 'chopp',   emoji: '🍻', name: 'Chopp',   price: 0 },
  { id: 'dose',    emoji: '🥃', name: 'Dose',    price: 0 },
  { id: 'drink',   emoji: '🍸', name: 'Drink',   price: 0 },
  { id: 'refri',   emoji: '🥤', name: 'Refri',   price: 0 },
  { id: 'agua',    emoji: '💧', name: 'Água',    price: 0 },
  { id: 'porcao',  emoji: '🍟', name: 'Porção',  price: 0 },
  { id: 'petisco', emoji: '🧀', name: 'Petisco', price: 0 },
];

// Paleta para escolher o emoji de um item novo.
export const EMOJIS = [
  '🍺', '🍻', '🥃', '🍸', '🍹', '🍾', '🍷', '🥂',
  '🥤', '🧃', '💧', '☕', '🧉', '🍟', '🍕', '🌭',
  '🧀', '🥓', '🍗', '🥜', '🫒', '🍤', '🥟', '🍢',
];

// Identidade visual dos participantes (cor + avatar).
export const COLORS = [
  '#e8890b', '#e0533d', '#6fcf6f', '#4a9df0', '#b06fe0',
  '#f0c04a', '#f06fa5', '#3fb7b7', '#8fb04a', '#d97a3a',
];
export const AVATARS = [
  '🍺', '😎', '🤠', '🦁', '🐯', '🐸', '🦊', '🐼',
  '🐷', '🐵', '🦄', '🐙', '🌵', '🎸', '👽', '🤖',
];

// Escolhe cor/avatar deterministicos a partir do id (ate a pessoa personalizar).
export function autoColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}
export function autoAvatar(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 37 + id.charCodeAt(i)) >>> 0;
  return AVATARS[h % AVATARS.length];
}

const DEFAULT_IDS = new Set(DEFAULT_ITEMS.map((i) => i.id));

export function isDefault(id) {
  return DEFAULT_IDS.has(id);
}

// slug estavel a partir do nome -> itens custom de mesmo nome convergem entre peers.
export function itemIdFromName(name) {
  const slug = (name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 24);
  return 'x-' + (slug || 'item');
}
