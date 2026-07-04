// Unit do motor de truco (puro, roda em Node): hierarquias das 3 variantes, cascata de
// empates, escadas de aposta + resposta da dupla, mão de onze/dez/ferro, envido/flor,
// deal lacrado por carta (feliz + adulterado) e convergência do reducer.
import {
  deckFor, cardStr, parseCard, manilhaRank, isManilha, cardPower, vazaWinner,
  handWinner, stakeLadder, nextStake, raiseLabel, canRaise, foldPoints, mergeResponses,
  maoRule, applyResult, teamOf, dealerFor,
  envidoPoints, envidoChainValue, envidoWinner, hasFlor, florPoints, florResolve,
  cardSalt, cardCommitT, makeHandDeal, verifyOwnHand, verifyPlayReveal, verifyHandAudit,
  newTrucoHand, reduceT, settleEnvido, randomNonceT,
} from '../js/truco.js';

let n = 0;
const ok = (cond, msg) => { if (!cond) { console.error('✗ ' + msg); process.exit(1); } console.log('  ✓ ' + msg); n++; };
const C = parseCard;

// ---------- baralhos ----------
ok(deckFor('paulista').length === 40 && deckFor('mineira').length === 40 && deckFor('gaucha').length === 40,
  'baralhos com 40 cartas nas três variantes');
ok(new Set(deckFor('gaucha').map(cardStr)).size === 40 && deckFor('gaucha').some((c) => c.r === '12' && c.s === 'bastos'),
  'espanhol tem 1-7/10/11/12 e nada repetido');

// ---------- hierarquia paulista (vira → manilha seguinte; ♦<♠<♥<♣) ----------
{
  const vira = C('7:copas'); // manilha = Q
  ok(manilhaRank(vira) === 'Q' && isManilha(C('Q:paus'), 'paulista', vira), 'vira 7 ⇒ manilha é a dama (Q)');
  const zap = cardPower(C('Q:paus'), 'paulista', vira), copas = cardPower(C('Q:copas'), 'paulista', vira);
  const espadilha = cardPower(C('Q:espadas'), 'paulista', vira), pica = cardPower(C('Q:ouros'), 'paulista', vira);
  ok(zap > copas && copas > espadilha && espadilha > pica && pica > cardPower(C('3:paus'), 'paulista', vira),
    'zap > copas > espadinha > pica-fumo > 3 solto');
  ok(cardPower(C('3:ouros'), 'paulista', vira) === cardPower(C('3:paus'), 'paulista', vira),
    'não-manilha empata por rank (naipe não desempata)');
  const virou3 = C('3:ouros'); // manilha cicla 3 → 4
  ok(isManilha(C('4:paus'), 'paulista', virou3), 'vira 3 ⇒ manilha cicla pro 4');
}

// ---------- hierarquia mineira (fixas 4♣ > 7♥ > A♠ > 7♦) ----------
{
  const p = (s) => cardPower(C(s), 'mineira', null);
  ok(p('4:paus') > p('7:copas') && p('7:copas') > p('A:espadas') && p('A:espadas') > p('7:ouros') && p('7:ouros') > p('3:paus'),
    'mineira: 4♣ > 7♥ > A♠ > 7♦ > 3');
  ok(isManilha(C('A:espadas'), 'mineira', null) && !isManilha(C('A:paus'), 'mineira', null),
    'só as quatro fixas são manilha');
}

// ---------- hierarquia gaúcha (espanhol; pardas nos degraus iguais) ----------
{
  const p = (s) => cardPower(C(s), 'gaucha', null);
  ok(p('1:espadas') > p('1:bastos') && p('1:bastos') > p('7:espadas') && p('7:espadas') > p('7:ouros') && p('7:ouros') > p('3:copas'),
    'gaúcha: espadão > bastão > 7♠ > 7♦ > 3');
  ok(p('3:copas') === p('3:bastos') && p('1:copas') === p('1:ouros') && p('7:copas') === p('7:bastos'),
    'degrau igual empata (parda): 3=3, 1♥=1♦, 7♥=7♣');
  ok(p('12:espadas') > p('11:espadas') && p('11:copas') > p('10:copas') && p('5:ouros') > p('4:ouros'),
    '12 > 11 > 10 e 5 > 4 na rabeira');
}

