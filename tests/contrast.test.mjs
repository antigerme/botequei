// Trava de CONTRASTE (WCAG 2.x) dos temas (escuro + claro) — lê o styles.css DE VERDADE, extrai os tokens
// de cor de cada tema e mede a razão de luminância dos pares que importam. Mudou uma cor no
// CSS? O teste re-mede sozinho. Regras travadas:
//   • texto ≥ 4.5:1 (AA): cream/muted/gold/danger/ok sobre fundo E sobre card; texto do botão
//     sobre os DOIS extremos do gradiente (gold e gold-deep);
//   • não-textual ≥ 3:1: o traço de giz (--chalk-line, composto por alpha) sobre o fundo.
// Rodar: node tests/contrast.test.mjs

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'styles.css'), 'utf8');
let passed = 0;
const ok = (n) => { console.log('  ✓ ' + n); passed++; };

// ---- WCAG: luminância relativa + razão de contraste ----
const expand = (h) => (h.length === 4 ? '#' + [...h.slice(1)].map((c) => c + c).join('') : h);
const rgb = (h) => { h = expand(h).slice(1); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); };
const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = (c) => { const [r, g, b] = rgb(c).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
// composição do rgba(r,g,b,a) sobre um fundo sólido (pro traço de giz)
const over = (rgba, bg) => {
  const m = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*(\.?[\d.]+)\)/);
  const a = parseFloat(m[4]);
  const b = rgb(bg).map((c) => c * 255);
  const out = [m[1], m[2], m[3]].map((c, i) => Math.round(Number(c) * a + b[i] * (1 - a)));
  return '#' + out.map((c) => c.toString(16).padStart(2, '0')).join('');
};

// ---- extrai os tokens por tema direto do CSS ----
function varsOf(block) {
  const out = {};
  for (const m of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
function blockOf(selector) {
  const i = css.indexOf(selector);
  assert.ok(i >= 0, `bloco ${selector} não encontrado no styles.css`);
  return css.slice(i, css.indexOf('}', i));
}
const root = varsOf(blockOf(':root {'));
const themes = { dark: root };
for (const t of ['light']) themes[t] = { ...root, ...varsOf(blockOf(`body.${t} {`)) };

// ---- as travas ----
for (const [name, v] of Object.entries(themes)) {
  const btnTxt = v['on-gold']; // o "on-primary": todo texto sobre preenchimento âmbar usa este token
  const pairs = [
    ['texto/fundo', v.cream, v.bg], ['texto/card', v.cream, v.card],
    ['secundário/fundo', v.muted, v.bg], ['secundário/card', v.muted, v.card],
    ['destaque/fundo', v.gold, v.bg], ['destaque/card', v.gold, v.card],
    ['danger/fundo', v.danger, v.bg], ['danger/card', v.danger, v.card],
    ['ok/fundo', v.ok, v.bg], ['ok/card', v.ok, v.card],
    ['botão: texto/gold', btnTxt, v.gold], ['botão: texto/gold-deep', btnTxt, v['gold-deep']],
  ];
  for (const [label, fg, bg] of pairs) {
    const r = ratio(fg, bg);
    assert.ok(r >= 4.5, `${name}: ${label} = ${r.toFixed(2)} (< 4.5:1) — ${fg} sobre ${bg}`);
  }
  const chalk = ratio(over(v['chalk-line'], v.bg), v.bg);
  assert.ok(chalk >= 3.0, `${name}: traço de giz = ${chalk.toFixed(2)} (< 3:1 não-textual)`);
  ok(`tema ${name}: 12 pares de texto ≥ 4.5:1 e giz ≥ 3:1`);
}

console.log(`\n${passed} blocos de contraste (WCAG AA) passaram ✅`);
