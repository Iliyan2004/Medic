// Input helpers built on browser features (no libraries, no extra data):
//  • voiceInput — speak instead of typing (Urdu or English), via the Web Speech API
//  • scanCode   — read the 2D DataMatrix on a medicine pack with the camera, via BarcodeDetector
import { getLang, toast, html } from './views/_shared.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canVoice = !!SR;

/** Adds a 🎤 button after each input/textarea matching `selector` inside `root`. */
export function voiceInput(root, selector) {
  if (!SR) return;
  for (const field of root.querySelectorAll(selector)) {
    if (field.dataset.voice) continue;
    field.dataset.voice = '1';
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-sm mic'; b.textContent = '🎤';
    b.setAttribute('aria-label', 'Speak instead of typing'); b.title = 'Speak instead of typing';
    field.insertAdjacentElement('afterend', b);
    let rec = null;
    b.addEventListener('click', () => {
      if (rec) { rec.stop(); return; }
      rec = new SR();
      rec.lang = getLang() === 'ur' ? 'ur-PK' : 'en-PK';
      rec.interimResults = true;
      b.classList.add('listening'); b.textContent = '⏺';
      let base = field.value ? `${field.value.trim()} ` : '';
      rec.onresult = (e) => {
        const text = [...e.results].map((r) => r[0].transcript).join('');
        field.value = base + text;
        if (e.results[e.results.length - 1].isFinal) { base = field.value + ' '; field.dispatchEvent(new Event('change', { bubbles: true })); }
      };
      rec.onerror = (e) => { if (e.error !== 'aborted') toast(e.error === 'not-allowed' ? 'Microphone permission is needed to speak' : 'Could not hear — try again', true); };
      rec.onend = () => { rec = null; b.classList.remove('listening'); b.textContent = '🎤'; };
      rec.start();
    });
  }
}

export const canScan = 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

/**
 * Opens the camera full-screen and resolves with the first DataMatrix / QR code read, or null if closed.
 * Raw GS1 strings keep their GS separators, which the server parser understands.
 */
export async function scanCode() {
  if (!canScan) throw new Error('This browser cannot scan codes — type the code printed next to the barcode');
  const formats = (await BarcodeDetector.getSupportedFormats()).filter((f) => ['data_matrix', 'qr_code'].includes(f));
  if (!formats.length) throw new Error('This phone cannot read DataMatrix codes — type the code instead');
  const detector = new BarcodeDetector({ formats });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
  const el = document.createElement('div');
  el.id = 'scanner'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Scan code');
  el.innerHTML = String(html`<video playsinline muted></video><div class="scan-frame" aria-hidden="true"></div>
    <p class="scan-hint">Point at the small square code on the pack</p><button class="btn" type="button">Close</button>`);
  document.body.append(el);
  const video = el.querySelector('video');
  video.srcObject = stream;
  await video.play();
  return new Promise((resolve) => {
    let done = false, timer = 0;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); stream.getTracks().forEach((t) => t.stop()); el.remove(); resolve(v); };
    el.querySelector('button').addEventListener('click', () => finish(null));
    // ~4 frames/s is plenty and keeps the CPU (and battery) cool.
    const tick = async () => {
      if (done) return;
      try { const [code] = await detector.detect(video); if (code?.rawValue) { navigator.vibrate?.(60); return finish(code.rawValue); } } catch { /* frame not ready */ }
      timer = setTimeout(tick, 250);
    };
    tick();
  });
}
