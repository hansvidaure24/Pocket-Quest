// === Render ===

import { state } from './state.js';
import { audio } from './audio.js';
import { C, ctx } from './canvas.js';
import { comboChain } from './combat.js';
import { BOARD, GRID_R, h2p, HEX, setHex, SQRT3 } from './hex.js';
import { _hpGhosts, drawCanvasHud, drawCompass, drawEntity, drawGrid } from './render.js';
import { S, survivalDrawBoard, survivalDrawHud, survivalHexSize } from './survival.js';
import { tick } from './tick.js';

// camera zoom eased toward the party's spread, kept between frames
let easedZoom = 1;

export function render(ts) {
  requestAnimationFrame(render);
  let dt = Math.min(100, Math.max(0, ts - state.lastTime));
  state.lastTime = ts;

  try {

  // hit stop
  if (state.hitStopTimer > 0) {
    state.hitStopTimer -= dt;
    dt = 0;
  }

  // slow-mo effect
  if (state.slowMoTimer > 0) {
    state.slowMoTimer -= dt;
    dt /= state.slowMoFactor;
    if (state.slowMoTimer <= 0) state.slowMoFactor = 1;
  }

  if (state.waveLabelTimer > 0) state.waveLabelTimer -= dt;
  if (state.waveAnnounce.life > 0) state.waveAnnounce.life -= dt;

  if (state.running && !state.gameOver && !state.paused) {
    const prevPct = state.tickTimer / state.tickMs;
    state.tickTimer += dt;
    const curPct = state.tickTimer / state.tickMs;
    // countdown ticks — builds urgency toward resolve
    if (prevPct < 0.25 && curPct >= 0.25) audio.metronome(0);
    if (prevPct < 0.50 && curPct >= 0.50) audio.metronome(0.5);
    if (prevPct < 0.75 && curPct >= 0.75) audio.metronome(1);
    if (state.tickTimer >= state.tickMs) {
      state.tickTimer -= state.tickMs;
      tick();
    }
  }

  if (state.msgTimer > 0) {
    state.msgTimer -= dt;
    if (state.msgTimer <= 0) state.msg = '';
  }

  state.flashEffects = state.flashEffects.filter(f => { f.life -= dt; return f.life > 0; });
  state.damageNumbers = state.damageNumbers.filter(d => { d.life -= dt; d.y -= dt * 0.04; return d.life > 0; });
  state.projectiles = state.projectiles.filter(p => { p.life -= dt; return p.life > 0; });
  state.deathEffects = state.deathEffects.filter(d => {
    d.life -= dt;
    d.x += d.vx;
    d.y += d.vy;
    d.vy += 0.05;
    return d.life > 0;
  });
  state.aoeEffects = state.aoeEffects.filter(a => { a.life -= dt; return a.life > 0; });
  state.trailEffects = state.trailEffects.filter(t => { t.life -= dt; return t.life > 0; });
  state.statusParticles = state.statusParticles.filter(p => {
    p.life -= dt;
    p.x += (p.vx || 0);
    p.y += p.vy;
    return p.life > 0;
  });

  if (state.tickPulse > 0) state.tickPulse = Math.max(0, state.tickPulse - dt * 0.005);

  if (state.screenShake.life > 0) {
    state.screenShake.life -= dt;
    state.screenShake.x = (Math.random() - 0.5) * state.screenShake.intensity;
    state.screenShake.y = (Math.random() - 0.5) * state.screenShake.intensity;
    state.screenShake.intensity *= 0.9;
  } else {
    state.screenShake.x = 0;
    state.screenShake.y = 0;
  }

  C.width = window.innerWidth;
  C.height = window.innerHeight;
  state.uiS = Math.max(0.7, Math.min(2.0, C.height / 720));

  if (BOARD) {
    setHex(survivalHexSize(C.width, C.height));
  } else {
    const fit = Math.min(C.width, C.height) / (GRID_R * 2 + 2) / 1.5;
    setHex(Math.max(window.PQ_VIEWER ? 10 : 28, Math.min(60, fit)));
  }

  ctx.save();
  ctx.translate(state.screenShake.x, state.screenShake.y);
  ctx.clearRect(-10, -10, C.width + 20, C.height + 20);

  // dark background fill
  ctx.fillStyle = '#060504';
  ctx.fillRect(0, 0, C.width, C.height);

  // scanline pattern overlay
  if (!window._scanPat) {
    const sc = document.createElement('canvas');
    sc.width = 4;
    sc.height = 4;
    const sx = sc.getContext('2d');
    sx.fillStyle = 'rgba(0,0,0,0.04)';
    sx.fillRect(0, 0, 4, 1);
    window._scanPat = ctx.createPattern(sc, 'repeat');
  }
  ctx.fillStyle = window._scanPat;
  ctx.fillRect(0, 0, C.width, C.height);

  // ambient floating motes
  if (!window._ambMotes) {
    window._ambMotes = [];
    for (let i = 0; i < 15; i++) {
      window._ambMotes.push({
        x: Math.random(), y: Math.random(),
        s: 0.3 + Math.random() * 0.5, d: Math.random() * 6.28
      });
    }
  }
  window._ambMotes.forEach(m => {
    m.y -= 0.00004 * m.s;
    m.x += Math.sin(ts * 0.0003 + m.d) * 0.00008;
    if (m.y < -0.02) {
      m.y = 1.02;
      m.x = Math.random();
    }
    ctx.globalAlpha = 0.025 + 0.015 * Math.sin(ts * 0.001 + m.d);
    ctx.fillStyle = '#6644aa';
    ctx.beginPath();
    ctx.arc(m.x * C.width, m.y * C.height, m.s * 2, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // camera follow — track centroid of living entities
  const living = state.entities.filter(e => e.hp > 0 || e.ghost);
  if (BOARD) {
    state.camOffX = 0;
    state.camOffY = 0;
  } else if (state.running && living.length > 0) {
    let avgQ = 0, avgR = 0;
    living.forEach(e => { avgQ += e.q; avgR += e.r; });
    avgQ /= living.length;
    avgR /= living.length;
    const targetX = -HEX * (SQRT3 * avgQ + SQRT3 / 2 * avgR);
    const targetY = -HEX * 1.5 * avgR;
    state.camOffX += (targetX - state.camOffX) * 0.06;
    state.camOffY += (targetY - state.camOffY) * 0.06;
  } else {
    state.camOffX += (0 - state.camOffX) * 0.06;
    state.camOffY += (0 - state.camOffY) * 0.06;
  }

  // dynamic zoom: tighten when entities are clustered
  let camZoom = 1;
  if (state.running && living.length > 1 && !BOARD) {
    let minQ = 99, maxQ = -99, minR = 99, maxR = -99;
    living.forEach(e => {
      minQ = Math.min(minQ, e.q);
      maxQ = Math.max(maxQ, e.q);
      minR = Math.min(minR, e.r);
      maxR = Math.max(maxR, e.r);
    });
    const spread = Math.max(maxQ - minQ, maxR - minR);
    const target = spread <= 3 ? 1.15 : spread <= 5 ? 1.06 : 1;
    easedZoom += (target - easedZoom) * 0.02;
    camZoom = easedZoom;
    if (camZoom > 1.01) {
      const cx = C.width / 2, cy = C.height / 2;
      ctx.translate(cx, cy);
      ctx.scale(camZoom, camZoom);
      ctx.translate(-cx, -cy);
    }
  }

  drawGrid(ts);
  drawCompass(ts);
  if (BOARD) survivalDrawBoard(ts);

  // grid boundary glow
  if (state.running && !BOARD) {
    const center = h2p(0, 0);
    const gridPixR = HEX * (GRID_R + 0.5) * SQRT3;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(center.x, center.y, gridPixR, 0, Math.PI * 2);
    ctx.strokeStyle = '#6644aa';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  // game canvas vignette
  if (state.running) {
    const vig = ctx.createRadialGradient(
      C.width / 2, C.height / 2, C.width * 0.3,
      C.width / 2, C.height / 2, C.width * 0.7
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, C.width, C.height);
  }

  // ambient dust motes
  if (state.running && !state.gameOver && state.ambientParticles.length < 25 && Math.random() < 0.1) {
    const isEmber = Math.random() > 0.7;
    state.ambientParticles.push({
      x: Math.random() * C.width, y: C.height + 5,
      vx: (Math.random() - 0.5) * 0.2, vy: -0.2 - Math.random() * 0.15,
      life: 4000 + Math.random() * 4000, maxLife: 8000,
      size: isEmber ? 1.5 + Math.random() : 0.8 + Math.random() * 0.5,
      color: isEmber ? '#c45a3c' : '#6644aa'
    });
  }
  state.ambientParticles = state.ambientParticles.filter(p => {
    p.life -= dt;
    p.x += p.vx;
    p.y += p.vy;
    return p.life > 0;
  });
  state.ambientParticles.forEach(p => {
    const fade = Math.min(p.life / p.maxLife, (p.maxLife - p.life) / 2000);
    ctx.globalAlpha = fade * 0.12;
    ctx.fillStyle = p.color || '#6644aa';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // tick pulse overlay + expanding ring from P1
  if (state.tickPulse > 0) {
    ctx.globalAlpha = state.tickPulse * 0.04;
    ctx.fillStyle = '#c45a3c';
    ctx.fillRect(0, 0, C.width, C.height);
    if (state.players[0] && (state.players[0].hp > 0 || state.players[0].ghost)) {
      const pp = h2p(state.players[0].q, state.players[0].r);
      const ringR = HEX * (1 + 3 * (1 - state.tickPulse));
      ctx.globalAlpha = state.tickPulse * 0.08;
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = state.players[0].color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // screen flash
  if (state.screenFlash.life > 0) {
    state.screenFlash.life -= dt;
    // canvas ignores a negative alpha and keeps 1, which painted the last frame solid
    ctx.globalAlpha = Math.max(0, state.screenFlash.life / state.screenFlash.maxLife) * 0.25;
    ctx.fillStyle = state.screenFlash.color;
    ctx.fillRect(0, 0, C.width, C.height);
    ctx.globalAlpha = 1;
  }

  // impact speed lines during hit stop
  if (state.hitStopTimer > 0) {
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    const cx = C.width / 2, cy = C.height / 2;
    for (let i = 0; i < 12; i++) {
      const a = Math.PI * 2 * i / 12 + (ts * 0.001);
      const r1 = Math.max(C.width, C.height) * 0.3;
      const r2 = r1 + 80 + Math.random() * 40;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // trails — with glow
  state.trailEffects.forEach(tr => {
    ctx.save();
    ctx.globalAlpha = (tr.life / tr.maxLife) * 0.2;
    ctx.shadowColor = tr.color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(tr.x, tr.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = tr.color;
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  });

  // AOE rings — with glow
  state.aoeEffects.forEach(a => {
    const prog = 1 - a.life / a.maxLife;
    ctx.save();
    ctx.globalAlpha = (1 - prog) * 0.35;
    ctx.shadowColor = a.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(a.x, a.y, a.radius * prog, 0, Math.PI * 2);
    ctx.strokeStyle = a.color;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha = (1 - prog) * 0.04;
    ctx.fillStyle = a.color;
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;
  });

  // status effect particles
  state.statusParticles.forEach(sp => {
    ctx.globalAlpha = (sp.life / sp.maxLife) * 0.7;
    ctx.fillStyle = sp.color;
    if (sp.star) {
      ctx.font = '6px Rajdhani,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✦', sp.x, sp.y);
    } else {
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });

  // dead enemy corpse marks
  state.entities.filter(e => e.isEnemy && e.hp <= 0).forEach(e => {
    const { x, y } = h2p(e.q, e.r);
    const deadAge = e._deadTick != null ? state.tickCount - e._deadTick : 0;
    if (!e._deadTick) e._deadTick = state.tickCount;
    const fade = Math.max(0.03, 0.18 - deadAge * 0.012);
    ctx.globalAlpha = fade;
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - 4, y - 4);
    ctx.lineTo(x + 4, y + 4);
    ctx.moveTo(x + 4, y - 4);
    ctx.lineTo(x - 4, y + 4);
    ctx.stroke();
    if (fade > 0.06) {
      ctx.font = '7px Rajdhani,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = e.color;
      ctx.fillText(e.name[0], x, y + 8);
    }
    ctx.globalAlpha = 1;
  });

  const t = Math.min(1, state.tickTimer / Math.min(state.tickMs, 400));
  state.entities.filter(e => e.hp > 0 || e.ghost).forEach(e => drawEntity(e, t, ts));

  // relic orbiting particles (survival)
  if (S && S.relics.length && state.running && !state.gameOver) {
    const relicColors = ['#b8943e', '#c45a3c', '#7ea879', '#6b8cae', '#ff4488', '#ff8833'];
    state.players.forEach(p => {
      if (p.hp <= 0 && !p.ghost) return;
      const pp = h2p(p.q, p.r);
      S.relics.forEach((r, ri) => {
        const a = ts * 0.002 + ri * Math.PI * 2 / S.relics.length;
        const ox = pp.x + Math.cos(a) * HEX * 0.6;
        const oy = pp.y + Math.sin(a) * HEX * 0.5;
        ctx.save();
        ctx.globalAlpha = 0.25 + 0.1 * Math.sin(ts * 0.005 + ri);
        ctx.beginPath();
        ctx.arc(ox, oy, 2, 0, Math.PI * 2);
        ctx.fillStyle = relicColors[ri % relicColors.length];
        ctx.fill();
        ctx.restore();
      });
    });
    ctx.globalAlpha = 1;
  }

  // projectiles
  state.projectiles.forEach(p => {
    const prog = 1 - p.life / p.maxLife;
    const px = p.x + (p.tx - p.x) * prog;
    const py = p.y + (p.ty - p.y) * prog;
    const pSz = p.big ? 8 : 5;
    const pGlow = p.big ? 16 : 10;
    ctx.save();
    ctx.globalAlpha = p.life / p.maxLife;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = pGlow;
    ctx.beginPath();
    ctx.arc(px, py, pSz, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(px, py, pSz * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.globalAlpha *= 0.6;
    ctx.fill();
    ctx.restore();
    // trail
    for (let i = 1; i <= 4; i++) {
      const tp2 = 1 - p.life / p.maxLife - i * 0.025;
      if (tp2 < 0) continue;
      const tx = p.x + (p.tx - p.x) * tp2;
      const ty = p.y + (p.ty - p.y) * tp2;
      ctx.globalAlpha = (p.life / p.maxLife) * 0.08 * (4 - i) / 4;
      ctx.beginPath();
      ctx.arc(tx, ty, 2, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });

  // death particles
  state.deathEffects.forEach(d => {
    ctx.save();
    ctx.globalAlpha = d.life / d.maxLife;
    ctx.fillStyle = d.color;
    ctx.shadowColor = d.color;
    ctx.shadowBlur = 4;
    ctx.fillRect(d.x - d.size / 2, d.y - d.size / 2, d.size, d.size);
    ctx.restore();
    ctx.globalAlpha = 1;
  });

  // damage numbers
  state.damageNumbers.forEach(d => {
    const prog = 1 - d.life / d.maxLife;
    const alpha = Math.max(0, 1 - prog * prog);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = d.color;
    const base = d.big ? HEX * 0.5 : HEX * 0.38;
    const sz = base + (1 - prog) * (d.big ? HEX * 0.28 : HEX * 0.16);
    ctx.font = `700 ${sz}px Rajdhani,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.shadowColor = d.color;
    ctx.shadowBlur = d.big ? 12 : 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    ctx.strokeText(d.text, d.x, d.y);
    ctx.fillText(d.text, d.x, d.y);
    ctx.restore();
    ctx.globalAlpha = 1;
  });

  // Boss health bar
  const boss = state.enemies.find(e => e.isBoss && e.hp > 0);
  if (boss) {
    const bw = Math.min(Math.round(380 * state.uiS), C.width * 0.38);
    const bh = Math.round(16 * state.uiS);
    const bx = C.width / 2 - bw / 2;
    const by = Math.round(14 * state.uiS);
    const bp = Math.round(6 * state.uiS);

    ctx.fillStyle = 'rgba(6,6,16,0.85)';
    ctx.fillRect(bx - bp, by - bp, bw + bp * 2, bh + Math.round(22 * state.uiS));
    ctx.strokeStyle = 'rgba(184,148,62,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx - bp, by - bp, bw + bp * 2, bh + Math.round(22 * state.uiS));

    ctx.fillStyle = '#0f0d0a';
    ctx.fillRect(bx, by, bw, bh);

    const pct = boss.hp / boss.maxHp;
    const bCol = pct > 0.5 ? '#c45a3c' : pct > 0.25 ? '#c49040' : '#c44040';
    const bGr = ctx.createLinearGradient(bx, by, bx, by + bh);
    bGr.addColorStop(0, bCol);
    bGr.addColorStop(1, bCol + '88');

    // ghost bar for boss
    const bKey = 'boss_' + boss.name + '@' + boss.q + ',' + boss.r;
    let bg = _hpGhosts.get(bKey);
    if (!bg) {
      bg = { pct };
      _hpGhosts.set(bKey, bg);
    }
    if (pct < bg.pct) {
      ctx.fillStyle = 'rgba(196,120,90,0.4)';
      ctx.fillRect(bx, by, bw * bg.pct, bh);
      bg.pct = Math.max(pct, bg.pct - 0.006);
    } else {
      bg.pct = pct;
    }

    ctx.fillStyle = bGr;
    ctx.fillRect(bx, by, bw * pct, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(bx, by, bw * pct, 1);

    // phase threshold notches at 50% and 25%
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(bx + bw * 0.5 - 0.5, by, 1, bh);
    ctx.fillRect(bx + bw * 0.25 - 0.5, by, 1, bh);
    ctx.strokeStyle = 'rgba(184,148,62,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);

    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(12 * state.uiS)}px Rajdhani,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const phTxt = boss.bossPhase >= 3 ? ' P3' : boss.bossPhase >= 2 ? ' P2' : '';
    ctx.fillText(`⭐ ${boss.name}${phTxt} — ${boss.hp}/${boss.maxHp}`, C.width / 2, by + bh / 2);
  }

  // wave label
  if (state.waveLabel && state.waveLabelTimer > 0) {
    ctx.save();
    const wAlpha = Math.min(0.45, state.waveLabelTimer / 2000);
    ctx.globalAlpha = wAlpha;
    ctx.fillStyle = '#ddd';
    ctx.font = `700 ${Math.round(22 * state.uiS)}px Rajdhani,sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.letterSpacing = '2px';
    ctx.shadowColor = 'rgba(140,120,80,0.5)';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 3;
    ctx.strokeText(state.waveLabel.toUpperCase(), C.width - Math.round(14 * state.uiS), Math.round(6 * state.uiS));
    ctx.fillText(state.waveLabel.toUpperCase(), C.width - Math.round(14 * state.uiS), Math.round(6 * state.uiS));
    ctx.restore();
  }

  // Kill counter
  const xbX = Math.round(8 * state.uiS);
  const xbY = C.height - Math.round(48 * state.uiS);
  const totalKillsAll = Object.values(state.stats).reduce((s, st) => s + st.kills, 0);
  let killsW = 0;
  if (totalKillsAll > 0) {
    ctx.fillStyle = 'rgba(200,200,220,0.3)';
    ctx.font = `${Math.round(10 * state.uiS)}px Rajdhani,sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${totalKillsAll} kills`, xbX, xbY);
    killsW = ctx.measureText(`${totalKillsAll} kills`).width;
  }

  // Combo chain display
  if (comboChain >= 2) {
    ctx.save();
    ctx.globalAlpha = 0.7 + 0.2 * Math.sin(ts * 0.008);
    ctx.fillStyle = '#b8943e';
    ctx.font = `700 ${Math.round(12 * state.uiS)}px Rajdhani,sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.shadowColor = '#b8943e';
    ctx.shadowBlur = 8;
    ctx.fillText(`COMBO x${comboChain}`, xbX, xbY - Math.round(8 * state.uiS));
    ctx.restore();
  }

  // Kill streak display
  if (state.killStreak >= 2 && state.tickCount - state.lastKillTick <= 3) {
    const ksLabels = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'MULTI KILL', 'MEGA KILL'];
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#ff6600';
    ctx.font = `700 ${Math.round(12 * state.uiS)}px Rajdhani,sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.shadowColor = '#ff6600';
    ctx.shadowBlur = 8;
    ctx.fillText(
      ksLabels[Math.min(state.killStreak, 5)] || 'RAMPAGE',
      C.width - Math.round(8 * state.uiS), xbY - Math.round(8 * state.uiS)
    );
    ctx.restore();
  }

  // DPS display, after the kill counter
  if (state.dpsDisplay > 0) {
    ctx.fillStyle = 'rgba(196,90,60,0.4)';
    ctx.font = `${Math.round(9 * state.uiS)}px Rajdhani,sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${state.dpsDisplay.toFixed(1)} dpt`, xbX + killsW + Math.round(8 * state.uiS), xbY);
  }

  // tick damage toast
  if (window._tickToast && window._tickToast.life > 0) {
    window._tickToast.life -= dt;
    const tt = window._tickToast;
    const ttA = Math.min(1, tt.life / 300, Math.min(1, (1200 - tt.life) / 150));
    const ttY = C.height - Math.round(70 * state.uiS) - (1 - Math.min(1, (1200 - tt.life) / 200)) * 10;
    ctx.save();
    ctx.globalAlpha = Math.max(0, ttA) * 0.65;
    ctx.font = `bold ${Math.round(13 * state.uiS)}px Rajdhani,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#c45a3c';
    ctx.fillText(`-${tt.val} dmg`, C.width / 2, ttY);
    ctx.restore();
  }

  // boss encounter border glow + phase-dependent intensity
  const activeBoss = state.enemies.find(e => e.isBoss && e.hp > 0);
  if (activeBoss && state.running && !state.gameOver) {
    const phaseBoost = activeBoss.bossPhase >= 3 ? 0.06
      : activeBoss.bossPhase >= 2 ? 0.03 : 0;
    const bPulse = 0.08 + phaseBoost + 0.04 * Math.sin(ts * 0.004);
    ctx.save();
    const bGrad = ctx.createLinearGradient(0, 0, 0, C.height);
    bGrad.addColorStop(0, `rgba(255,34,0,${bPulse})`);
    bGrad.addColorStop(0.15, 'rgba(0,0,0,0)');
    bGrad.addColorStop(0.85, 'rgba(0,0,0,0)');
    bGrad.addColorStop(1, `rgba(255,34,0,${bPulse})`);
    ctx.fillStyle = bGrad;
    ctx.fillRect(0, 0, C.width, C.height);
    const bGrad2 = ctx.createLinearGradient(0, 0, C.width, 0);
    bGrad2.addColorStop(0, `rgba(255,34,0,${bPulse * 0.6})`);
    bGrad2.addColorStop(0.1, 'rgba(0,0,0,0)');
    bGrad2.addColorStop(0.9, 'rgba(0,0,0,0)');
    bGrad2.addColorStop(1, `rgba(255,34,0,${bPulse * 0.6})`);
    ctx.fillStyle = bGrad2;
    ctx.fillRect(0, 0, C.width, C.height);
    ctx.restore();
  }

  // low HP vignette + critical heartbeat
  if (state.running && !state.gameOver && state.players[0] && state.players[0].hp > 0) {
    const hpPct = state.players[0].hp / state.players[0].maxHp;
    if (hpPct <= 0.35) {
      const vigAlpha = (1 - hpPct / 0.35) * 0.2;
      const grad = ctx.createRadialGradient(
        C.width / 2, C.height / 2, C.width * 0.3,
        C.width / 2, C.height / 2, C.width * 0.7
      );
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, `rgba(180,20,20,${vigAlpha})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, C.width, C.height);
    }
    if (state.players[0].hp === 1) {
      const hb = Math.sin(ts * 0.006) * 0.5 + 0.5;
      ctx.save();
      ctx.globalAlpha = hb * 0.08;
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, C.width, C.height);
      ctx.globalAlpha = hb * 0.25;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#ff2222';
      ctx.strokeRect(2, 2, C.width - 4, C.height - 4);
      ctx.restore();
    }
  }

  // last stand golden border glow
  if (state.running && !state.gameOver && state.players.some(p => p.lastStand)) {
    const lsPulse = 0.1 + 0.06 * Math.sin(ts * 0.005);
    ctx.save();
    const lsG = ctx.createLinearGradient(0, 0, 0, C.height);
    lsG.addColorStop(0, `rgba(184,148,62,${lsPulse})`);
    lsG.addColorStop(0.12, 'rgba(0,0,0,0)');
    lsG.addColorStop(0.88, 'rgba(0,0,0,0)');
    lsG.addColorStop(1, `rgba(184,148,62,${lsPulse})`);
    ctx.fillStyle = lsG;
    ctx.fillRect(0, 0, C.width, C.height);
    const lsG2 = ctx.createLinearGradient(0, 0, C.width, 0);
    lsG2.addColorStop(0, `rgba(184,148,62,${lsPulse * 0.5})`);
    lsG2.addColorStop(0.08, 'rgba(0,0,0,0)');
    lsG2.addColorStop(0.92, 'rgba(0,0,0,0)');
    lsG2.addColorStop(1, `rgba(184,148,62,${lsPulse * 0.5})`);
    ctx.fillStyle = lsG2;
    ctx.fillRect(0, 0, C.width, C.height);
    ctx.restore();
  }

  // focus fire: mark lowest HP enemy
  if (state.running && !state.gameOver) {
    const aliveE = state.enemies.filter(e => e.hp > 0);
    if (aliveE.length > 1) {
      const lowest = aliveE.reduce((a, b) => a.hp < b.hp ? a : b);
      const { x: fx, y: fy } = h2p(lowest.q, lowest.r);
      ctx.save();
      ctx.globalAlpha = 0.2 + 0.1 * Math.sin(ts * 0.006);
      ctx.strokeStyle = '#c45a3c';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(fx, fy, HEX * 0.6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(fx - HEX * 0.7, fy);
      ctx.lineTo(fx - HEX * 0.5, fy);
      ctx.moveTo(fx + HEX * 0.5, fy);
      ctx.lineTo(fx + HEX * 0.7, fy);
      ctx.moveTo(fx, fy - HEX * 0.7);
      ctx.lineTo(fx, fy - HEX * 0.5);
      ctx.moveTo(fx, fy + HEX * 0.5);
      ctx.lineTo(fx, fy + HEX * 0.7);
      ctx.stroke();
      ctx.restore();
    }
  }

  // off-screen enemy indicators
  if (state.running && !state.gameOver) {
    state.enemies.filter(e => e.hp > 0).forEach(e => {
      const { x: ex, y: ey } = h2p(e.q, e.r);
      const margin = 20;
      if (ex < margin || ex > C.width - margin || ey < margin || ey > C.height - margin) {
        const cx = C.width / 2, cy = C.height / 2;
        const ang = Math.atan2(ey - cy, ex - cx);
        const ix = Math.max(margin, Math.min(C.width - margin, cx + Math.cos(ang) * (C.width / 2 - margin)));
        const iy = Math.max(margin, Math.min(C.height - margin, cy + Math.sin(ang) * (C.height / 2 - margin)));
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.translate(ix, iy);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(8, 0);
        ctx.lineTo(-4, -5);
        ctx.lineTo(-4, 5);
        ctx.closePath();
        ctx.fillStyle = e.isBoss ? '#b8943e' : e.color;
        ctx.fill();
        ctx.restore();
      }
    });
  }

  // kill feed
  state.killFeed.forEach(k => k.t -= dt);
  state.killFeed = state.killFeed.filter(k => k.t > 0);
  if (state.killFeed.length > 5) state.killFeed.splice(0, state.killFeed.length - 5);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `bold ${Math.round(11 * state.uiS)}px Rajdhani,sans-serif`;
  ctx.textBaseline = 'top';
  state.killFeed.forEach((k, i) => {
    const fadeIn = Math.min(1, (3000 - Math.min(k.t, 3000)) / 200);
    const fadeOut = Math.min(1, k.t / 400);
    ctx.globalAlpha = Math.min(fadeIn, fadeOut) * 0.85;
    const ky = Math.round(92 * state.uiS) + i * Math.round(18 * state.uiS);
    const kx = C.width - Math.round(8 * state.uiS);
    ctx.textAlign = 'right';
    const kName = k.killer.length > 8 ? k.killer.slice(0, 7) + '…' : k.killer;
    const vName = k.victim.length > 8 ? k.victim.slice(0, 7) + '…' : k.victim;
    const label = kName + ' ⚔ ' + vName;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(10,10,20,0.7)';
    ctx.fillRect(kx - tw - Math.round(6 * state.uiS), ky - 2, tw + Math.round(12 * state.uiS), Math.round(16 * state.uiS));
    ctx.fillStyle = k.kColor;
    ctx.fillText(label, kx, ky);
    ctx.fillStyle = k.vColor;
    ctx.fillText(vName, kx, ky);
  });
  ctx.restore();

  // wave rating splash
  if (state.ratingFlash.life > 0) {
    state.ratingFlash.life -= dt;
    const rp = 1 - state.ratingFlash.life / state.ratingFlash.maxLife;
    const rFadeIn = Math.min(1, rp * 6);
    const rFadeOut = Math.min(1, state.ratingFlash.life / 500);
    const rA = Math.min(rFadeIn, rFadeOut);
    const rScale = rp < 0.15 ? 0.5 + 3.5 * rp / 0.15 : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, rA) * 0.85;
    ctx.translate(C.width / 2, C.height / 2 - Math.round(40 * state.uiS));
    ctx.scale(rScale, rScale);
    ctx.font = `900 ${Math.round(120 * state.uiS)}px Rajdhani,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = state.ratingFlash.color;
    ctx.shadowBlur = 30;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 5;
    ctx.strokeText(state.ratingFlash.grade, 0, 0);
    ctx.fillStyle = state.ratingFlash.color;
    ctx.fillText(state.ratingFlash.grade, 0, 0);
    ctx.restore();
  }

  // game-over desaturation
  if (state.gameOver) {
    if (!window._goAlpha) window._goAlpha = 0;
    window._goAlpha = Math.min(0.55, window._goAlpha + dt * 0.0008);
    ctx.fillStyle = `rgba(6,6,14,${window._goAlpha})`;
    ctx.fillRect(0, 0, C.width, C.height);
    ctx.save();
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = `rgba(40,40,50,${window._goAlpha * 0.6})`;
    ctx.fillRect(0, 0, C.width, C.height);
    ctx.restore();
  } else {
    window._goAlpha = 0;
  }

  // cinematic wave announce
  if (state.waveAnnounce.life > 0) {
    ctx.save();
    const wa = state.waveAnnounce;
    const prog = 1 - wa.life / wa.maxLife;
    const fadeIn = Math.min(1, prog * 5);
    const fadeOut = Math.min(1, wa.life / 600);
    const a = Math.min(fadeIn, fadeOut);

    // letterbox bars
    const barH = C.height * 0.12 * a;
    ctx.globalAlpha = a * 0.7;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, C.width, barH);
    ctx.fillRect(0, C.height - barH, C.width, barH);

    // main text
    const sz = Math.min(72, C.width * 0.08);
    const waTextCol = wa.text.includes('PERFECT') || wa.text.includes('LEVEL UP') || wa.text.includes('LAST STAND')
      ? '#b8943e'
      : wa.text.includes('DEFEAT') || wa.text.includes('FALLEN')
        ? '#c45a3c' : '#fff';
    ctx.globalAlpha = a * 0.9;
    ctx.fillStyle = waTextCol;
    ctx.font = `700 ${sz}px Rajdhani,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const waColor = wa.text.includes('BOSS') ? 'rgba(196,90,60,0.6)'
      : wa.text.includes('PERFECT') ? 'rgba(184,148,62,0.6)'
      : wa.text.includes('DEFEAT') || wa.text.includes('FALLEN') ? 'rgba(196,90,60,0.5)'
      : wa.text.includes('LAST STAND') ? 'rgba(184,148,62,0.5)'
      : wa.text.includes('FIRST BLOOD') ? 'rgba(196,90,60,0.4)'
      : wa.text.includes('LEVEL UP') ? 'rgba(184,148,62,0.5)'
      : wa.text.includes('MERCHANT') || wa.text.includes('CHEST') || wa.text.includes('ARMORY') ? 'rgba(184,148,62,0.4)'
      : 'rgba(140,120,80,0.5)';
    ctx.shadowColor = waColor;
    ctx.shadowBlur = 20;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 4;
    const slideX = (1 - fadeIn) * 40;
    ctx.strokeText(wa.text, C.width / 2 + slideX, C.height / 2 - 12);
    ctx.fillText(wa.text, C.width / 2 + slideX, C.height / 2 - 12);

    // subtitle
    if (wa.sub) {
      ctx.shadowBlur = 8;
      ctx.globalAlpha = a * 0.5;
      ctx.font = `600 ${Math.round(sz * 0.35)}px Rajdhani,sans-serif`;
      ctx.fillStyle = '#aaa';
      ctx.fillText(wa.sub, C.width / 2 + slideX * 0.5, C.height / 2 + sz * 0.45);
    }

    // horizontal rule lines
    ctx.shadowBlur = 0;
    ctx.globalAlpha = a * 0.2;
    ctx.strokeStyle = '#6644aa';
    ctx.lineWidth = 1;
    const ruleW = C.width * 0.3 * a;
    ctx.beginPath();
    ctx.moveTo(C.width / 2 - ruleW, C.height / 2 + sz * 0.18);
    ctx.lineTo(C.width / 2 + ruleW, C.height / 2 + sz * 0.18);
    ctx.stroke();
    ctx.restore();
  }

  // countdown overlay
  if (state.countdownText) {
    ctx.save();
    const isGo = state.countdownText === 'GO!';
    const cdSize = isGo ? 96 : 72;
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, C.width, C.height);
    ctx.globalAlpha = isGo ? 0.95 : 0.85;

    const cdGlow = ctx.createRadialGradient(C.width / 2, C.height / 2, 0, C.width / 2, C.height / 2, cdSize * 1.5);
    cdGlow.addColorStop(0, isGo ? 'rgba(126,168,121,0.15)' : 'rgba(184,148,62,0.12)');
    cdGlow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = cdGlow;
    ctx.fillRect(0, 0, C.width, C.height);

    // scale bounce
    if (!window._cdText || window._cdText !== state.countdownText) {
      window._cdText = state.countdownText;
      window._cdAge = 0;
    }
    window._cdAge += dt;
    const bounce = window._cdAge < 200 ? 1 + 0.3 * (1 - window._cdAge / 200) : 1;
    ctx.translate(C.width / 2, C.height / 2);
    ctx.scale(bounce, bounce);
    ctx.translate(-C.width / 2, -C.height / 2);

    ctx.globalAlpha = isGo ? 0.95 : 0.85;
    ctx.fillStyle = isGo ? '#7ea879' : '#b8943e';
    ctx.font = `700 ${cdSize}px Rajdhani,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 6;
    ctx.strokeText(state.countdownText, C.width / 2, C.height / 2);
    ctx.fillText(state.countdownText, C.width / 2, C.height / 2);

    if (state.waveLabel) {
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = '#ccc';
      ctx.font = `600 ${Math.round(18 * state.uiS)}px Rajdhani,sans-serif`;
      ctx.fillText(state.waveLabel, C.width / 2, C.height / 2 + Math.round(52 * state.uiS));
    }
    ctx.restore();
  }

  // key hints
  if (state.running && !state.gameOver && state.keyHintAlpha > 0 && state.campaignNode === 0 && state.tickCount < 15) {
    ctx.save();
    ctx.globalAlpha = state.keyHintAlpha * 0.5;
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.round(10 * state.uiS)}px Rajdhani,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('WASD move · Space attack · F skill · G defend · 1 item', C.width / 2, C.height - Math.round(52 * state.uiS));
    ctx.restore();
  }
  if (state.keyHintShown) state.keyHintAlpha = Math.max(0, state.keyHintAlpha - dt * 0.001);

  if (!state.running && !state.gameOver && state.gamePhase === 'game') {
    ctx.save();
    ctx.fillStyle = '#8a7e6e';
    ctx.font = `600 ${Math.round(18 * state.uiS)}px Rajdhani,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = 0.4 + 0.2 * Math.sin(ts * 0.003);
    ctx.fillText('WAITING...', C.width / 2, C.height / 2);
    ctx.restore();
  }

  // canvas frame border
  ctx.save();
  ctx.strokeStyle = 'rgba(140,120,80,0.12)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, C.width - 1, C.height - 1);
  const ca = 12;
  ctx.strokeStyle = 'rgba(140,120,80,0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, ca);
  ctx.lineTo(0, 0);
  ctx.lineTo(ca, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(C.width - ca, 0);
  ctx.lineTo(C.width, 0);
  ctx.lineTo(C.width, ca);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, C.height - ca);
  ctx.lineTo(0, C.height);
  ctx.lineTo(ca, C.height);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(C.width - ca, C.height);
  ctx.lineTo(C.width, C.height);
  ctx.lineTo(C.width, C.height - ca);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
  } catch (e) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    // keep the frame loop alive, but don't hide the bug: report each distinct error once
    render.seen ??= new Set();
    if (!render.seen.has(e.message)) { render.seen.add(e.message); console.error('render:', e); }
  }

  drawCanvasHud(ts);
  if (BOARD) survivalDrawHud(ts);
}

document.getElementById('vol-sl').addEventListener('input', e => {
  audio.setVolume(e.target.value / 100);
});

// === Menu background particle renderer ===
(function () {
  const mc = document.getElementById('menu-bg');
  const mx = mc.getContext('2d');
  const mparts = [];
  const mhexes = [];

  for (let q = -8; q <= 8; q++) {
    for (let r = -8; r <= 8; r++) {
      if (Math.abs(q + r) > 8) continue;
      mhexes.push({ q, r });
    }
  }

  function mResize() {
    mc.width = window.innerWidth;
    mc.height = window.innerHeight;
  }
  window.addEventListener('resize', mResize);
  mResize();

  function menuBgRender(t) {
    requestAnimationFrame(menuBgRender);
    if (state.gamePhase !== 'lobby') {
      mc.style.display = 'none';
      return;
    }
    mc.style.display = 'block';
    mx.clearRect(0, 0, mc.width, mc.height);

    // dark background gradient
    const bg = mx.createRadialGradient(mc.width / 2, mc.height * 0.4, 0, mc.width / 2, mc.height * 0.4, mc.width * 0.8);
    bg.addColorStop(0, '#0e0e20');
    bg.addColorStop(1, '#060610');
    mx.fillStyle = bg;
    mx.fillRect(0, 0, mc.width, mc.height);

    // subtle hex grid with slow drift
    const hSize = 40;
    const cx = mc.width / 2, cy = mc.height / 2;
    const drift = t * 0.00003;
    mx.save();
    mx.globalAlpha = 0.03 + 0.01 * Math.sin(t * 0.0005);
    mx.strokeStyle = '#6644aa';
    mx.lineWidth = 0.5;
    mx.translate(cx, cy);
    mx.rotate(drift);
    mx.translate(-cx, -cy);
    mhexes.forEach(h => {
      const px = cx + hSize * 1.5 * h.q;
      const py = cy + hSize * Math.sqrt(3) * (h.r + h.q * 0.5);
      mx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 3 * i - Math.PI / 6;
        if (i === 0) {
          mx.moveTo(px + hSize * 0.9 * Math.cos(a), py + hSize * 0.9 * Math.sin(a));
        } else {
          mx.lineTo(px + hSize * 0.9 * Math.cos(a), py + hSize * 0.9 * Math.sin(a));
        }
      }
      mx.closePath();
      mx.stroke();
    });
    mx.restore();

    // floating particles
    while (mparts.length < 60) {
      mparts.push({
        x: Math.random() * mc.width, y: Math.random() * mc.height,
        vx: (Math.random() - 0.5) * 0.3, vy: -0.15 - Math.random() * 0.2,
        size: 0.5 + Math.random() * 1.5,
        life: Math.random() * 8000, maxLife: 4000 + Math.random() * 6000,
        color: Math.random() > 0.7 ? '#c45a3c' : '#6644aa'
      });
    }
    mparts.forEach(p => {
      p.life -= 16;
      p.x += p.vx;
      p.y += p.vy;
      if (p.life <= 0) {
        p.x = Math.random() * mc.width;
        p.y = mc.height + 10;
        p.life = p.maxLife;
        p.vy = -0.15 - Math.random() * 0.2;
      }
      const alpha = Math.min(
        1, p.life / p.maxLife,
        p.life > p.maxLife * 0.8 ? (p.maxLife - p.life) / (p.maxLife * 0.2) : 1
      ) * 0.3;
      mx.globalAlpha = alpha;
      mx.fillStyle = p.color;
      mx.beginPath();
      mx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      mx.fill();
    });
    mx.globalAlpha = 1;

    // vignette overlay
    const vig = mx.createRadialGradient(
      mc.width / 2, mc.height / 2, mc.width * 0.25,
      mc.width / 2, mc.height / 2, mc.width * 0.75
    );
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.5)');
    mx.fillStyle = vig;
    mx.fillRect(0, 0, mc.width, mc.height);

    // subtle red glow at center top
    mx.save();
    mx.globalAlpha = 0.06 + 0.02 * Math.sin(t * 0.001);
    const glow = mx.createRadialGradient(mc.width / 2, mc.height * 0.3, 0, mc.width / 2, mc.height * 0.3, 200);
    glow.addColorStop(0, '#c45a3c');
    glow.addColorStop(1, 'transparent');
    mx.fillStyle = glow;
    mx.fillRect(0, 0, mc.width, mc.height);
    mx.restore();

    // scan line effect
    if (!window._menuScanPat) {
      const sc = document.createElement('canvas');
      sc.width = 4;
      sc.height = 4;
      const sx = sc.getContext('2d');
      sx.fillStyle = 'rgba(0,0,0,0.035)';
      sx.fillRect(0, 0, 4, 1);
      window._menuScanPat = mx.createPattern(sc, 'repeat');
    }
    mx.fillStyle = window._menuScanPat;
    mx.fillRect(0, 0, mc.width, mc.height);
  }

  requestAnimationFrame(menuBgRender);
})();
