// E2E da "mesh redonda" (a) + (b): quando um peer aparece no signaling mas o P2P NUNCA fecha
// (NAT/firewall — aqui simulado por um peer FANTASMA que só faz `join` e nunca responde ao
// WebRTC), o app (a) MARCA o peer como travado (mesh.peers().stuck, visível no __presDbg) e
// (b) transforma o banner de conexão numa AÇÃO: tocar → abre o pareamento por QR (a saída zero
// servidor, host candidate na mesma Wi-Fi/hotspot). Nenhuma mudança de servidor: o fantasma é
// só um `join` que o e2e mantém vivo — exatamente a cara de um 4G que não fura.
//
//   node server/node.mjs &
//   node tests/e2e-mesh-stuck.mjs
//
// Variaveis: BASE (default http://127.0.0.1:8000), CHROME.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:8000';
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SEED = () => {
  localStorage.setItem('botequei.name', 'André');
  localStorage.setItem('botequei.flags', JSON.stringify({ welcomeSeen: 1, tourSeen: 1 }));
  localStorage.setItem('botequei.settings', JSON.stringify({ lang: 'pt' }));
};

async function main() {
  const browser = await chromium.launch({
    executablePath: CHROME, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-features=WebRtcHideLocalIpsWithMdns'],
  });
  const ctx = await browser.newContext();
  await ctx.addInitScript(SEED);
  const p = await ctx.newPage();

  // 1) cria a mesa (o atalho ?nova=1 já dispara o create) → entra na malha (sem PIN → sigRoom = código)
  await p.goto(BASE + '?nova=1');
  await p.waitForSelector('#screen-table.is-active', { timeout: 20000 });
  const code = await p.evaluate(() => { const m = location.hash.match(/room=([^&]+)/); return m ? m[1] : null; });
  if (!code) throw new Error('não achei o código da sala no hash');

  // 2) peer FANTASMA: só faz join (fica "presente" pro signaling) e NUNCA responde ao WebRTC.
  //    Re-join a cada 7s pra não vencer o TTL de presença (15s).
  const ghost = 'ghostpeer99';
  const ghostJoin = () => fetch(`${BASE}/signaling?room=${code}&action=join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ peer: ghost }),
  }).catch(() => {});
  await ghostJoin();
  const keep = setInterval(ghostJoin, 7000);

  let n = 0;
  const ok = (cond, msg) => { if (!cond) throw new Error('✗ ' + msg); console.log('  ✓ ' + msg); n++; };

  try {
    // 3) (a) passados ~UNREACHABLE_MS (18s), o fantasma vira "travado" em mesh.peers() (via __presDbg)
    await p.waitForFunction((g) => {
      const d = window.__presDbg && window.__presDbg();
      return !!(d && d.peers && d.peers.some((x) => x.u === g && x.stuck));
    }, ghost, { timeout: 30000 });
    ok(true, '(a) peer presente no signaling mas sem fechar o P2P vira stuck em mesh.peers()');

    // 4) (b) o banner de conexão vira AÇÃO: role=button + o aviso 🔌 (apontando pro parear por QR)
    await p.waitForFunction(() => {
      const b = document.getElementById('conn-banner');
      return !!(b && !b.hidden && b.getAttribute('role') === 'button' && /🔌/.test(b.textContent || ''));
    }, null, { timeout: 8000 });
    ok(true, '(b) banner de conexão vira botão tappável com o aviso de travado');

    // 5) tocar no banner abre o pareamento sem internet (QR/hotspot — zero servidor).
    //    Criar a mesa abre o convite por cima; o usuário fecha e aí vê/toca o banner (fluxo real).
    await p.keyboard.press('Escape');
    await p.waitForSelector('#overlay-invite', { state: 'hidden', timeout: 5000 });
    await p.click('#conn-banner');
    await p.waitForSelector('#overlay-offline:not([hidden])', { timeout: 5000 });
    ok(true, '(b) tocar no banner abre o overlay de parear sem internet (QR)');
  } finally {
    clearInterval(keep);
  }

  await ctx.close();
  await browser.close();
  console.log(`\n${n} verificacoes E2E (mesh redonda: stuck + nudge QR) passaram ✅`);
}

main().catch((e) => { console.error('\n✗ E2E MESH-STUCK FALHOU:', e.message); process.exit(1); });
