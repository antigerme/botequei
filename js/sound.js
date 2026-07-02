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
