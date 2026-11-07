// === Effects ===

import { state } from './state.js';
import { gameMode, h2p, HEX } from './hex.js';
import { emit } from './hooks.js';

export function spawnDmg(q, r, text, color) {
  emit('fx', 'spawnDmg', q, r, text, color);
  const { x, y } = h2p(q, r);
  const nearby = state.damageNumbers.filter(d => Math.abs(d.x - x) < 20 && Math.abs(d.y - (y - 24)) < 14).length;
  const num = parseInt(text);
  const big = !isNaN(num) && Math.abs(num) >= 3;
  state.damageNumbers.push({
    x: x + (Math.random() - 0.5) * 10,
    y: y - 24 - nearby * 14,
    text, color: color || '#c45050',
    life: big ? 1500 : 1200,
    maxLife: big ? 1500 : 1200,
    big
  });
}

export function spawnFlash(target) {
  emit('fx', 'spawnFlash', target);
  state.flashEffects.push({ target, life: 100 });
}

export function spawnProjectile(from, to, color, big) {
  emit('fx', 'spawnProjectile', from, to, color, big);
  const a = h2p(from.q, from.r);
  const b = h2p(to.q, to.r);
  state.projectiles.push({
    x: a.x, y: a.y, tx: b.x, ty: b.y,
    color, life: 250, maxLife: 250, big: big || false
  });
}

export function spawnDeath(q, r, color, big) {
  emit('fx', 'spawnDeath', q, r, color, big);
  const { x, y } = h2p(q, r);
  const n = big ? 14 : 8;
  for (let i = 0; i < n; i++) {
    state.deathEffects.push({
      x, y,
      vx: (Math.random() - 0.5) * (big ? 5 : 3),
      vy: (Math.random() - 0.5) * (big ? 5 : 3) - 1.5,
      color, life: 700, maxLife: 700, size: big ? 5 : 3
    });
  }
}

export function spawnAoe(q, r, color, radius) {
  emit('fx', 'spawnAoe', q, r, color, radius);
  const { x, y } = h2p(q, r);
  state.aoeEffects.push({ x, y, color, life: 450, maxLife: 450, radius: radius || HEX * 1.2 });
}

export function spawnTrail(q, r, color) {
  emit('fx', 'spawnTrail', q, r, color);
  const { x, y } = h2p(q, r);
  state.trailEffects.push({ x, y, color, life: 300, maxLife: 300 });
}

export function doShake(n) {
  emit('fx', 'doShake', n);
  if (gameMode === 'survival') {
    if (n < 12) return;
    n *= 0.6;
  }
  const mult = parseFloat(document.getElementById('shake-sel').value) || 1;
  state.screenShake = { x: 0, y: 0, life: 220, intensity: n * mult };
}

// === Stats ===

export function initStats() {
  state.stats = {};
  state.players.forEach(p => {
    if (!state.stats[p.name]) {
      state.stats[p.name] = {
        dmgDealt: 0, dmgTaken: 0, heals: 0, kills: 0,
        moved: 0, defends: 0, ghostTicks: 0, diedAt: 0, overkill: 0
      };
    }
  });
}

export function stat(name, key, val) {
  if (state.stats[name]) state.stats[name][key] += val;
}
