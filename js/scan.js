// Leitor de QR pela câmera, sem rede. Usa o BarcodeDetector nativo (Android/Chrome) e,
// quando ele não existe (ex.: iOS/Safari), cai para o jsQR vendorado (carregado sob demanda).
// Se nada disso rolar, o app ainda tem o copia-e-cola como caminho universal.

let _jsqr = null;
async function loadJsQR() {
  if (_jsqr) return _jsqr;
  const m = await import('./vendor/jsqr.js');
  _jsqr = m.default || m.jsQR || m;
  return _jsqr;
}

export function scanSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// Abre a câmera no <video> e resolve com o texto do 1º QR lido.
// Devolve um objeto com stop() pra cancelar (fechar overlay). Rejeita em erro/cancelamento.
export function scanQR(video, { onError } = {}) {
  let stream = null;
  let raf = 0;
  let stopped = false;
  let detector = null;
  const canvas = document.createElement('canvas');

  const cleanup = () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    if (stream) { try { stream.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ } }
    try { video.srcObject = null; } catch { /* ignore */ }
  };

  const promise = new Promise((resolve, reject) => {
    const fail = (e) => { cleanup(); reject(e); };
    const ok = (txt) => { cleanup(); resolve(txt); };

    (async () => {
      if (!scanSupported()) { fail(new Error('sem-camera')); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      } catch (e) { if (onError) onError(e); fail(e); return; }
      if (stopped) { cleanup(); return; }
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      try { await video.play(); } catch { /* alguns browsers so tocam apos gesto — segue */ }

      try { if ('BarcodeDetector' in window) detector = new window.BarcodeDetector({ formats: ['qr_code'] }); }
      catch { detector = null; }

      const tick = async () => {
        if (stopped) return;
        try {
          if (detector) {
            const codes = await detector.detect(video);
            if (codes && codes.length && codes[0].rawValue) { ok(codes[0].rawValue); return; }
          } else {
            const w = video.videoWidth, h = video.videoHeight;
            if (w && h) {
              const jsQR = await loadJsQR();
              canvas.width = w; canvas.height = h;
              const g = canvas.getContext('2d', { willReadFrequently: true });
              g.drawImage(video, 0, 0, w, h);
              const img = g.getImageData(0, 0, w, h);
              const res = jsQR(img.data, w, h);
              if (res && res.data) { ok(res.data); return; }
            }
          }
        } catch (e) { if (onError) onError(e); /* segue tentando nos proximos frames */ }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();
  });

  return { promise, stop: cleanup };
}
