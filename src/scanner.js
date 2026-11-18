// Live camera barcode scanner.
// Uses Chrome's built-in BarcodeDetector (Android) and falls back to a
// self-hosted zxing-wasm build everywhere else (iPhone, desktop Firefox...).

import { digitsOnly, isValidLength, validGtin } from './game.js';

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'itf'];
let detectorPromise = null;

export function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      if ('BarcodeDetector' in window) {
        try {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          const formats = FORMATS.filter((f) => supported.includes(f));
          if (formats.length) return new window.BarcodeDetector({ formats });
        } catch { /* fall through to the wasm reader */ }
      }
      const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
        import('barcode-detector/ponyfill'),
        import('zxing-wasm/reader/zxing_reader.wasm?url'),
      ]);
      prepareZXingModule({
        overrides: { locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
      });
      return new BarcodeDetector({ formats: FORMATS });
    })();
    detectorPromise.catch(() => { detectorPromise = null; });
  }
  return detectorPromise;
}

function pickCode(results) {
  for (const r of results) {
    const c = digitsOnly(r.rawValue);
    if (isValidLength(c)) return c;
  }
  return null;
}

/** Decode a barcode from a still image (canvas, ImageBitmap or <img>). */
export async function detectInImage(source) {
  const detector = await getDetector();
  return pickCode(await detector.detect(source));
}

function cameraError(err) {
  if (!navigator.mediaDevices?.getUserMedia) return 'The camera only works on a secure (https) page.';
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access is blocked. Allow the camera for this site in Chrome (tap the icon left of the address), then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
      return 'Another app is using the camera. Close it and try again.';
    default:
      return 'The camera could not start. Try again, or type the digits instead.';
  }
}

/**
 * Open the full-screen scanner. Resolves with the digits of the first
 * barcode read, or null if the player closes it.
 */
export function openScanner(ui) {
  const { root, video, hint, closeBtn, torchBtn } = ui;
  return new Promise((resolve) => {
    let stream = null;
    let done = false;
    let timer = null;
    let pushed = false;
    let last = null;
    let torchOn = false;

    const setHint = (t, isErr = false) => { hint.textContent = t; hint.classList.toggle('err', isErr); };

    function finish(result, fromPop = false) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      root.hidden = true;
      torchBtn.hidden = true;
      document.body.classList.remove('scanning');
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('visibilitychange', onHide);
      document.removeEventListener('keydown', onKey);
      closeBtn.removeEventListener('click', onClose);
      torchBtn.removeEventListener('click', onTorch);
      if (pushed && !fromPop) history.back();
      resolve(result);
    }

    const onPop = () => { pushed = false; finish(null, true); };
    const onHide = () => { if (document.hidden) finish(null); };
    const onKey = (e) => { if (e.key === 'Escape') finish(null); };
    const onClose = () => finish(null);
    async function onTorch() {
      const track = stream?.getVideoTracks()[0];
      if (!track) return;
      try {
        torchOn = !torchOn;
        await track.applyConstraints({ advanced: [{ torch: torchOn }] });
        torchBtn.setAttribute('aria-pressed', String(torchOn));
      } catch { torchBtn.hidden = true; }
    }

    root.hidden = false;
    document.body.classList.add('scanning');
    setHint('Starting camera…');
    history.pushState({ scanner: true }, '');
    pushed = true;
    window.addEventListener('popstate', onPop); // Android back button closes the scanner
    document.addEventListener('visibilitychange', onHide);
    document.addEventListener('keydown', onKey);
    closeBtn.addEventListener('click', onClose);
    torchBtn.addEventListener('click', onTorch);
    closeBtn.focus();

    async function tick(detector) {
      if (done) return;
      if (video.readyState >= 2) {
        try {
          const code = pickCode(await detector.detect(video));
          // Real product codes carry a check digit, so one read is enough.
          // Anything else must read the same twice in a row.
          if (code && (validGtin(code) || code === last)) {
            navigator.vibrate?.(60);
            finish(code);
            return;
          }
          last = code;
        } catch { /* a frame that fails to decode is normal */ }
      }
      timer = setTimeout(() => tick(detector), 100);
    }

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('insecure');
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (done) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.srcObject = stream;
        await video.play();
        const caps = stream.getVideoTracks()[0]?.getCapabilities?.();
        torchBtn.hidden = !caps?.torch;
        torchBtn.setAttribute('aria-pressed', 'false');
      } catch (err) {
        if (!done) setHint(cameraError(err), true);
        return;
      }
      try {
        const detector = await getDetector();
        if (done) return;
        setHint('Line the barcode up inside the box');
        tick(detector);
      } catch {
        setHint('The barcode reader failed to load. Check your connection and try again.', true);
      }
    })();
  });
}