// ---------- vaza e cascata de empates ----------
{
  const vira = C('4:ouros'); // manilha = 5
  const w = vazaWinner([
    { p: 'a', team: 0, card: C('3:copas') },
    { p: 'b', team: 1, card: C('5:paus') },
  ], 'paulista', vira);
  ok(w.p === 'b', 'manilha come 3 na vaza');
  const parda = vazaWinner([
    { p: 'a', team: 0, card: C('K:copas') },
    { p: 'b', team: 1, card: C('K:ouros') },
  ], 'paulista', vira);
  ok(parda === null, 'mesmo rank entre times = parda');
  const mesmaDupla = vazaWinner([
    { p: 'a', team: 0, card: C('K:copas') },
    { p: 'c', team: 0, card: C('K:ouros') },
    { p: 'b', team: 1, card: C('Q:paus') },
  ], 'paulista', null);
  ok(mesmaDupla && mesmaDupla.team === 0, 'empate DENTRO da dupla não é parda');

  // cascata: [W,T]=W · [T,W]=W · [W,L,T]=1ª · [T,T,W]=W · [T,T,T]=null (pta) / mão (gaúcha)
  ok(handWinner([0, null], 1, 'paulista') === 0, 'ganhou a 1ª + parda depois = leva na hora');
  ok(handWinner([null, 1], 0, 'paulista') === 1, '1ª parda → 2ª decide');
  ok(handWinner([0, 1], 0, 'paulista') === 'pending' && handWinner([0, 1, null], 1, 'paulista') === 0,
    '1-1 e terceira parda → dono da 1ª');
  ok(handWinner([null, null, 1], 0, 'paulista') === 1, 'duas pardas → 3ª decide');
  ok(handWinner([null, null, null], 0, 'paulista') === null, 'três pardas na paulista: ninguém pontua');
  ok(handWinner([null, null, null], 1, 'gaucha') === 1, 'três pardas na gaúcha: time do mão leva');
  ok(handWinner([0, 0], 1, 'paulista') === 0 && handWinner([1, null, 1], 0, 'paulista') === 1, 'duas vazas fecham');
}

// ---------- escadas, rótulos e resposta da dupla ----------
{
  ok(JSON.stringify(stakeLadder('paulista')) === '[1,3,6,9,12]' &&
     JSON.stringify(stakeLadder('mineira')) === '[2,4,6,8,10,12]' &&
     JSON.stringify(stakeLadder('gaucha')) === '[1,2,3,4]', 'escadas por variante');
  ok(nextStake('paulista', 1) === 3 && nextStake('paulista', 9) === 12 && nextStake('paulista', 12) === null,
    'próximo degrau e teto');
  ok(raiseLabel('gaucha', 3) === 'RETRUCO!' && raiseLabel('gaucha', 4) === 'VALE QUATRO!' && raiseLabel('mineira', 10) === 'DEZ!',
    'gritos certos por degrau');
  ok(canRaise('paulista', 3, 0, 1) && !canRaise('paulista', 3, 1, 1) && !canRaise('paulista', 12, 0, 1),
    'só o time que não fez a última proposta aumenta');
  ok(mergeResponses(['fold', 'accept']) === 'accept' && mergeResponses(['accept', 'raise']) === 'raise' &&
     mergeResponses(['fold']) === 'fold' && mergeResponses([]) === null,
    'resposta da dupla: vale a mais forte, em qualquer ordem');
  ok(foldPoints('paulista', 1) === 1 && foldPoints('mineira', 4) === 4, 'correr entrega o último valor aceito');
}

