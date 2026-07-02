// Auditoria estática do Botequei — pura (Node, sem deps), pensada pros "gotchas" do CLAUDE.md.
// Roda em segundos e pega uma classe de bugs que os testes de runtime só pegam nos caminhos
// que exercitam:
//   1) Grafo de import/export: todo `import { X } from './y.js'` tem `export X` em y.js e o
//      arquivo existe. (A mesma falha do "does not provide an export named …" atrás do CDN,
//      e do shareRetro importado errado.)
//   2) Shell do Service Worker: todo `js/*.js` do shell está no array SHELL do sw.js e todo
//      caminho do SHELL existe em disco; o CACHE tem formato válido. (CLAUDE.md: "ao adicionar
//      js do shell, atualize o sw.js e bump o CACHE".)
//   3) IDS do ui.js: todo `el['x']` usado está no array IDS, e todo IDS existe como id no
//      index.html. (CLAUDE.md: "todo id novo precisa entrar no array IDS".)
//   4) i18n: toda chave `data-i18n`/`data-i18n-ph` do index.html existe no dicionário pt.
//
// Uso: `node tests/audit.mjs` (sai 1 se achar qualquer inconsistência).

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const problems = [];
const fail = (msg) => problems.push(msg);

// ---------- coleta de arquivos ----------
function listJs(dir) {
  const out = [];
  for (const name of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, name.name);
    if (name.isDirectory()) out.push(...listJs(rel));
    else if (name.name.endsWith('.js')) out.push(rel);
  }
  return out;
}
const JS_FILES = listJs('js');
const TEST_FILES = readdirSync(join(ROOT, 'tests')).filter((f) => f.endsWith('.mjs')).map((f) => join('tests', f));

// ---------- parser leve de import/export ----------
// Tira comentários antes de casar import/export (evita "achar" statements dentro de comentário).
// Preserva o :// de URLs ao só cortar // que não vem depois de dois-pontos.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
function parseImports(raw) {
  const src = stripComments(raw);
  const imports = []; // { names:[{name}], ns:bool, source }
  // side-effect: import './x.js'
  const re = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const clause = m[1].trim();
    const source = m[2];
    const named = [];
    let ns = false;
    const brace = clause.match(/\{([\s\S]*?)\}/);
    if (brace) {
      for (const part of brace[1].split(',')) {
        const p = part.trim();
        if (!p) continue;
        const asMatch = p.match(/^([\w$]+)\s+as\s+([\w$]+)$/);
        named.push({ imported: asMatch ? asMatch[1] : p });
      }
    }
    if (/\*\s+as\s+[\w$]+/.test(clause)) ns = true;
    imports.push({ named, ns, source });
  }
  return imports;
}
function parseExports(raw) {
  const src = stripComments(raw);
  const names = new Set();
  let m;
  const add = (n) => n && names.add(n);
  for (const re of [
    /export\s+(?:async\s+)?function\s*\*?\s*([\w$]+)/g,
    /export\s+(?:const|let|var)\s+([\w$]+)/g,
    /export\s+class\s+([\w$]+)/g,
  ]) { while ((m = re.exec(src))) add(m[1]); }
  if (/export\s+default\b/.test(src)) add('default');
  // export { a, b as c } [from '...']
  const reBlock = /export\s*\{([^}]*)\}/g;
  while ((m = reBlock.exec(src))) {
    for (const part of m[1].split(',')) {
      const p = part.trim();
      if (!p) continue;
      const asMatch = p.match(/^([\w$]+)\s+as\s+([\w$]+)$/);
      add(asMatch ? asMatch[2] : p);
    }
  }
  return names;
}

// ---------- 1) grafo de import/export ----------
const exportsCache = new Map();
function exportsOf(relPath) {
  if (!exportsCache.has(relPath)) exportsCache.set(relPath, parseExports(read(relPath)));
  return exportsCache.get(relPath);
}
for (const file of [...JS_FILES, ...TEST_FILES]) {
  const src = read(file);
  for (const imp of parseImports(src)) {
    if (!imp.source.startsWith('.')) continue; // ignora specifiers de pacote (playwright-core, node:*)
    const target = relative(ROOT, resolve(dirname(join(ROOT, file)), imp.source));
    if (!existsSync(join(ROOT, target))) { fail(`[import] ${file}: importa de "${imp.source}" mas ${target} não existe`); continue; }
    if (imp.ns || !imp.named.length) continue;
    const exp = exportsOf(target);
    for (const { imported } of imp.named) {
      if (!exp.has(imported)) fail(`[import] ${file}: importa { ${imported} } de "${imp.source}", mas ${target} não exporta esse nome`);
    }
  }
}

