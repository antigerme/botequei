// Bots de boteco: a turma virtual pra você não jogar sozinho quando a mesa está vazia.
//
// FILOSOFIA: um bot é só um "peer local" — quem inicia o jogo hospeda os bots no próprio
// aparelho e emite as jogadas deles pelo MESMO protocolo (commit-reveal, lacre por carta,
// auditoria no fim). O bot não bebe, não entra na conta, não conta presença nem estatística:
// ele só existe DENTRO do jogo. Este módulo é PURO (testável em Node): elenco fixo + cérebros
// determinísticos que recebem um rng injetado. Nomes seguem pt-BR (é conteúdo de jogo, como o
// deck de desafios) — o id (bot-*) é o que viaja e todo aparelho resolve o mesmo elenco.

import { cardPower, parseCard, cardStr } from './truco.js';

// Elenco: figuras de boteco. O id é estável (todo aparelho resolve o mesmo nome/cara).
export const BOT_ROSTER = [
  { id: 'bot-ze', name: 'Zé da Esquina', emoji: '🧔', color: '#8d6e3a' },
  { id: 'bot-bigode', name: 'Seu Bigode', emoji: '🥸', color: '#5a6b8c' },
  { id: 'bot-cida', name: 'Dona Cida', emoji: '👩', color: '#8c5a7a' },
  { id: 'bot-careca', name: 'Careca', emoji: '👨‍🦲', color: '#5a8c6b' },
];

export const isBot = (id) => typeof id === 'string' && id.startsWith('bot-');
export function botProfile(id) {
  const b = BOT_ROSTER.find((x) => x.id === id);
  return b ? { name: b.name, emoji: b.emoji, color: b.color, driver: false, level: 0, photo: '' } : null;
}
// Os N primeiros bots do elenco (pra preencher assentos). Até o tamanho do elenco.
export function pickBots(n) {
  const k = Math.max(0, Math.min(BOT_ROSTER.length, Math.floor(Number(n) || 0)));
  return BOT_ROSTER.slice(0, k).map((b) => b.id);
}

