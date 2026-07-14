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
  // length/key: os métodos ficam NÃO-enumeráveis → Object.keys(ls) devolve só as chaves de DADO
  // (o que o logKeys()/storageScan() varrem pra achar botequei.log.* etc.)
  length: { get: () => Object.keys(ls).length },
  key: { value: (i) => Object.keys(ls)[i] ?? null },
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

// ---------- deleteBotecoMenu: apaga SÓ o cardápio (check-ins do passaporte ficam) ----------
{
  localStorage.clear();
  store.saveBotecoMenu('Bar do Zé', [{ id: 'a', name: 'A' }]);
  store.addCheckin({ name: 'Bar do Zé', at: 1, lat: null, lng: null });
  assert.strictEqual(store.hasBotecoMenu('Bar do Zé'), true);
  assert.strictEqual(store.deleteBotecoMenu('bar do ze'), true); // pela chave normalizada
  assert.strictEqual(store.hasBotecoMenu('Bar do Zé'), false);   // cardápio some
  assert.strictEqual(store.getCheckins().length, 1);             // check-in continua
  assert.strictEqual(store.deleteBotecoMenu('Inexistente'), false);
  ok('deleteBotecoMenu apaga só o cardápio salvo (check-ins continuam)');
}

// ---------- renameBoteco: renomeia o LUGAR INTEIRO (cardápio + check-ins + histórico) ----------
{
  localStorage.clear();
  store.saveBotecoMenu('Bar do Zé', [{ id: 'a', name: 'A' }]);
  store.addCheckin({ name: 'Outro Lugar', at: 1 });
  store.addCheckin({ name: 'Bar do Zé', at: 2 });
  store.pushHistory({ room: 'R1', title: 'Bar do Zé', at: 3, myMoney: 10, items: [] });
  store.pushHistory({ room: 'R2', title: 'Outro Lugar', at: 4, myMoney: 5, items: [] });

  assert.strictEqual(store.renameBoteco('Bar do Zé', 'Bar do João'), true);
  assert.strictEqual(store.hasBotecoMenu('Bar do João'), true);       // cardápio mudou de chave
  assert.strictEqual(store.hasBotecoMenu('Bar do Zé'), false);
  assert.deepStrictEqual(store.getBotecoMenu('Bar do João').map((d) => d.id), ['a']);
  assert.deepStrictEqual(store.getCheckins().map((c) => c.name).sort(), ['Bar do João', 'Outro Lugar']); // só o do lugar
  assert.deepStrictEqual(store.getHistory().map((e) => e.title).sort(), ['Bar do João', 'Outro Lugar']);
  ok('renameBoteco move o cardápio e renomeia check-ins + histórico do MESMO lugar');
}

// ---------- renameBoteco: só ajuste de caixa/acento (mesma chave) atualiza o nome exibido ----------
{
  localStorage.clear();
  store.saveBotecoMenu('bar do ze', [{ id: 'a', name: 'A' }]);
  store.addCheckin({ name: 'bar do ze', at: 1 });
  assert.strictEqual(store.renameBoteco('bar do ze', 'Bar do Zé'), true); // mesma chave normalizada
  assert.strictEqual(store.listBotecoMenus()[0].name, 'Bar do Zé');       // nome exibido atualiza
  assert.strictEqual(store.getCheckins()[0].name, 'Bar do Zé');
  assert.strictEqual(store.hasBotecoMenu('bar do ze'), true);             // segue existindo (mesma chave)
  ok('renameBoteco só de caixa/acento atualiza o nome sem perder o cardápio');
}

// ---------- couvert por boteco: save/get + normaliza a chave + entra no backup ----------
{
  localStorage.clear();
  assert.strictEqual(store.getBotecoCouvert('Bar do Zé'), 0); // nada salvo → 0
  store.saveBotecoCouvert('Bar do Zé', 12);
  assert.strictEqual(store.getBotecoCouvert('  bar do zé '), 12); // recupera pela MESMA chave normalizada
  store.saveBotecoCouvert('BAR DO ZE', 8);                        // regrava (mesma chave) → última vence
  assert.strictEqual(store.getBotecoCouvert('Bar do Zé'), 8);
  store.saveBotecoCouvert('', 5);                                 // sem nome: não guarda
  assert.strictEqual(store.getBotecoCouvert(''), 0);
  assert.strictEqual(store.getBotecoCouvert('Outro Bar'), 0);     // lugar sem couvert salvo → 0
  store.saveBotecoCouvert('Boteco X', 'lixo');                    // valor inválido → coage pra 0
  assert.strictEqual(store.getBotecoCouvert('Boteco X'), 0);
  const dump = store.exportAll();
  assert.ok(dump.data['botequei.botecocouvert'], 'botequei.botecocouvert entra no exportAll');
  ok('saveBotecoCouvert/getBotecoCouvert: guarda por boteco (chave normalizada) e entra no backup');
}