// ---------- 2) shell do service worker ----------
{
  const sw = read('sw.js');
  const cache = sw.match(/const\s+CACHE\s*=\s*['"]([^'"]+)['"]/);
  if (!cache) fail('[sw] não achei a constante CACHE');
  else if (!/^botequei-v\d+$/.test(cache[1])) fail(`[sw] CACHE "${cache[1]}" fora do padrão botequei-vN`);

  const shellBlock = sw.match(/const\s+SHELL\s*=\s*\[([\s\S]*?)\]/);
  const shell = new Set();
  if (!shellBlock) fail('[sw] não achei o array SHELL');
  else for (const s of shellBlock[1].matchAll(/['"]([^'"]+)['"]/g)) shell.add(s[1]);

  // js/vendor/jsqr.js é lazy de propósito (fora do shell); o resto do js é shell.
  const LAZY = new Set(['js/vendor/jsqr.js']);
  for (const f of JS_FILES) {
    if (LAZY.has(f)) continue;
    if (!shell.has(f)) fail(`[sw] ${f} não está no SHELL do sw.js (novo módulo do shell? adicione e bump o CACHE)`);
  }
  // todo caminho local do SHELL existe
  for (const entry of shell) {
    if (entry === './' || /^https?:/.test(entry)) continue;
    if (!existsSync(join(ROOT, entry))) fail(`[sw] SHELL lista "${entry}", que não existe em disco`);
  }
}

// ---------- 3) IDS do ui.js ----------
{
  const ui = read('js/ui.js');
  const idsBlock = ui.match(/const\s+IDS\s*=\s*\[([\s\S]*?)\];/);
  const ids = new Set();
  if (!idsBlock) fail('[ui] não achei o array IDS');
  else for (const s of idsBlock[1].matchAll(/['"]([\w-]+)['"]/g)) ids.add(s[1]);

  // todo el['x'] literal está em IDS (ignora comentários)
  for (const m of stripComments(ui).matchAll(/\bel\[\s*['"]([\w-]+)['"]\s*\]/g)) {
    if (!ids.has(m[1])) fail(`[ui] el['${m[1]}'] usado mas ausente do array IDS (el['${m[1]}'] seria undefined)`);
  }
  // todo IDS existe como id no index.html
  const html = read('index.html');
  const htmlIds = new Set([...html.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));
  for (const id of ids) if (!htmlIds.has(id)) fail(`[ui] IDS tem '${id}', mas não existe id="${id}" no index.html`);
}

// ---------- 4) chaves de i18n ----------
{
  const html = read('index.html');
  const i18n = read('js/i18n.js');
  // isola o bloco pt: { ... } por contagem de chaves
  const start = i18n.indexOf('pt:');
  const braceStart = i18n.indexOf('{', start);
  let depth = 0, end = -1;
  for (let i = braceStart; i < i18n.length; i++) {
    if (i18n[i] === '{') depth++;
    else if (i18n[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const ptBlock = braceStart >= 0 && end > braceStart ? i18n.slice(braceStart + 1, end) : '';
  const ptKeys = new Set();
  for (const m of ptBlock.matchAll(/(?:^|[\s,{])(?:([\w$]+)|['"]([\w.$-]+)['"])\s*:/g)) ptKeys.add(m[1] || m[2]);

  const used = new Set([...html.matchAll(/data-i18n(?:-ph)?="([\w.$-]+)"/g)].map((m) => m[1]));
  for (const k of used) if (!ptKeys.has(k)) fail(`[i18n] index.html usa data-i18n "${k}", que não existe no dicionário pt`);
}

// ---------- resultado ----------
if (problems.length) {
  console.error(`\n❌ auditoria achou ${problems.length} problema(s):\n`);
  for (const p of problems) console.error('  • ' + p);
  console.error('');
  process.exit(1);
}
console.log(`✓ import/export coerentes (${JS_FILES.length} módulos js + ${TEST_FILES.length} testes)`);
console.log('✓ shell do service worker cobre o js e o CACHE está no padrão');
console.log("✓ ui.js: todo el['x'] está em IDS e todo IDS existe no index.html");
console.log('✓ i18n: toda chave data-i18n do index.html existe no dicionário pt');
console.log('\n✅ auditoria passou');
