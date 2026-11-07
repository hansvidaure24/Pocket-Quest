// Pocket Quest — title menu

const isMobile = /Mobi|Android|iPhone|iPad/.test(navigator.userAgent)
  || (window.innerWidth < 768 && 'ontouchstart' in window);
const btns = document.getElementById('buttons');
const hint = document.getElementById('hint');

if (isMobile) {
  btns.innerHTML = '<a class="btn btn-join" href="controller.html">Join Game</a>'
    + '<div style="height:0.625rem"></div>'
    + '<a class="btn btn-tutorial" href="tutorial.html">Tutorial</a>';
  hint.textContent = 'Enter the room code shown on the host screen to join.';
} else {
  btns.innerHTML = '<a class="btn btn-host" href="host.html">Host Game</a>'
    + '<div style="height:0.625rem"></div>'
    + '<a class="btn btn-join" href="controller.html">Join Game</a>'
    + '<div style="height:0.625rem"></div>'
    + '<a class="btn btn-tutorial" href="tutorial.html">Tutorial</a>';
  hint.textContent = 'Host runs the shared screen. Join lets you play from this browser as a controller.';
}

const c = document.getElementById('bg');
const ctx = c.getContext('2d');
const hexes = [];

for (let q = -8; q <= 8; q++) {
  for (let r = -8; r <= 8; r++) {
    if (Math.abs(q + r) > 8) continue;
    hexes.push({
      q,
      r,
      phase: Math.random() * 6.28,
      speed: 0.0003 + Math.random() * 0.0004
    });
  }
}

function resize() {
  c.width = window.innerWidth;
  c.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const parts = [];

function render(t) {
  requestAnimationFrame(render);
  ctx.clearRect(0, 0, c.width, c.height);

  const bg = ctx.createRadialGradient(
    c.width / 2, c.height * 0.4, 0,
    c.width / 2, c.height * 0.4, c.width * 0.8
  );
  bg.addColorStop(0, '#0e0e20');
  bg.addColorStop(1, '#060610');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);

  const sz = 28;
  const s3 = Math.sqrt(3);
  const cx = c.width / 2;
  const cy = c.height / 2;
  const baseAlpha = 0.04 + 0.015 * Math.sin(t * 0.0005);

  ctx.strokeStyle = '#6644aa';
  ctx.lineWidth = 0.5;

  hexes.forEach(h => {
    const x = cx + sz * (s3 * h.q + s3 / 2 * h.r);
    const y = cy + sz * 1.5 * h.r;
    const drift = prefersReduced ? 0 : 0.015 * Math.sin(t * h.speed + h.phase);
    ctx.globalAlpha = baseAlpha + drift;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 3 * i - Math.PI / 6;
      ctx.lineTo(x + sz * Math.cos(a), y + sz * Math.sin(a));
    }
    ctx.closePath();
    ctx.stroke();
  });
  ctx.globalAlpha = 1;

  if (!prefersReduced) {
    while (parts.length < 12) {
      parts.push({
        x: Math.random(),
        y: Math.random(),
        s: 0.3 + Math.random() * 0.5,
        d: Math.random() * 6.28
      });
    }
    parts.forEach(m => {
      m.y -= 0.00004 * m.s;
      m.x += Math.sin(t * 0.0003 + m.d) * 0.00008;
      if (m.y < -0.02) {
        m.y = 1.02;
        m.x = Math.random();
      }
      ctx.globalAlpha = 0.03 + 0.02 * Math.sin(t * 0.001 + m.d);
      ctx.fillStyle = '#6644aa';
      ctx.beginPath();
      ctx.arc(m.x * c.width, m.y * c.height, m.s * 2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  if (!window._sp) {
    const sc = document.createElement('canvas');
    sc.width = 4;
    sc.height = 4;
    const sx = sc.getContext('2d');
    sx.fillStyle = 'rgba(0, 0, 0, 0.035)';
    sx.fillRect(0, 0, 4, 1);
    window._sp = ctx.createPattern(sc, 'repeat');
  }
  ctx.fillStyle = window._sp;
  ctx.fillRect(0, 0, c.width, c.height);
}

requestAnimationFrame(render);