// ---------- mão de onze / dez / ferro ----------
{
  ok(maoRule('paulista', [11, 7]).type === 'maoDe' && maoRule('paulista', [11, 7]).value === 3 &&
     maoRule('paulista', [11, 7]).foldGives === 1, 'paulista: mão de onze joga por 3, correr dá 1');
  ok(maoRule('mineira', [4, 10]).type === 'maoDe' && maoRule('mineira', [4, 10]).value === 4 &&
     maoRule('mineira', [4, 10]).foldGives === 2, 'mineira: mão de DEZ joga por 4, correr dá 2');
  ok(maoRule('paulista', [11, 11]).type === 'ferro' && maoRule('paulista', [11, 11]).value === 3 &&
     maoRule('mineira', [10, 10]).value === 2, 'ferro: 11×11 vale 3 (pta) e 10×10 vale 2 (min)');
  ok(maoRule('gaucha', [23, 20]).type === null, 'gaúcha não tem mão especial');
  const r = applyResult([10, 9], 0, 3, 'paulista');
  ok(r.score[0] === 12 && r.winner === 0 && applyResult([20, 9], 0, 3, 'gaucha').winner === null,
    'placar fecha em 12 (pta) e segue até 24 (gaúcha)');
  ok(teamOf(0) === 0 && teamOf(3) === 1 && dealerFor(5, 4) === 1, 'times alternados e dealer girando');
}

// ---------- envido & flor ----------
{
  ok(envidoPoints([C('7:espadas'), C('6:espadas'), C('12:bastos')]) === 33, 'envido máximo: 7+6 do naipe = 33');
  ok(envidoPoints([C('12:copas'), C('11:copas'), C('4:ouros')]) === 20, 'duas figuras do naipe = 20');
  ok(envidoPoints([C('7:espadas'), C('4:bastos'), C('2:ouros')]) === 7, 'sem par: vale a mais alta');
  ok(envidoChainValue(['E']).accept === 2 && envidoChainValue(['E']).fold === 1 &&
     envidoChainValue(['E', 'RE']).accept === 5 && envidoChainValue(['E', 'RE']).fold === 2,
    'cadeia E=2/recusa 1 · E+RE=5/recusa 2');
  ok(envidoWinner([{ team: 0, points: 28 }, { team: 1, points: 28 }], 1) === 1, 'empate de envido → mão leva');
  ok(hasFlor([C('2:ouros'), C('5:ouros'), C('12:ouros')]) && florPoints([C('2:ouros'), C('5:ouros'), C('12:ouros')]) === 27,
    'flor detectada e pontuada (2+5+0+20)');
  const fr = florResolve([{ team: 0, points: 27 }, { team: 1, points: 31 }], 0);
  ok(fr.team === 1 && fr.points === 6 && florResolve([{ team: 0, points: 24 }], 1).points === 3,
    'duas flores: maior leva 6 · uma flor: 3');
}

// ---------- deal lacrado por carta (feliz + adulterado) ----------
{
  const master = randomNonceT();
  const deck = deckFor('paulista');
  const { commits, hands, vira } = await makeHandDeal(deck, 2, master, true);
  ok(commits.length === 40 && hands.length === 2 && hands[0].length === 3 && !!vira,
    'deal 2p: 40 lacres, 3 cartas por mão e vira');
  ok(await verifyOwnHand(hands[0], commits) && await verifyOwnHand(hands[1], commits),
    'cada jogador confere a própria mão contra os lacres');
  const play = hands[1][2];
  ok(await verifyPlayReveal({ i: play.i, card: play.card, salt: play.salt }, commits),
    'jogada revela carta+salt e todo peer valida');
  ok(!(await verifyPlayReveal({ i: play.i, card: C('3:paus'), salt: play.salt }, commits)),
    'trocar a carta na revelação é PEGO');
  const audit = await verifyHandAudit({ deckCut: deck, master, commits });
  ok(audit.ok, 'auditoria do fim de partida fecha com o master');
  const deckAdulterado = deck.slice(); deckAdulterado[7] = deckAdulterado[8];
  ok(!(await verifyHandAudit({ deckCut: deckAdulterado, master, commits })).ok,
    'baralho adulterado reprova na auditoria');
  ok((await cardCommitT(C('A:paus'), await cardSalt(master, 3))) !== commits[3] || cardStr(deck[3]) === 'A:paus',
    'lacre é por POSIÇÃO (salt derivado do master:i)');
}

