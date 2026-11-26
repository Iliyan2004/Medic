// Pointer-driven 3D tilt for .tile cards and the home hero scene.
// GPU: only CSS custom properties feeding transform are written; the compositor does the rest.
// RAM over CPU: element rects are measured once per hover and cached, not re-measured every frame
// (getBoundingClientRect can force a synchronous layout). Caches drop on scroll/resize.
// Skipped for touch, reduced motion and low-data mode.
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const fine = matchMedia('(hover: hover) and (pointer: fine)');
const off = () => reduce.matches || !fine.matches || document.documentElement.classList.contains('low-data');

let frame = 0, last = null;
let tile = null, tileRect = null;        // current hovered tile + cached rect
let stage = null, stageRect = null;      // hero stage + cached rect
const invalidate = () => { tileRect = null; stageRect = null; };
addEventListener('scroll', invalidate, { passive: true });
addEventListener('resize', invalidate, { passive: true });
addEventListener('hashchange', () => { stage = null; invalidate(); });

function reset(el) {
  el.classList.remove('tilting');
  el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); el.style.removeProperty('--mx'); el.style.removeProperty('--my');
}

function apply() {
  frame = 0;
  const ev = last;
  const t = ev.target.closest?.('.tile') || null;
  if (t !== tile) { if (tile) reset(tile); tile = t; tileRect = null; }
  if (tile) {
    const r = tileRect || (tileRect = tile.getBoundingClientRect());
    const x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    tile.classList.add('tilting');
    const s = tile.style;
    s.setProperty('--ry', `${((x - 0.5) * 12).toFixed(2)}deg`);
    s.setProperty('--rx', `${((0.5 - y) * 10).toFixed(2)}deg`);
    s.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    s.setProperty('--my', `${(y * 100).toFixed(1)}%`);
  }
  if (!stage || !stage.isConnected) { stage = document.querySelector('.hero .stage'); stageRect = null; }
  if (stage) {
    const r = stageRect || (stageRect = stage.parentElement.getBoundingClientRect());
    const x = (ev.clientX - (r.left + r.width / 2)) / innerWidth, y = (ev.clientY - (r.top + r.height / 2)) / innerHeight;
    stage.style.setProperty('--sry', `${(-18 + x * 30).toFixed(2)}deg`);
    stage.style.setProperty('--srx', `${(14 - y * 20).toFixed(2)}deg`);
  }
}

document.addEventListener('pointermove', (ev) => {
  if (off()) return;
  last = ev;
  if (!frame) frame = requestAnimationFrame(apply); // at most one update per display frame
}, { passive: true });
document.addEventListener('pointerleave', () => { if (tile) reset(tile); tile = null; });
