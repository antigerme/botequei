// Unit do núcleo puro da sala (server/core.mjs) — o coração que o servidor Node (VM) e o
// Durable Object (Cloudflare) compartilham. Relógio injetado: nada de sleep.
import { Room, clean, PRESENCE_TTL, MBOX_TTL, MAX_BODY } from '../server/core.mjs';

let n = 0;
const ok = (cond, msg) => { if (!cond) { console.error('✗ ' + msg); process.exit(1); } console.log('  ✓ ' + msg); n++; };

// ---- clean(): mesmo charset de sempre; o ~ do PIN some nos dois lados igual ----
ok(clean('MESA~abc12') === 'MESAabc12' && clean('a b!c') === 'abc' && clean('') === '' && clean(null) === '',
  'clean() poda tudo fora de [A-Za-z0-9_-] (PIN com ~ vira o mesmo namespace)');
ok(clean('AZ09_-') === 'AZ09_-', 'clean() preserva o charset válido');

// ---- presença: TTL de 15s, re-toque renova, leave é imediato ----
{
  const r = new Room();
  let t = 1_000_000;
  r.touch('ana', t); r.touch('bia', t);
  ok(r.peersAll(t).length === 2 && r.peersFor('ana', t).length === 1 && r.peersFor('ana', t)[0].peer === 'bia',
    'peersAll inclui o próprio; peersFor exclui (join/poll vs action=peers)');
  t += PRESENCE_TTL; // exatamente no limite ainda vale (<=)
  ok(r.live(t).size === 2, 'no limite exato do TTL ainda está vivo');
  t += 1;
  r.gc(t);
  ok(r.live(t).size === 0, '1ms além do TTL: presença expirou no gc');
  r.touch('ana', t); r.touch('bia', t);
  t += PRESENCE_TTL - 1;
  r.touch('bia', t); // bia re-tocou (poll dela)
  t += 2;
  ok([...r.live(t)].join(',') === 'bia', 're-toque renova só quem apareceu');
  r.drop('bia');
  ok(r.live(t).size === 0, 'leave derruba na hora, sem esperar TTL');
}

// ---- sockets (extra): WebSocket aberto É presença, e soma com a presença por TTL ----
{
  const r = new Room();
  const t = 5_000_000;
  r.touch('poller', t);
  const peers = r.peersFor('wsguy', t, ['wsguy', 'outra']);
  ok(peers.map((p) => p.peer).sort().join(',') === 'outra,poller',
    'lista viva = polling fresco ∪ sockets abertos, sempre sem o próprio');
  ok(!r.idle(t, ['wsguy']) && r.idle(t + PRESENCE_TTL + 1, []), 'sala só fica ociosa sem TTLs vivos, caixas e sockets');
}

// ---- mailbox: FIFO por destinatário, drain entrega exatamente uma vez, TTL 120s ----
{
  const r = new Room();
  let t = 9_000_000;
  r.push(Room.msg('ana', 'bia', 'offer', { sdp: 'x' }, t), t);
  r.push(Room.msg('ana', 'bia', 'ice', { c: 1 }, t + 10), t + 10);
  r.push(Room.msg('bia', 'ana', 'answer', null, t + 20), t + 20);
  const deBia = r.drain('bia');
  ok(deBia.length === 2 && deBia[0].type === 'offer' && deBia[1].type === 'ice',
    'drain devolve a fila do destinatário em ordem FIFO');
  ok(deBia[0].ts === Math.floor(t / 1000) && deBia[0].payload.sdp === 'x' && deBia[1].payload.c === 1,
    'mensagem canônica: ts em segundos e payload intacto');
  ok(r.drain('bia').length === 0, 'segundo drain vem vazio — entrega exatamente uma vez');
  ok(r.drain('ana').length === 1 && r.drain('ninguem').length === 0, 'caixas são por destinatário');
  r.push(Room.msg('ana', 'caio', 'offer', {}, t), t);
  r.gc(t + MBOX_TTL); // no limite ainda vive
  ok(r.drain('caio').length === 1, 'caixa no limite do TTL ainda entrega');
  r.push(Room.msg('ana', 'caio', 'offer', {}, t), t);
  r.gc(t + MBOX_TTL + 1);
  ok(r.drain('caio').length === 0, 'caixa órfã morre 1ms depois do TTL');
  ok(Room.msg('a', 'b', 'ice', undefined, t).payload === null, 'payload ausente vira null (contrato)');
}

// ---- nextDeadline: o menor vencimento (presença ou caixa) — vira o alarm do DO ----
{
  const r = new Room();
  const t = 42_000_000;
  ok(r.nextDeadline() === null, 'sala vazia não agenda nada');
  r.touch('ana', t);
  ok(r.nextDeadline() === t + PRESENCE_TTL, 'com presença, vence no TTL dela');
  r.push(Room.msg('x', 'y', 'ice', {}, t - 119_000), t - 119_000);
  ok(r.nextDeadline() === t - 119_000 + MBOX_TTL, 'caixa mais antiga vence antes e manda no deadline');
}

// ---- MAX_BODY exportado (os adaptadores aplicam o teto no HTTP e no frame WS) ----
ok(MAX_BODY === 65536, 'teto de corpo/frame preservado do contrato antigo');

console.log(`\n${n} testes do núcleo da sala passaram ✅`);
