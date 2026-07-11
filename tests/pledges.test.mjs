// Unit do motor de CRÉDITO/PROMESSA (o "settle") — a conta calculada no ESTADO FINAL, que mata o
// "Dinheiro B" (o −1 do toque longo deixava dinheiro fantasma na conta do pagador). Prova as
// regras travadas com o André: rodada justa (1 de cada), pago só o que foi bebido (evapora),
// garrafa unificada, e CONVERGÊNCIA (ordem dos eventos não muda o resultado — regra de ouro CRDT).
//
//   node tests/pledges.test.mjs

import {
  emptyState, applyEvent, settle, userMoney, coveredCount, paidCount, sharePool, summary,
} from '../js/events.js';
// NB: os factories (makeAdd/makePledge…) chamam clientId()→localStorage, que não existe no Node.
// Por isso o unit MONTA os eventos na mão (como o reducer.test); os factories são exercidos no e2e.

let pass = 0, fail = 0;
const approx = (a, b) => Math.abs(a - b) < 1e-9;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + msg); } }
function eqm(desc, got, want) { ok(approx(got, want), `${desc} (got ${got}, want ${want})`); }

const CH = { id: 'chopp', price: 10, share: false };
const GA = { id: 'garrafa', price: 12, share: true };
const RES = (i) => (i === 'chopp' ? CH : i === 'garrafa' ? GA : null);

let _s = 0;
const stamp = (o, ts) => ({ ts: (ts != null ? ts : 1000 + (_s++)), eventId: 'e' + (_s++), ...o });
const ADD = (user, item, ts) => stamp({ type: 'ADD', user, item }, ts);
const REM = (user, item, ts) => stamp({ type: 'REMOVE', user, item }, ts);
const PLD = (from, item, o, ts) => stamp({ type: 'PLEDGE', id: o.id, from, item, scope: o.scope || null, units: o.units != null ? o.units : null, active: true }, ts);
const OFF = (from, id, ts) => stamp({ type: 'PLEDGE', id, from, active: false }, ts);
function build(events) { const st = emptyState(); for (const e of events) applyEvent(st, e); return st; }
const bill = (st) => [...settle(st, RES).money.values()].reduce((a, b) => a + b, 0);

// Cenário 1 — baseline: sem promessa, cada um paga o seu
{
  const st = build([ADD('ana', 'chopp'), ADD('ana', 'chopp'), ADD('bruno', 'chopp')]);
  eqm('C1 Ana 2×10', userMoney(st, 'ana', RES), 20);
  eqm('C1 Bruno 1×10', userMoney(st, 'bruno', RES), 10);
}

// Cenário 2 — rodada justa: Diego banca 1 de cada pra {ana,bruno,carla}; ana/bruno beberam 2, carla 1
{
  const st = build([
    ADD('ana', 'chopp'), ADD('ana', 'chopp'), ADD('bruno', 'chopp'), ADD('bruno', 'chopp'), ADD('carla', 'chopp'),
    PLD('diego', 'chopp', { id: 'p1', scope: ['ana', 'bruno', 'carla'] }),
  ]);
  eqm('C2 Ana paga (2-1)', userMoney(st, 'ana', RES), 10);
  eqm('C2 Bruno paga (2-1)', userMoney(st, 'bruno', RES), 10);
  eqm('C2 Carla paga 0', userMoney(st, 'carla', RES), 0);
  eqm('C2 Diego banca 3', userMoney(st, 'diego', RES), 30);
  eqm('C2 soma = 5 chopps', bill(st), 50);
}

// Cenário 3 — O MATA-FANTASMA: carla dá −1 (consumo dela vira 0)
{
  const st = build([
    ADD('ana', 'chopp'), ADD('ana', 'chopp'), ADD('bruno', 'chopp'), ADD('bruno', 'chopp'), ADD('carla', 'chopp'),
    PLD('diego', 'chopp', { id: 'p1', scope: ['ana', 'bruno', 'carla'] }),
    REM('carla', 'chopp'), // −1 do toque longo, SEM payer
  ]);
  eqm('C3 Carla paga 0', userMoney(st, 'carla', RES), 0);
  eqm('C3 Diego banca só 2 (min(1,0) p/ carla)', userMoney(st, 'diego', RES), 20);
  eqm('C3 soma == contador (4 chopps, SEM fantasma)', bill(st), 40);
  eqm('C3 covered da carla capado em 0', coveredCount(st, 'carla', 'chopp', RES), 0);
}

// Cenário 4 — extra além da rodada: ana bebeu 3, rodada cobre 1
{
  const st = build([
    ADD('ana', 'chopp'), ADD('ana', 'chopp'), ADD('ana', 'chopp'),
    PLD('diego', 'chopp', { id: 'p1', scope: ['ana'] }),
  ]);
  eqm('C4 Ana paga 2 (extra)', userMoney(st, 'ana', RES), 20);
  eqm('C4 Diego banca 1', userMoney(st, 'diego', RES), 10);
  eqm('C4 covered da ana = 1', coveredCount(st, 'ana', 'chopp', RES), 1);
}

// Cenário 5 — dois fiadores, 1 chopp da ana: o de ts MENOR cobre, o outro evapora (determinístico)
{
  const st = build([
    ADD('ana', 'chopp'),
    PLD('ze', 'chopp', { id: 'pz', scope: ['ana'] }, 200),     // ts maior
    PLD('diego', 'chopp', { id: 'pd', scope: ['ana'] }, 100),  // ts menor → cobre primeiro
  ]);
  eqm('C5 Diego (ts menor) banca 1', userMoney(st, 'diego', RES), 10);
  eqm('C5 Ze (ts maior) banca 0', userMoney(st, 'ze', RES), 0);
  eqm('C5 Ana paga 0', userMoney(st, 'ana', RES), 0);
}

