// Trilha "lo-fi de boteco" gerada na hora com a Web Audio API — SEM arquivo de áudio
// (mesma ideia do sound.js). Um pad de acordes com 7ª + uma batidinha suave, em loop.
// Expõe um AnalyserNode pra o visualizador do "modo festa" desenhar. Tudo efêmero.

let ctx = null, master = null, analyser = null, timer = null, playing = false;
let nextTime = 0, step = 0;

const BPM = 74;
const BEAT = 60 / BPM;      // segundos por batida
const STEP = BEAT / 2;      // colcheia
// Progressão lo-fi (um acorde por compasso): Am7 · Dm7 · G7 · Cmaj7 (freqs em Hz)
const CHORDS = [
  [220.0, 261.6, 329.6, 392.0],
  [146.8, 220.0, 293.7, 349.2],
  [196.0, 246.9, 293.7, 392.0],
  [130.8, 196.0, 261.6, 329.6],
];

function noiseBuffer() {
  const n = ctx.sampleRate * 0.2;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 1;
  for (let i = 0; i < n; i++) { seed = (seed * 16807) % 2147483647; d[i] = (seed / 1073741823) - 1; }
  return buf;
}
let hatBuf = null;

function pad(freqs, t) {
  for (const f of freqs) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    o.connect(g); g.connect(master);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.5);       // ataque lento
    g.gain.exponentialRampToValueAtTime(0.0001, t + BEAT * 4); // solta ao longo do compasso
    o.start(t); o.stop(t + BEAT * 4 + 0.1);
  }
}
function kick(t) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.15);
  o.connect(g); g.connect(master);
  g.gain.setValueAtTime(0.16, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  o.start(t); o.stop(t + 0.25);
}
function hat(t) {
  const s = ctx.createBufferSource(), g = ctx.createGain(), hp = ctx.createBiquadFilter();
  s.buffer = hatBuf; hp.type = 'highpass'; hp.frequency.value = 7000;
  s.connect(hp); hp.connect(g); g.connect(master);
  g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  s.start(t); s.stop(t + 0.06);
}

function playStep(t, s) {
  const inBar = s % 8;
  if (inBar === 0) pad(CHORDS[Math.floor(s / 8) % CHORDS.length], t);
  if (inBar === 0 || inBar === 4) kick(t);           // beats 1 e 3
  if (inBar % 2 === 1) hat(t);                        // contratempos
}
function scheduler() {
  while (nextTime < ctx.currentTime + 0.25) {
    playStep(nextTime, step);
    nextTime += STEP;
    step = (step + 1) % 32; // loop de 4 compassos
  }
}

export function start() {
  if (playing) return true;
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.9;
      analyser = ctx.createAnalyser(); analyser.fftSize = 128;
      master.connect(analyser); analyser.connect(ctx.destination);
      hatBuf = noiseBuffer();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    step = 0; nextTime = ctx.currentTime + 0.1;
    scheduler();
    timer = setInterval(scheduler, 60);
    playing = true;
    return true;
  } catch { return false; }
}
export function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  playing = false;
  if (master && ctx) { try { master.gain.setValueAtTime(0.0001, ctx.currentTime); } catch { /* ignore */ } setTimeout(() => { if (master) master.gain.value = 0.9; }, 300); }
}
export function isPlaying() { return playing; }
// Espectro (0..255) pro visualizador; array vazio se não estiver tocando.
export function spectrum() {
  if (!analyser) return new Uint8Array(0);
  const a = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(a);
  return a;
}
