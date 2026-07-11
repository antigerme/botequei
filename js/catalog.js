// Catalogo de itens: bebidas e petiscos. Os itens padrao sao conhecidos por todos os peers
// (hardcoded); itens personalizados sao sincronizados via eventos 'ITEM'.

// `g` = gramas de álcool puro por unidade (estimativa p/ ritmo/BAC; 0 = não alcoólico).
// Base: chopp 300ml ~5%, lata 350ml/long neck 355ml ~5%, copo da mesa ~270ml ~5%,
// dose 50ml ~40%, drink ~ um destilado.
//
// FORMATOS de cerveja (o mundo bebe de dois jeitos — e o Brasil também):
// - INDIVIDUAIS (chopp, lata, long neck): 1 toque = EU bebi 1 → conta no meu bolso E nas
//   minhas estatísticas, como sempre foi.
// - COMPARTILHADOS (`share: 1` — garrafa 600, litrão, torre): o pedido é DA MESA. 1 toque =
//   "chegou mais uma" (qualquer um marca, UMA vez); o dinheiro vai pro rateio da conta
//   (quem não bebe sai do racha lá; motorista já fica fora), e o `g` é 0 de propósito.
//   SEM contagem de copo — contar copo é mesquinharia (decisão de produto).
// O id 'cerveja' é a Garrafa 600 (a "cerveja" do boteco brasileiro) — item DA MESA (share:1).
export const DEFAULT_ITEMS = [
  { id: 'chopp',    emoji: '🍺', name: 'Chopp',          price: 0, g: 12, cat: 'cerveja' },
  { id: 'cerveja',  emoji: '🍻', name: 'Garrafa 600',    price: 0, g: 0,  cat: 'cerveja', share: 1 },
  { id: 'litrao',   emoji: '🍶', name: 'Litrão',         price: 0, g: 0,  cat: 'cerveja', share: 1 },
  { id: 'lata',     emoji: '🥫', name: 'Lata',           price: 0, g: 14, cat: 'cerveja' },
  { id: 'longneck', emoji: '🍾', name: 'Long neck',      price: 0, g: 14, cat: 'cerveja' },
  { id: 'torre',    emoji: '🗼', name: 'Torre de chopp', price: 0, g: 0,  cat: 'cerveja', share: 1 },
  { id: 'dose',     emoji: '🥃', name: 'Dose',           price: 0, g: 15, cat: 'destilado' },
  { id: 'drink',    emoji: '🍸', name: 'Drink',          price: 0, g: 14, cat: 'destilado' },
  { id: 'refri',    emoji: '🥤', name: 'Refri',          price: 0, g: 0,  cat: 'sem-alcool' },
  { id: 'agua',     emoji: '💧', name: 'Água',           price: 0, g: 0,  cat: 'sem-alcool' },
  { id: 'porcao',   emoji: '🍟', name: 'Porção',         price: 0, g: 0,  cat: 'comida' },
  { id: 'petisco',  emoji: '🧀', name: 'Petisco',        price: 0, g: 0,  cat: 'comida' },
];

// Compartilhado ("da mesa"): pedido coletivo — dinheiro rateado na conta, g=0 (não entra
// no corpo de quem tocou). Vale pros padrões e pra item personalizado criado com a marca.
export const isShare = (def) => !!(def && def.share);

// Categorias do cardápio, na ordem de exibição ("outros" é o fallback; o item novo ABRE na
// categoria do ícone escolhido — EMOJI_CAT no ui.js liga 🍺→cerveja, 🍕→comida etc.).
export const CATEGORIES = [
  { id: 'cerveja',    name: 'Cervejas' },
  { id: 'destilado',  name: 'Destilados' },
  { id: 'sem-alcool', name: 'Sem álcool' },
  { id: 'comida',     name: 'Comida' },
  { id: 'outros',     name: 'Outros' },
];
const CAT_IDS = new Set(CATEGORIES.map((c) => c.id));
export function catOf(def) { const c = def && def.cat; return CAT_IDS.has(c) ? c : 'outros'; }

// Gramas de álcool de um item (itens personalizados sem info => 0).
export function alcoholG(def) { return Math.max(0, Number(def && def.g) || 0); }

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
