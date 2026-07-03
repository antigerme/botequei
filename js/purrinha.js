// Purrinha — lógica pura (sem DOM/rede), honesta no P2P via COMMIT-REVEAL.
//
// Sem servidor, ninguém pode ser "a banca" que sorteia — cada um tem a própria mão escondida.
// Truque: cada jogador escolhe a mão (0–3 palitos) E o palpite do total, e manda pra mesa só o
// "lacre" = SHA-256(mão:palpite:segredo). Ninguém vê nada. Quando todo mundo lacrou, abre junto:
// cada um revela mão+palpite+segredo, todos conferem que o lacre bate (ninguém mudou depois de
// ver os outros) e somam. Quem cravar o total é vidente; quem chutar mais longe paga a próxima.
//
// Tudo aqui é isomórfico (roda no browser e no Node, com WebCrypto) e testável sem DOM.

const enc = new TextEncoder();

export const clampHand = (n) => Math.max(0, Math.min(3, Math.floor(Number(n) || 0)));
export const maxGuess = (nPlayers) => 3 * Math.max(0, nPlayers | 0); // palpite vai de 0 a 3·N

// segredo aleatório (128 bits em hex) — imprevisível até a revelação
export function randomNonce() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(String(str)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// string canônica do lacre (mesma ordem em todo mundo)
export function commitString(hand, guess, nonce) {
  return `${clampHand(hand)}:${Number(guess)}:${nonce}`;
}
export function makeCommit(hand, guess, nonce) {
  return sha256Hex(commitString(hand, guess, nonce));
}
// confere se um reveal ({hand,guess,nonce,commit}) bate com o lacre que a pessoa mandou antes
export async function verifyReveal(r) {
  if (!r || typeof r.commit !== 'string') return false;
  return (await makeCommit(r.hand, r.guess, r.nonce)) === r.commit;
}

// Apura a rodada RÁPIDA (variante de 1 rodada). `reveals`: [{ id, name?, hand, guess }] já verificados.
// Determinístico (ordena por id) pra todo peer chegar no MESMO resultado.
//   total   = soma das mãos
//   seers   = ids que cravaram o total (videntes) — imunes
//   loserId = quem chutou mais longe (paga); empate → menor id; todos cravaram → null
export function resolve(reveals) {
  const list = [...(reveals || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const total = list.reduce((a, r) => a + clampHand(r.hand), 0);
  const seers = list.filter((r) => Number(r.guess) === total).map((r) => r.id);
  let loserId = null, worst = -1;
  for (const r of list) {
    const d = Math.abs(Number(r.guess) - total);
    if (d > worst) { worst = d; loserId = r.id; }
  }
  if (worst <= 0) loserId = null; // todo mundo cravou: ninguém paga, geral é vidente
  return { total, seers, loserId };
}

// ===================== Modo CLÁSSICO (palitinho de verdade) =====================
// Regras do bar: só a MÃO é secreta (lacre por rodada). Os palpites são falados em voz
// alta, um por vez, girando a mesa — e NÃO podem repetir. Quem crava o total se livra e
// sai; os que sobram jogam de novo (máximo cai junto); o ÚLTIMO que resta paga.

// lacre só da mão (o palpite é público no clássico)
export function handCommitString(hand, nonce) { return `h:${clampHand(hand)}:${nonce}`; }
export function makeHandCommit(hand, nonce) { return sha256Hex(handCommitString(hand, nonce)); }
export async function verifyHandReveal(r) {
  if (!r || typeof r.commit !== 'string') return false;
  return (await makeHandCommit(r.hand, r.nonce)) === r.commit;
}

// palpite válido: inteiro, 0..3·vivos e ainda não dito (a regra de ouro do palitinho)
export function validGuess(g, nAlive, taken) {
  const n = Number(g);
  if (!Number.isInteger(n) || n < 0 || n > maxGuess(nAlive)) return false;
  return !(taken || []).some((t) => Number(t) === n);
}

// ordem dos palpites da rodada: começa no starter e gira a mesa (só os vivos)
export function guessOrder(alive, startIdx) {
  const n = (alive || []).length, out = [];
  for (let k = 0; k < n; k++) out.push(alive[(((startIdx | 0) % n) + n + k) % n]);
  return out;
}
// de quem é a vez de falar: o primeiro da ordem que ainda não palpitou
export function turnOf(alive, startIdx, guessedIds) {
  const done = new Set(guessedIds || []);
  return guessOrder(alive, startIdx).find((id) => !done.has(id)) ?? null;
}

// apura a rodada clássica: total das mãos reveladas + quem cravou.
// Palpites únicos ⇒ no máximo UM vencedor por rodada (a eliminação converge sozinha).
export function classicRound(reveals, guesses) {
  const total = (reveals || []).reduce((a, r) => a + clampHand(r.hand), 0);
  const hit = (guesses || []).find((g) => Number(g.guess) === total);
  return { total, winnerId: hit ? hit.id : null };
}

// transição de rodada: tira quem cravou; sobrou 1 → ele paga; senão o starter gira.
// `alive` mantém a ordem da mesa (assentos); startIdx indexa `alive`.
export function nextRound(alive, startIdx, winnerId) {
  const starterId = alive[(((startIdx | 0) % alive.length) + alive.length) % alive.length];
  const next = winnerId == null ? [...alive] : alive.filter((id) => id !== winnerId);
  if (next.length <= 1) return { alive: next, startIdx: 0, loserId: next[0] ?? null, done: true };
  const idx = winnerId === starterId
    ? alive.indexOf(starterId) % next.length          // quem herdou a cadeira do starter começa
    : (next.indexOf(starterId) + 1) % next.length;    // gira pro próximo vivo
  return { alive: next, startIdx: idx, loserId: null, done: false };
}