// PRNG semeável (mulberry32): determinístico pra teste, variado no jogo (semente = relógio).
export function makeRng(seed) {
  let a = (Number(seed) || 1) >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ===================== PURRINHA =====================
// Mão escondida: 0..maxHand, com viézinho humano pro meio (raramente 0 ou o teto cheio).
export function botPurrHand(maxHand, rng) {
  const m = Math.max(0, Math.floor(Number(maxHand) || 0));
  if (m <= 0) return 0;
  // média de duas amostras = distribuição triangular (puxa pro miolo), como um jogador de verdade
  const a = Math.floor(rng() * (m + 1));
  const b = Math.floor(rng() * (m + 1));
  return Math.round((a + b) / 2);
}
// Palpite: o bot SABE a própria mão; estima ~1,5 por adversário; foge de número repetido; clampa.
export function botPurrGuess({ ownHand, nPlayers, ceil, taken = [], rng }) {
  const others = Math.max(0, (Number(nPlayers) || 1) - 1);
  let g = Math.round((Number(ownHand) || 0) + others * 1.5 + (Math.floor(rng() * 3) - 1)); // ruído −1..+1
  g = Math.max(0, Math.min(Number(ceil) || 0, g));
  const used = new Set((taken || []).map((x) => Number(x)));
  if (!used.has(g)) return g;
  // repetido: procura o livre mais próximo (alterna pra cima/baixo)
  for (let d = 1; d <= (Number(ceil) || 0) + 1; d++) {
    if (g + d <= ceil && !used.has(g + d)) return g + d;
    if (g - d >= 0 && !used.has(g - d)) return g - d;
  }
  return g;
}

// ===================== DOMINÓ =====================
// Escolhe entre as jogadas legais (moves: [{tile:[a,b], side}]). Estratégia de boteco:
// descarta a pedra mais PESADA (menos pips penduram se trancar), mas segura números escassos
// (não abrir mão do único encaixe de um número). Carroça pesada sai cedo.
export function botDominoMove({ moves, hand, rng }) {
  if (!moves || !moves.length) return null;
  // quantas pedras da mão tocam cada número (pra medir "escassez" ao gastar um número)
  const freq = new Array(7).fill(0);
  for (const t of (hand || [])) { freq[t[0]]++; if (t[1] !== t[0]) freq[t[1]]++; }
  let best = null, bestScore = -Infinity;
  for (const m of moves) {
    const [a, b] = m.tile;
    const pip = a + b;
    // pontua: descartar peso é bom; gastar número que só você encaixa é ruim (segura o jogo)
    const scarcity = (freq[a] <= 1 ? 1 : 0) + (a !== b && freq[b] <= 1 ? 1 : 0);
    const score = pip - scarcity * 4 + (a === b ? 2 : 0) + rng() * 0.5; // carroça leva bônus; ruído desempata
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return best;
}

// ===================== TRUCO =====================
// Força da mão: soma das potências normalizada em 0..1 (0 = lixo, 1 = mão dos sonhos).
export function botTrucoHandStrength(cards, variant, vira) {
  const list = (cards || []).map((c) => (typeof c === 'string' ? parseCard(c) : c));
  if (!list.length) return 0;
  const maxPer = variant === 'gaucha' ? 113 : 103; // teto de cardPower por variante
  const sum = list.reduce((a, c) => a + cardPower(c, variant, vira), 0);
  return Math.max(0, Math.min(1, sum / (maxPer * list.length)));
}
// Qual carta jogar: se dá pra vencer a vaza corrente, joga a MENOR que vence (economiza as fortes);
// se não dá (ou está liderando), descarta a mais fraca — no lead, guarda a bala pra depois.
export function botTrucoPlay({ myCards, vaza = [], variant, vira, rng }) {
  const list = (myCards || []).map((c) => (typeof c === 'string' ? parseCard(c) : c));
  if (!list.length) return null;
  const pw = (c) => cardPower(c, variant, vira);
  const sorted = [...list].sort((x, y) => pw(x) - pw(y)); // fraca → forte
  const plays = (vaza || []).map((v) => (typeof v.card === 'string' ? parseCard(v.card) : v.card));
  if (!plays.length) {
    // liderando: joga uma carta mediana (não gasta a maior de cara, não entrega a menor à toa)
    return sorted[Math.floor((sorted.length - 1) / 2)];
  }
  const topPow = Math.max(...plays.map(pw));
  const winners = sorted.filter((c) => pw(c) > topPow);
  if (winners.length) return winners[0];        // menor carta que ainda vence
  return sorted[0];                             // não vence: joga a mais fraca (sacrifício)
}
// Responder truco/aumento: aceita se a mão for boa, corre se for fraca, raramente re-aumenta (blefe).
export function botTrucoRespondRaise({ strength, rng }) {
  const s = Number(strength) || 0;
  if (s >= 0.62 && rng() < 0.35) return 'raise';   // mão forte: às vezes sobe a parada
  if (s >= 0.42) return 'accept';                  // razoável: paga pra ver
  if (rng() < 0.12) return 'accept';               // blefe defensivo raro
  return 'fold';                                   // fraca: corre
}
// Pedir truco (sem pendência): só com mão boa, e nem sempre (pra não ficar previsível). Blefe raro.
export function botTrucoWantRaise({ strength, rng }) {
  const s = Number(strength) || 0;
  if (s >= 0.6) return rng() < 0.5;                // mão top: metade das vezes chama
  if (s >= 0.45) return rng() < 0.18;              // média: de vez em quando
  return rng() < 0.05;                             // lixo: blefe raríssimo
}
// Mão de onze (paulista/mineira): joga a mão se for jogável, corre se for muito ruim.
export function botTrucoOnze({ strength, rng }) {
  const s = Number(strength) || 0;
  if (s >= 0.4) return true;
  return rng() < 0.25; // mão fraca de onze: geralmente corre, às vezes arrisca
}

// util exposto pro condutor (delay humano "pensando" antes de agir)
export function botThinkMs(rng) { return 900 + Math.floor((rng ? rng() : Math.random()) * 1700); } // 0,9–2,6s
export { cardStr };