// ---------- reducer: mão 1v1 completa com truco aceito ----------
{
  let st = newTrucoHand({ variant: 'paulista', order: ['a', 'b'], dealerIdx: 1, vira: C('4:ouros') }); // manilha = 5
  ok(st.maoIdx === 0 && st.turnIdx === 0 && st.stake === 1, 'mão é quem senta depois do dealer e fala primeiro');
  st = reduceT(st, { t: 'raise', p: 'a' });                       // TRUCO!
  ok(!!st.pend && st.pend.value === 3, 'truco propõe 3');
  const foraDeHora = reduceT(st, { t: 'play', p: 'b', card: C('6:copas') });
  ok(foraDeHora === st, 'com truco no ar ninguém joga carta (evento ignorado)');
  st = reduceT(st, { t: 'resp', p: 'b', r: 'accept' });
  st = reduceT(st, { t: 'respClose' });
  ok(st.stake === 3 && !st.pend && st.lastRaiserTeam === 0, 'aceitou: vale 3 e a dupla que trucou não re-truca');
  st = reduceT(st, { t: 'play', p: 'a', card: C('5:paus') });     // manilha zap
  st = reduceT(st, { t: 'play', p: 'b', card: C('3:copas') });
  ok(st.results[0] === 0 && st.turnIdx === 0, 'vaza 1 do time 0; vencedor lidera a próxima');
  st = reduceT(st, { t: 'play', p: 'a', card: C('K:ouros') });
  st = reduceT(st, { t: 'play', p: 'b', card: C('K:copas') });    // parda
  ok(st.over && st.winnerTeam === 0 && st.points === 3, 'ganhou a 1ª + parda: mão fecha valendo o truco');
}

// ---------- reducer: correr no truco entrega o valor anterior ----------
{
  let st = newTrucoHand({ variant: 'mineira', order: ['a', 'b'], dealerIdx: 0 });
  ok(st.stake === 2, 'mineira começa valendo 2');
  st = reduceT(st, { t: 'raise', p: 'b' });                       // mão é b (dealer 0)
  st = reduceT(st, { t: 'resp', p: 'a', r: 'fold' });
  st = reduceT(st, { t: 'respClose' });
  ok(st.over && st.winnerTeam === teamOf(1) && st.points === 2, 'correu do truco mineiro: leva os 2 da mesa');
}

// ---------- reducer 2v2: resposta da dupla comuta (fold + raise ⇒ raise) ----------
{
  const mk = () => {
    let s = newTrucoHand({ variant: 'gaucha', order: ['a', 'b', 'c', 'd'], dealerIdx: 3 });
    s = reduceT(s, { t: 'raise', p: 'a' });                       // TRUCO (vale 2)
    return s;
  };
  const s1o = [{ t: 'resp', p: 'b', r: 'fold' }, { t: 'resp', p: 'd', r: 'raise' }];
  let s1 = mk(); for (const e of s1o) s1 = reduceT(s1, e); s1 = reduceT(s1, { t: 'respClose' });
  let s2 = mk(); for (const e of [...s1o].reverse()) s2 = reduceT(s2, e); s2 = reduceT(s2, { t: 'respClose' });
  ok(JSON.stringify(s1) === JSON.stringify(s2), 'ordem das respostas da dupla não muda o estado (CRDT max)');
  ok(s1.stake === 2 && s1.pend && s1.pend.value === 3 && s1.pend.byTeam === 1,
    'raise na resposta: aceita o 2 e devolve RETRUCO (3) da outra dupla');
  let s3 = reduceT(s1, { t: 'resp', p: 'a', r: 'accept' });
  s3 = reduceT(s3, { t: 'respClose' });
  ok(s3.stake === 3 && !s3.pend, 'RETRUCO aceito: vale 3');
}