// ---------- Apagar granular: passaporte (um check-in / todos) ----------
{
  localStorage.clear();
  store.addCheckin({ name: 'Bar A', at: 1 });
  store.addCheckin({ name: 'Bar B', at: 2 });
  store.addCheckin({ name: 'Bar C', at: 3 });
  assert.strictEqual(store.getCheckins().length, 3);
  store.removeCheckin(2);                                   // some só o do meio (casa pelo `at`)
  assert.deepStrictEqual(store.getCheckins().map((c) => c.at).sort(), [1, 3]);
  store.clearCheckins();
  assert.strictEqual(store.getCheckins().length, 0);
  ok('removeCheckin apaga um check-in pelo `at`; clearCheckins zera o passaporte');
}

// ---------- Apagar granular: mesas & números (histórico + logs + mesa aberta) ----------
{
  localStorage.clear();
  store.saveEvents('R1', [{ eventId: 'a' }]);
  store.saveEvents('R2', [{ eventId: 'b' }]);
  store.pushHistory({ room: 'R1', title: 'Bar', at: 1, items: [] });
  store.setCurrent('R2');
  assert.strictEqual(store.getEvents('R1').length, 1);
  store.clearHistory();
  assert.strictEqual(store.getHistory().length, 0);        // histórico some
  assert.strictEqual(store.getEvents('R1').length, 0);     // o log de cada mesa some junto
  assert.strictEqual(store.getEvents('R2').length, 0);     // inclusive log órfão (sem entrada no histórico)
  assert.strictEqual(store.getCurrent(), null);            // a mesa aberta some
  ok('clearHistory apaga histórico + TODOS os logs de mesa (inclusive órfãos) + a mesa aberta');
}

// ---------- Apagar granular: cardápios (menus + couverts) e diário do modo dev ----------
{
  localStorage.clear();
  store.saveBotecoMenu('Bar', [{ id: 'a', name: 'A' }]);
  store.saveBotecoCouvert('Bar', 12);
  store.addDevLog({ k: 'x', t: 1 });
  store.clearBotecoMenus();
  assert.strictEqual(store.hasBotecoMenu('Bar'), false);
  assert.strictEqual(store.getBotecoCouvert('Bar'), 0);    // couvert lembrado some junto
  assert.strictEqual(store.getDevLog().length, 1);         // diário do dev NÃO é afetado por isso
  store.clearDevLog();
  assert.strictEqual(store.getDevLog().length, 0);
  ok('clearBotecoMenus apaga cardápios + couverts; clearDevLog zera o diário técnico');
}

// ---------- Apagar granular: rever tour PRESERVA o devUnlocked ----------
{
  localStorage.clear();
  store.setFlag('welcomeSeen'); store.setFlag('tourSeen'); store.setFlag('tourDone_basico'); store.setFlag('devUnlocked');
  store.resetOnboarding();
  assert.strictEqual(store.getFlag('welcomeSeen'), false); // boas-vindas voltam a aparecer
  assert.strictEqual(store.getFlag('tourSeen'), false);
  assert.strictEqual(store.getFlag('tourDone_basico'), false);
  assert.strictEqual(store.getFlag('devUnlocked'), true);  // MAS o modo dev segue destravado
  ok('resetOnboarding zera welcome/tour e PRESERVA o devUnlocked');
}

// ---------- Apagar granular: um LUGAR inteiro (cardápio + couvert + check-ins + histórico) ----------
{
  localStorage.clear();
  store.saveBotecoMenu('Bar do Zé', [{ id: 'a', name: 'A' }]);
  store.saveBotecoCouvert('Bar do Zé', 10);
  store.addCheckin({ name: 'Bar do Zé', at: 1 });
  store.addCheckin({ name: 'Outro Lugar', at: 2 });
  store.pushHistory({ room: 'R1', title: 'Bar do Zé', at: 3, items: [] });
  store.pushHistory({ room: 'R2', title: 'Outro Lugar', at: 4, items: [] });
  store.saveEvents('R1', [{ eventId: 'x' }]);

  assert.strictEqual(store.deletePlace('bar do ze'), true); // pela chave normalizada
  assert.strictEqual(store.hasBotecoMenu('Bar do Zé'), false);
  assert.strictEqual(store.getBotecoCouvert('Bar do Zé'), 0);
  assert.strictEqual(store.getEvents('R1').length, 0);      // o log da mesa daquele lugar some
  assert.deepStrictEqual(store.getCheckins().map((c) => c.name), ['Outro Lugar']); // só o do lugar saiu
  assert.deepStrictEqual(store.getHistory().map((e) => e.title), ['Outro Lugar']);
  assert.strictEqual(store.deletePlace(''), false);
  ok('deletePlace apaga cardápio + couvert + check-ins + histórico (e logs) de um lugar só');
}

console.log(`\n${passed} blocos de teste do store (cardápio + couvert + apagar granular) passaram ✅`);
