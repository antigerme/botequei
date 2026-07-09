// Testes do cardápio POR BOTECO (store.js) — sem deps, com um localStorage de mentira.
// Rodar: node tests/store.test.mjs
//
// O store guarda, LOCAL, o cardápio de cada lugar (chaveado pelo nome do boteco normalizado)
// pra recarregar quando você volta. Aqui travamos: normalização da chave, save/get/has,
// "última visita vence", listagem por recência e que a chave entra no backup de graça.

import assert from 'node:assert';

// localStorage de mentira: chaves de DADO ficam como props enumeráveis (pro Object.keys do
// exportAll enxergar), e os métodos ficam NÃO-enumeráveis (não vazam pro backup).
const ls = {};
Object.defineProperties(ls, {
  getItem: { value: (k) => (Object.prototype.hasOwnProperty.call(ls, k) ? ls[k] : null) },
  setItem: { value: (k, v) => { ls[k] = String(v); } },
  removeItem: { value: (k) => { delete ls[k]; } },
  clear: { value: () => { for (const k of Object.keys(ls)) delete ls[k]; } },
});
globalThis.localStorage = ls;

const store = await import('../js/store.js');
let passed = 0;
const ok = (n) => { console.log('  ✓ ' + n); passed++; };

// ---------- botecoKey: minúsculo, sem acento, espaços colapsados ----------
{
  assert.strictEqual(store.botecoKey('Bar do Zé'), 'bar do ze');
  assert.strictEqual(store.botecoKey('  BAR   do   Zé  '), 'bar do ze'); // caixa + espaços
  assert.strictEqual(store.botecoKey('Açaí & Cia'), 'acai & cia');        // acento sai, resto fica
  assert.strictEqual(store.botecoKey('Bar do Zé'), store.botecoKey('bar do ze')); // mesma chave
  assert.strictEqual(store.botecoKey(''), '');
  assert.strictEqual(store.botecoKey(null), '');
  ok('botecoKey normaliza caixa/acento/espaços e é estável');
}

// ---------- save / get / has ----------
{
  localStorage.clear();
  assert.deepStrictEqual(store.getBotecoMenu('Bar do Zé'), []); // nada salvo ainda
  assert.strictEqual(store.hasBotecoMenu('Bar do Zé'), false);

  const defs = [{ id: 'chopp', emoji: '🍺', name: 'Chopp', price: 8 }, { id: 'x-porcao', emoji: '🍟', name: 'Porção', price: 30 }];
  store.saveBotecoMenu('Bar do Zé', defs);
  assert.strictEqual(store.hasBotecoMenu('Bar do Zé'), true);
  // recupera pela MESMA chave normalizada, mesmo digitando diferente
  assert.deepStrictEqual(store.getBotecoMenu('  bar do zé '), defs);
  ok('save/get/has: guarda e recupera pelo nome normalizado');
}

// ---------- não guarda lixo (sem nome / sem itens) ----------
{
  localStorage.clear();
  store.saveBotecoMenu('', [{ id: 'x', name: 'X' }]); // sem nome
  store.saveBotecoMenu('Sem Itens', []);              // sem itens
  store.saveBotecoMenu('Defs Inválido', null);        // defs não-array
  assert.strictEqual(store.hasBotecoMenu(''), false);
  assert.strictEqual(store.hasBotecoMenu('Sem Itens'), false);
  assert.strictEqual(store.hasBotecoMenu('Defs Inválido'), false);
  ok('save ignora boteco sem nome, sem itens ou com defs inválido');
}

// ---------- "última visita vence" (você monta o cardápio de novo, ele converge) ----------
{
  localStorage.clear();
  store.saveBotecoMenu('Boteco', [{ id: 'a', name: 'A' }]);
  store.saveBotecoMenu('boteco', [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]); // MESMA chave, mais itens
  const got = store.getBotecoMenu('BOTECO');
  assert.strictEqual(got.length, 2);
  assert.deepStrictEqual(got.map((d) => d.id), ['a', 'b']);
  ok('última visita sobrescreve o cardápio do mesmo boteco');
}

// ---------- listBotecoMenus: lista todos os botecos + entra no backup de graça ----------
{
  localStorage.clear();
  store.saveBotecoMenu('Primeiro', [{ id: 'a', name: 'A' }]);
  store.saveBotecoMenu('Segundo', [{ id: 'b', name: 'B' }]);
  const names = store.listBotecoMenus().map((r) => r.name).sort();
  assert.deepStrictEqual(names, ['Primeiro', 'Segundo']); // lista os dois lugares salvos
  // exportAll varre tudo que começa com "botequei." → o cardápio por boteco viaja no backup
  const dump = store.exportAll();
  assert.ok(dump.data['botequei.botecomenu'], 'botequei.botecomenu entra no exportAll');
  ok('listBotecoMenus lista os botecos salvos e a chave entra no backup');
}

console.log(`\n${passed} blocos de teste do store (cardápio por boteco) passaram ✅`);
