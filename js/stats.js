// Consciência & ritmo (puro/testável): linha do tempo do consumo, ritmo atual e uma
// estimativa LEVE de teor alcoólico (Widmark). Tudo derivado do log de eventos + peso/sexo
// locais — nenhum dado sai do aparelho. NÃO é bafômetro: é só um lembrete pra se cuidar.

import { alcoholG } from './catalog.js';

// Meus eventos alcoólicos, em ordem de tempo, como +1/-1 com as gramas do item.
function myAlcoholSeries(log, user, resolve) {
  const out = [];
  for (const ev of log || []) {
    if (ev.user !== user) continue;
    if (ev.type !== 'ADD' && ev.type !== 'REMOVE') continue;
    const g = alcoholG(resolve(ev.item));
    if (g <= 0) continue;
    out.push({ ts: Number(ev.ts) || 0, sign: ev.type === 'ADD' ? 1 : -1, g });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

// ts do primeiro ADD alcoólico, ou -1 se não houver (ts=0 é válido, então não usar falsy).
function firstAdd(series) {
  for (const e of series) if (e.sign > 0) return e.ts;
  return -1;
}

// Ritmo: quantas bebidas na última hora + rótulo/nível. count/grams = totais líquidos.
export function paceInfo(log, user, resolve, { now }) {
  const s = myAlcoholSeries(log, user, resolve);
  let count = 0, grams = 0;
  const hourAgo = now - 3600000;
  let recent = 0;
  for (const e of s) {
    count += e.sign; grams += e.sign * e.g;
    if (e.ts >= hourAgo) recent += e.sign;
  }
  count = Math.max(0, count);
  grams = Math.max(0, grams);
  recent = Math.max(0, recent);
  const fa = firstAdd(s);
  const firstTs = fa >= 0 ? fa : 0;
  const spanMs = fa >= 0 ? Math.max(0, now - fa) : 0;
  let level = 'calmo', label = '🟢 Tranquilo';
  if (recent >= 4) { level = 'alto'; label = '🔴 Pisa no freio'; }
  else if (recent >= 2.5) { level = 'medio'; label = '🟡 No ritmo'; }
  return { count, grams, recent, perHour: recent, firstTs, spanMs, level, label };
}

// Linha do tempo: divide a noite em `buckets` fatias e conta as bebidas de cada uma.
export function timeline(log, user, resolve, { now, buckets = 12 }) {
  const s = myAlcoholSeries(log, user, resolve);
  const fa = firstAdd(s);
  if (fa < 0) return { bars: [], firstTs: 0, bucketMs: 0 };
  const span = Math.max(1, now - fa);
  const bucketMs = Math.ceil(span / buckets);
  const bars = new Array(buckets).fill(0);
  for (const e of s) {
    let i = Math.floor((e.ts - fa) / bucketMs);
    if (i < 0) i = 0;
    if (i >= buckets) i = buckets - 1;
    bars[i] += e.sign;
  }
  return { bars: bars.map((n) => Math.max(0, n)), firstTs: fa, bucketMs };
}

// Quanto tempo desde a última bebida alcoólica: { ts, agoMs } ou null se não bebeu.
export function lastDrinkAt(log, user, resolve, { now }) {
  let last = -1;
  for (const ev of log || []) {
    if (ev.user !== user || ev.type !== 'ADD') continue;
    if (alcoholG(resolve(ev.item)) <= 0) continue;
    const ts = Number(ev.ts) || 0;
    if (ts > last) last = ts;
  }
  return last < 0 ? null : { ts: last, agoMs: Math.max(0, now - last) };
}

// Hidratação: quantas águas vs bebidas alcoólicas + razão e rótulo.
export function hydration(log, user, resolve) {
  let water = 0, alc = 0;
  for (const ev of log || []) {
    if (ev.user !== user) continue;
    const sign = ev.type === 'ADD' ? 1 : ev.type === 'REMOVE' ? -1 : 0;
    if (!sign) continue;
    const def = resolve(ev.item);
    if (alcoholG(def) > 0) alc += sign;
    else if (def && def.id === 'agua') water += sign;
  }
  water = Math.max(0, water); alc = Math.max(0, alc);
  const ratio = alc > 0 ? water / alc : (water > 0 ? 1 : 0);
  let level = 'none', label = '🙂 Sem álcool ainda';
  if (alc > 0) {
    if (ratio >= 0.5) { level = 'good'; label = '💧 Bem hidratado'; }
    else if (ratio >= 0.25) { level = 'mid'; label = '💧 Dá pra melhorar'; }
    else { level = 'low'; label = '🥵 Bebe uma água!'; }
  }
  return { water, alc, ratio, level, label };
}

// Veredito "dá pra dirigir?" a partir do BAC estimado (objeto de estimateBAC ou null).
// Brasil: tolerância praticamente zero — por isso o texto é conservador.
export function driveVerdict(bac) {
  if (!bac) return { level: 'unknown', title: 'Sem estimativa', advice: 'Bota teu peso nas ⚙️ configurações pra estimar.' };
  if (bac.bac < 0.02) return { level: 'ok', title: '🟢 Provavelmente de boa', advice: 'Mesmo assim: no Brasil o limite é ~zero. Na menor dúvida, não dirija.' };
  if (bac.bac < 0.2) return { level: 'wait', title: '🟡 Melhor esperar', advice: 'A estimativa está acima de zero. Dá um tempo antes de pensar em volante.' };
  return { level: 'no', title: '🔴 Nem pensar em dirigir', advice: 'Chama um carro ou teu contato de confiança. Não vale o risco.' };
}

// Estimativa de teor alcoólico (g/L) pela fórmula de Widmark. Precisa do peso; sem ele → null.
// r: fator de distribuição (0.68 h / 0.55 m / 0.60 média). β: metabolismo ~0.15 g/L por hora.
export function estimateBAC(log, user, resolve, { now, weightKg, sex }) {
  const w = Number(weightKg) || 0;
  if (w <= 0) return null;
  const s = myAlcoholSeries(log, user, resolve);
  let grams = 0;
  for (const e of s) grams += e.sign * e.g;
  grams = Math.max(0, grams);
  const fa = firstAdd(s);
  const r = sex === 'f' ? 0.55 : sex === 'm' ? 0.68 : 0.60;
  const beta = 0.15;
  const hours = fa >= 0 ? Math.max(0, (now - fa) / 3600000) : 0;
  const peak = grams / (r * w);
  const bac = Math.max(0, peak - beta * hours);
  const soberInMs = bac > 0 ? Math.round((bac / beta) * 3600000) : 0;
  let label = '🟢 sóbrio';
  if (bac >= 0.6) label = '🔴 muito alto';
  else if (bac >= 0.3) label = '🟠 alto';
  else if (bac >= 0.1) label = '🟡 sentindo';
  return { bac, grams, label, soberInMs, canDrive: bac < 0.05 };
}