// ---------- reducer: envido gaúcho na 1ª vaza (aceito e recusado) ----------
{
  let st = newTrucoHand({ variant: 'gaucha', order: ['a', 'b'], dealerIdx: 1 });
  st = reduceT(st, { t: 'envido', p: 'a' });
  ok(st.envido.pendBy === 0, 'envido abre disputa');
  const joga = reduceT(st, { t: 'play', p: 'a', card: C('1:espadas') });
  ok(joga === st, 'com envido no ar ninguém joga');
  st = reduceT(st, { t: 'envresp', p: 'b', r: 'accept' });
  ok(st.envido.closed && st.envido.value === 2, 'envido aceito vale 2');
  st = reduceT(st, { t: 'envpoints', p: 'a', points: 31 });
  st = reduceT(st, { t: 'envpoints', p: 'b', points: 29 });
  st = settleEnvido(st);
  ok(st.envido.winner === 0, 'maior envido leva (31 × 29)');

  let r2 = newTrucoHand({ variant: 'gaucha', order: ['a', 'b'], dealerIdx: 1 });
  r2 = reduceT(r2, { t: 'envido', p: 'a' });
  r2 = reduceT(r2, { t: 'envresp', p: 'b', r: 'fold' });
  ok(r2.envido.closed && r2.envido.winner === 0 && r2.envido.value === 1, 'recusou o envido: quem chamou leva 1');

  // Real Envido: quem responde SOBE a cadeia (E → E+RE = 5; recusar o RE entrega 2)
  let r3 = newTrucoHand({ variant: 'gaucha', order: ['a', 'b'], dealerIdx: 1 });
  r3 = reduceT(r3, { t: 'envido', p: 'a' });
  r3 = reduceT(r3, { t: 'realenvido', p: 'b' });
  ok(r3.envido.pendBy === 1 && r3.envido.chain.join('+') === 'E+RE', 'RE sobe a cadeia e devolve a decisão');
  const r3a = reduceT(r3, { t: 'envresp', p: 'a', r: 'accept' });
  ok(r3a.envido.closed && r3a.envido.value === 5, 'E+RE aceito vale 5');
  let r3b = reduceT(r3, { t: 'envresp', p: 'a', r: 'fold' });
  ok(r3b.envido.closed && r3b.envido.winner === 1 && r3b.envido.value === 2, 'correr do RE entrega os 2 do E');
}

// ---------- reducer: convergência com eventos permutados (respostas) ----------
{
  const base = () => {
    let s = newTrucoHand({ variant: 'paulista', order: ['a', 'b', 'c', 'd'], dealerIdx: 0, vira: C('7:copas') });
    s = reduceT(s, { t: 'play', p: 'b', card: C('3:ouros') });
    s = reduceT(s, { t: 'raise', p: 'c' });
    return s;
  };
  const evs = [{ t: 'resp', p: 'b', r: 'accept' }, { t: 'resp', p: 'd', r: 'accept' }];
  let x = base(); for (const e of evs) x = reduceT(x, e); x = reduceT(x, { t: 'respClose' });
  let y = base(); for (const e of [...evs].reverse()) y = reduceT(y, e); y = reduceT(y, { t: 'respClose' });
  ok(JSON.stringify(x) === JSON.stringify(y) && x.stake === 3, 'permutação de respostas converge (2v2 aceita truco)');
}

console.log(`\n${n} testes de truco passaram ✅`);