// Cenário 6 — garrafa unificada: ze banca 2 de 3 na mesa → ze 2, sobra 1 no bolo
{
  const st = build([
    ADD('mesa', 'garrafa'), ADD('mesa', 'garrafa'), ADD('mesa', 'garrafa'),
    PLD('ze', 'garrafa', { id: 'g1', units: 2 }),
  ]);
  eqm('C6 Ze banca 2×12', userMoney(st, 'ze', RES), 24);
  const pool = sharePool(st, RES);
  eqm('C6 sobra 1 garrafa no bolo', pool.lines.reduce((a, l) => a + l.count, 0), 1);
  eqm('C6 bolo = 12', pool.total, 12);
  eqm('C6 paidCount ze garrafa = 2', paidCount(st, 'ze', 'garrafa', RES), 2);
}

// Cenário 7 — prometeu 2 garrafas, só 1 aberta → paga 1 (evapora)
{
  const st = build([ADD('mesa', 'garrafa'), PLD('ze', 'garrafa', { id: 'g1', units: 2 })]);
  eqm('C7 Ze paga só 1×12', userMoney(st, 'ze', RES), 12);
  eqm('C7 bolo zerado', sharePool(st, RES).total, 0);
}

// Cenário 8 — CONVERGÊNCIA: mesma cena, ordem dos eventos EMBARALHADA → mesmo resultado
{
  const evs = [
    ADD('ana', 'chopp'), ADD('bruno', 'chopp'),
    PLD('diego', 'chopp', { id: 'pd', scope: ['ana', 'bruno'] }, 100),
    PLD('ze', 'chopp', { id: 'pz', scope: ['ana'] }, 200),
  ];
  const a = build(evs), b = build([...evs].reverse());
  eqm('C8 Diego igual nas duas ordens', userMoney(a, 'diego', RES), userMoney(b, 'diego', RES));
  eqm('C8 Ze igual nas duas ordens', userMoney(a, 'ze', RES), userMoney(b, 'ze', RES));
  eqm('C8 Diego banca 2 (ts menor pega os dois)', userMoney(a, 'diego', RES), 20);
  eqm('C8 Ze banca 0 (ana já coberta)', userMoney(a, 'ze', RES), 0);
}

// Cenário 9 — desfazer a rodada (pledge cancelado por LWW) → cada um volta a pagar o seu
{
  const st = build([
    ADD('ana', 'chopp'),
    PLD('diego', 'chopp', { id: 'p1', scope: ['ana'] }, 100),
    OFF('diego', 'p1', 200), // cancela (ts maior)
  ]);
  eqm('C9 Ana volta a pagar 1', userMoney(st, 'ana', RES), 10);
  eqm('C9 Diego não banca', userMoney(st, 'diego', RES), 0);
}
// Cenário 9b — cancelamento CHEGA ANTES do create (fora de ordem): LWW ainda derruba (ts manda)
{
  const st = build([
    ADD('ana', 'chopp'),
    OFF('diego', 'p1', 200),                                    // cancel chega 1º
    PLD('diego', 'chopp', { id: 'p1', scope: ['ana'] }, 100),   // create chega depois, ts menor → perde
  ]);
  eqm('C9b cancel fora de ordem: Ana paga 1', userMoney(st, 'ana', RES), 10);
  eqm('C9b cancel fora de ordem: Diego banca 0', userMoney(st, 'diego', RES), 0);
}

// Cenário 10 — higiene P2P no reducer: units/scope do fio são COADOS na ENTRADA
{
  const st = build([
    stamp({ type: 'PLEDGE', id: 'bad1', from: 'ze', item: 'garrafa', units: -5, active: true }),
    stamp({ type: 'PLEDGE', id: 'bad2', from: 'ze', item: 'garrafa', units: 99999, active: true }),
    stamp({ type: 'PLEDGE', id: 'bad3', from: 'ze', item: 'chopp', scope: 'xx', active: true }), // scope não-array
  ]);
  ok((st.pledges.get('bad1') || {}).units === 0, 'C10 units<0 coada p/ 0 no reducer');
  ok((st.pledges.get('bad2') || {}).units === 999, 'C10 units gigante capada em 999');
  ok((st.pledges.get('bad3') || {}).scope === null, 'C10 scope não-array vira null');
  const st2 = build([stamp({ type: 'PLEDGE', from: 'ze', item: 'garrafa', units: 1, active: true })]);
  ok(st2.pledges.size === 0, 'C10 PLEDGE sem id é rejeitado');
}

// Cenário 11 — summary reflete o acerto (o placar/card usam money do settle)
{
  const st = build([
    ADD('ana', 'chopp'), ADD('bruno', 'chopp'),
    PLD('diego', 'chopp', { id: 'p1', scope: ['ana', 'bruno'] }),
  ]);
  const rows = summary(st, RES);
  const m = (u) => (rows.find((r) => r.user === u) || {}).money;
  eqm('C11 summary: Ana 0 (coberta)', m('ana'), 0);
  eqm('C11 summary: Diego banca 2', m('diego'), 20);
}

// Cenário 12 — pledge de item inexistente / sem preço não quebra nem cobra
{
  const st = build([ADD('ana', 'agua'), PLD('diego', 'agua', { id: 'p1', scope: ['ana'] })]);
  eqm('C12 item sem def: ninguém é cobrado', bill(st), 0);
}

console.log(`\n${pass} asserts do motor de crédito passaram, ${fail} falharam ${fail ? '❌' : '✅'}`);
process.exit(fail ? 1 : 0);
