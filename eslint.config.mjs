// ESLint (flat config) — só correção, sem estilo. Objetivo: pegar bug de verdade em CI
// (variável não declarada/importada — a classe do `shareRetro` —, chave duplicada, atribuição
// em const, código morto), sem opinar sobre formatação. Auto-contido: não depende de
// @eslint/js nem do pacote `globals` (os globais estão listados à mão), então roda com só
// `npx eslint`. O app continua sem build/toolchain — isto vive só no dev/CI.

const browser = {
  document: 'readonly', window: 'readonly', navigator: 'readonly', location: 'readonly',
  localStorage: 'readonly', sessionStorage: 'readonly', history: 'readonly', screen: 'readonly',
  console: 'readonly', fetch: 'readonly', crypto: 'readonly', performance: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', queueMicrotask: 'readonly',
  atob: 'readonly', btoa: 'readonly', structuredClone: 'readonly', matchMedia: 'readonly',
  alert: 'readonly', confirm: 'readonly', prompt: 'readonly',
  URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly', File: 'readonly', FileReader: 'readonly',
  TextEncoder: 'readonly', TextDecoder: 'readonly', CompressionStream: 'readonly', DecompressionStream: 'readonly',
  Image: 'readonly', Audio: 'readonly', AudioContext: 'readonly', webkitAudioContext: 'readonly',
  Event: 'readonly', CustomEvent: 'readonly', MessageEvent: 'readonly', MouseEvent: 'readonly',
  KeyboardEvent: 'readonly', TouchEvent: 'readonly', PointerEvent: 'readonly',
  MutationObserver: 'readonly', IntersectionObserver: 'readonly', ResizeObserver: 'readonly',
  createImageBitmap: 'readonly',
  AbortController: 'readonly', AbortSignal: 'readonly', Notification: 'readonly',
  RTCPeerConnection: 'readonly', RTCSessionDescription: 'readonly', RTCIceCandidate: 'readonly',
  WebSocket: 'readonly', DeviceMotionEvent: 'readonly', DeviceOrientationEvent: 'readonly',
  NDEFReader: 'readonly', BarcodeDetector: 'readonly', DOMParser: 'readonly',
  Request: 'readonly', Response: 'readonly', Headers: 'readonly', FormData: 'readonly',
  caches: 'readonly', ServiceWorkerRegistration: 'readonly', getComputedStyle: 'readonly',
  HTMLElement: 'readonly', Node: 'readonly', requestIdleCallback: 'readonly',
};
const node = {
  process: 'readonly', Buffer: 'readonly', console: 'readonly', global: 'readonly',
  setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
  URL: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly', structuredClone: 'readonly',
  fetch: 'readonly', queueMicrotask: 'readonly',
};

// Regras de correção (nada de estilo). Erro derruba o CI; warn (variável não usada) só informa.
const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',
  'no-const-assign': 'error',
  'no-redeclare': 'error',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'no-class-assign': 'error',
  'no-unreachable': 'error',
  'no-cond-assign': ['error', 'except-parens'],
  'no-self-assign': 'error',
  'no-self-compare': 'error',
  'no-unsafe-negation': 'error',
  'no-unsafe-finally': 'error',
  'no-obj-calls': 'error',
  'no-sparse-arrays': 'error',
  'no-empty-pattern': 'error',
  'no-fallthrough': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'getter-return': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
};

export default [
  { ignores: ['js/vendor/**', 'icons/**', 'fonts/**'] },
  {
    files: ['js/**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: browser },
    rules,
  },
  {
    files: ['sw.js'],
    languageOptions: {
      ecmaVersion: 2023, sourceType: 'script',
      globals: { ...browser, self: 'readonly', clients: 'readonly', skipWaiting: 'readonly', addEventListener: 'readonly' },
    },
    rules,
  },
  {
    // testes rodam em Node, mas os callbacks de page.evaluate()/waitForFunction() rodam no
    // navegador — então precisam dos globais do browser (document/localStorage) também.
    files: ['tests/**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...node, ...browser } },
    rules,
  },
  {
    // lado servidor: núcleo puro + adaptador Node (VM). Roda em Node puro.
    files: ['server/**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...node, URLSearchParams: 'readonly', AbortSignal: 'readonly', Response: 'readonly' } },
    rules,
  },
  {
    // adaptador Cloudflare: roda no workerd (globals de Workers, não de Node).
    files: ['worker/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023, sourceType: 'module',
      globals: {
        Response: 'readonly', Request: 'readonly', Headers: 'readonly', URL: 'readonly',
        URLSearchParams: 'readonly', fetch: 'readonly', crypto: 'readonly', console: 'readonly',
        TextEncoder: 'readonly', TextDecoder: 'readonly', AbortSignal: 'readonly',
        btoa: 'readonly', atob: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly',
        WebSocketPair: 'readonly', WebSocketRequestResponsePair: 'readonly',
      },
    },
    rules,
  },
];
