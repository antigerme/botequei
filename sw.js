// Service worker do Botequei — cache do "app shell" para abrir offline e instalar como PWA.
// Importante: nunca intercepta o signaling.php nem requisicoes que nao sejam GET.
const CACHE = 'botequei-v17';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'fonts/anton-latin.woff2',
  'fonts/patrickhand-latin.woff2',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable.png',
  'js/app.js',
  'js/ui.js',
  'js/mesh.js',
  'js/signaling.js',
  'js/events.js',
  'js/store.js',
  'js/identity.js',
  'js/catalog.js',
  'js/qr.js',
  'js/vendor/qrcode.js',
  'js/settings.js',
  'js/sound.js',
  'js/music.js',
  'js/achievements.js',
  'js/stats.js',
  'js/lifestats.js',
  'js/league.js',
  'js/tournament.js',
  'js/deck.js',
  'js/i18n.js',
  'js/share.js',
  'js/pix.js',
  'js/handshake.js',
  'js/scan.js',
  // js/vendor/jsqr.js NAO entra no shell: e grande e so usado no fallback de camera (iOS);
  // carrega sob demanda e o proprio SW cacheia no primeiro uso (runtime).
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // 'reload' fura o HTTP cache do navegador/CDN ao instalar -> nunca grava uma versao velha
    // de um modulo junto de outra nova (o classico "does not provide an export" atras de CDN).
    // resiliente: um asset ausente nao derruba a instalacao.
    await Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    // NAO chama skipWaiting aqui: a nova versao espera o usuario aceitar (via mensagem),
    // pra nao trocar o app embaixo de quem esta usando. O app avisa "nova versao".
  })());
});

// O app manda 'SKIP_WAITING' quando o usuario toca em "Atualizar".
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Sinalizacao/TURN e qualquer coisa que nao seja GET: sempre rede, sem cache.
  if (req.method !== 'GET' || url.pathname.endsWith('signaling.php') || url.pathname.endsWith('turn.php')) return;
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      // guarda estaticos same-origin para a proxima
      if (res && res.ok && res.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      // navegacao offline -> devolve o shell
      if (req.mode === 'navigate') return caches.match('index.html');
      throw err;
    }
  })());
});
