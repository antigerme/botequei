// Deck de desafios (puro): cartas pra mesa sortear. Diversão sem incentivar exagero —
// tem hidratação, interação e até "duelo". A carta sorteada é mostrada pra todos (via fx).

export const CARDS = [
  { emoji: '💧', text: 'Rodada de água! Todo mundo bebe uma água agora.' },
  { emoji: '🤝', text: 'Elogie de verdade a pessoa à sua direita.' },
  { emoji: '🎤', text: 'Cante o refrão da última música que tocou.' },
  { emoji: '📸', text: 'Selfie da mesa! Registra o momento.' },
  { emoji: '🗣️', text: 'Conte a história mais engraçada que já te aconteceu num bar.' },
  { emoji: '🎶', text: 'Quem já viajou pra mais longe escolhe a próxima música.' },
  { emoji: '⚔️', text: 'Duelo de trava-língua com a pessoa à sua frente!' },
  { emoji: '🙊', text: 'Ninguém fala o nome de ninguém por 5 min — quem errar paga uma água.' },
  { emoji: '😂', text: 'Imite o jeito de rir de alguém da mesa até adivinharem quem é.' },
  { emoji: '📵', text: 'Empilhem os celulares — o primeiro que pegar paga a próxima rodada.' },
  { emoji: '🧠', text: 'Fala 3 coisas que você agradece hoje.' },
  { emoji: '🏆', text: 'Quem foi o MVP da última vez escolhe um brinde coletivo.' },
];

export function pickCard(n) {
  const i = ((Number(n) || 0) % CARDS.length + CARDS.length) % CARDS.length;
  return CARDS[i];
}
