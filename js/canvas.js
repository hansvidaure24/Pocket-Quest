// Pocket Quest — Canvas setup & diamond iris wipe

export const C = document.getElementById('c');
export const ctx = C.getContext('2d');

// === Diamond Iris Wipe ===
const IC = document.getElementById('iris-canvas');
const ictx = IC.getContext('2d');
const iris = {
  active: false, closing: true, progress: 0, speed: 0,
  color: '#000', onMid: null, onDone: null, hold: 0
};

export function irisWipe(opts) {
  iris.active = true;
  iris.closing = true;
  iris.progress = 0;
  iris.speed = opts.speed || 0.003;
  iris.color = opts.color || '#000';
  iris.onMid = opts.onMid || null;
  iris.onDone = opts.onDone || null;
  iris.hold = opts.hold || 80;
  IC.style.display = 'block';
  IC.style.pointerEvents = 'auto';
}

function updateIris(dt) {
  if (!iris.active) {
    if (IC.style.display !== 'none') IC.style.display = 'none';
    return;
  }
  if (iris.closing) {
    iris.progress = Math.min(1, iris.progress + iris.speed * dt);
    if (iris.progress >= 1) {
      if (iris.onMid) {
        const cb = iris.onMid;
        iris.onMid = null;
        cb();
      }
      if (iris.hold > 0) { iris.hold -= dt; return; }
      iris.closing = false;
    }
  } else {
    iris.progress = Math.max(0, iris.progress - iris.speed * dt);
    if (iris.progress <= 0) {
      iris.active = false;
      IC.style.display = 'none';
      IC.style.pointerEvents = 'none';
      if (iris.onDone) {
        const cb = iris.onDone;
        iris.onDone = null;
        cb();
      }
    }
  }
}

function drawIris() {
  if (!iris.active) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (IC.width !== w || IC.height !== h) {
    IC.width = w;
    IC.height = h;
  }
  ictx.clearRect(0, 0, w, h);
  const t = Math.min(1, Math.max(0, iris.progress));
  const cx = w / 2;
  const cy = h / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy) * 1.15;
  const r = maxR * (1 - t);

  ictx.save();
  ictx.beginPath();
  ictx.moveTo(cx, cy - r);
  ictx.lineTo(cx + r, cy);
  ictx.lineTo(cx, cy + r);
  ictx.lineTo(cx - r, cy);
  ictx.closePath();
  ictx.moveTo(0, 0);
  ictx.lineTo(w, 0);
  ictx.lineTo(w, h);
  ictx.lineTo(0, h);
  ictx.closePath();
  ictx.fillStyle = iris.color;
  ictx.fill('evenodd');

  if (r > 4 && t > 0.05 && t < 0.95) {
    const blockSz = 8;
    const pts = [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]];
    for (let si = 0; si < 4; si++) {
      const p1 = pts[si];
      const p2 = pts[(si + 1) % 4];
      const steps = Math.floor(Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2) / blockSz);
      for (let j = 0; j < steps; j++) {
        const frac = j / steps;
        const bx = p1[0] + (p2[0] - p1[0]) * frac;
        const by = p1[1] + (p2[1] - p1[1]) * frac;
        const jitter = (Math.sin(frac * 47 + si * 13 + t * 20) * 0.5 + 0.5) * blockSz;
        ictx.fillStyle = iris.color;
        ictx.globalAlpha = 0.4 + 0.6 * Math.sin(frac * 31 + t * 10);
        ictx.fillRect(
          Math.floor(bx / blockSz) * blockSz - jitter * 0.5,
          Math.floor(by / blockSz) * blockSz - jitter * 0.5,
          blockSz, blockSz
        );
      }
    }
  }
  ictx.globalAlpha = 1;
  ictx.restore();
}

let _irisLastT = 0;
(function irisLoop(t) {
  requestAnimationFrame(irisLoop);
  const dt = _irisLastT ? t - _irisLastT : 16;
  _irisLastT = t;
  updateIris(dt);
  drawIris();
})(0);
