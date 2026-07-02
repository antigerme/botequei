// Efeitos sonoros gerados na hora (WebAudio) — sem arquivos. Liga/desliga nas configs.

let ctx = null;
let enabled = true;

function ac() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
  }
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function setEnabled(v) { enabled = !!v; }

function tone(freq, dur, when = 0, type = 'sine', gain = 0.06) {
  const c = ac();
  if (!c || !enabled) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  o.connect(g); g.connect(c.destination);
  const t = c.currentTime + when;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function plus() { tone(880, 0.09, 0, 'triangle', 0.05); }
export function minus() { tone(300, 0.12, 0, 'sine', 0.05); }
export function cheers() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, i * 0.08, 'sine', 0.06)); }
export function alarm() { tone(440, 0.14, 0, 'sawtooth', 0.05); tone(330, 0.2, 0.15, 'sawtooth', 0.05); }
export function pop() { tone(660, 0.07, 0, 'triangle', 0.045); }

// ---- Pacote de sons (roleta, cutucada, desafio, cerimônia) ----
export function tick() { tone(1200, 0.03, 0, 'square', 0.035); }           // passo da roleta
export function win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.16, i * 0.09, 'triangle', 0.06)); }
export function poke() { tone(760, 0.05, 0, 'square', 0.05); tone(1000, 0.06, 0.07, 'square', 0.05); }
export function challenge() { tone(330, 0.12, 0, 'sawtooth', 0.05); tone(660, 0.18, 0.12, 'sawtooth', 0.05); }
export function whistle() { [700, 900, 1100, 1300].forEach((f, i) => tone(f, 0.06, i * 0.05, 'sine', 0.045)); }
export function sad() { [440, 392, 330, 262].forEach((f, i) => tone(f, 0.16, i * 0.12, 'sine', 0.05)); }
export function coin() { tone(988, 0.06, 0, 'square', 0.05); tone(1319, 0.14, 0.06, 'square', 0.05); }
export function fanfare() { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.22, i * 0.12, 'triangle', 0.06)); }
