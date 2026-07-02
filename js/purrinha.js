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

// Apura a rodada. `reveals`: [{ id, name?, hand, guess }] já verificados.
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
