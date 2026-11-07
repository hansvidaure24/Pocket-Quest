// === Drawing ===

import { state } from './state.js';
import { C, ctx } from './canvas.js';
import { hasStatus, isSlowed, isStunned, nearestAlive, nearestEnemy } from './combat.js';
import { activeBiome, T_COVER, T_HAZARD, T_LAVA, T_WALL, TBORD, TCOL, TICON } from './data.js';
import {
  _enemyAt, BOARD, boardHexes, gameMode, getReachable, GRID_R, h2p, hDist, HEX, hNbrs, inGrid, isPassable,
  isWall, terrainAt
} from './hex.js';
import { emit } from './hooks.js';
import {
  _esc, encLabel, hostPlaying, isTutorial, quitToLobby, restartRun, TUT_HINTS, tutStep
} from './lobby.js';
import { BOSS_SPR, CLASS_SPR, drawSpr, TERRAIN_SPR } from './sprites.js';
import { S, survivalScore } from './survival.js';

export function hexPath(cx, cy, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30);
    if (i === 0) ctx.moveTo(cx + size * Math.cos(a), cy + size * Math.sin(a));
    else ctx.lineTo(cx + size * Math.cos(a), cy + size * Math.sin(a));
  }
  ctx.closePath();
}

export function drawGrid(ts) {
  const p0 = state.players[0];
  const alive0 = p0 && p0.hp > 0 && !state.paused && state.running && !state.gameOver;
  const reachable = alive0 ? getReachable(p0) : [];
  const reachSet = new Set(reachable.map(h => h.q + ',' + h.r));
  const atkR = alive0 && p0.classIdx === 1 ? 2 : 1;
  const attackRange = alive0
    ? (atkR > 1
      ? state.entities.filter(e => e.isEnemy && e.hp > 0 && hDist(e, p0) <= atkR).map(e => ({ q: e.q, r: e.r }))
      : hNbrs(p0.q, p0.r).filter(n => _enemyAt(n.q, n.r)))
    : [];
  const atkSet = new Set(attackRange.map(h => h.q + ',' + h.r));

  // enemy threat hexes (where enemies can attack next tick)
  let dangerSet = null;
  if (alive0) {
    dangerSet = new Set();
    state.enemies.forEach(en => {
      if (en.hp <= 0 || isStunned(en)) return;
      hNbrs(en.q, en.r).forEach(n => {
        if (inGrid(n.q, n.r)) dangerSet.add(n.q + ',' + n.r);
      });
      if (!isSlowed(en)) {
        const steps = en.ai === 'charger' && en.charging ? 2 : 1;
        hNbrs(en.q, en.r).forEach(n => {
          if (!inGrid(n.q, n.r) || isWall(n.q, n.r)) return;
          hNbrs(n.q, n.r).forEach(n2 => {
            if (inGrid(n2.q, n2.r)) dangerSet.add(n2.q + ',' + n2.r);
          });
        });
      }
    });
  }

  // skill range preview
  let skillSet = null;
  if (alive0 && state.skillPreview && p0.cdTimer <= 0) {
    skillSet = new Set();
    if (p0.classIdx === 0) {
      hNbrs(p0.q, p0.r).forEach(n => {
        if (inGrid(n.q, n.r)) skillSet.add(n.q + ',' + n.r);
      });
    } else if (p0.classIdx === 1) {
      let dq = p0.faceDQ, dr = p0.faceDR;
      if (!dq && !dr) {
        const ne = nearestEnemy(p0);
        if (ne) {
          dq = Math.sign(ne.q - p0.q) || 0;
          dr = Math.sign(ne.r - p0.r) || 0;
        } else {
          dq = 1;
          dr = 0;
        }
      }
      let lq = p0.q, lr = p0.r;
      for (let s = 0; s < 3; s++) {
        const nq = lq + dq, nr = lr + dr;
        if (!inGrid(nq, nr) || isWall(nq, nr)) break;
        lq = nq;
        lr = nr;
      }
      skillSet.add(lq + ',' + lr);
      hNbrs(lq, lr).forEach(n => {
        if (inGrid(n.q, n.r)) skillSet.add(n.q + ',' + n.r);
      });
    } else if (p0.classIdx === 2) {
      const ne = nearestEnemy(p0);
      if (ne) {
        const dq = Math.sign(ne.q - p0.q), dr = Math.sign(ne.r - p0.r);
        let cq = p0.q, cr = p0.r;
        for (let s = 0; s < 3; s++) {
          cq += dq;
          cr += dr;
          if (!inGrid(cq, cr) || isWall(cq, cr)) break;
          skillSet.add(cq + ',' + cr);
        }
      }
    } else if (p0.classIdx === 3) {
      hNbrs(p0.q, p0.r).forEach(n => {
        if (inGrid(n.q, n.r)) skillSet.add(n.q + ',' + n.r);
      });
    }
  }

  for (const { q, r } of boardHexes()) {
    const { x, y } = h2p(q, r);
    const t = terrainAt(q, r);
    const key = q + ',' + r;
    hexPath(x, y, HEX - 2);

    // depth-of-field: hexes far from player are dimmer
    const edgeDist = BOARD
      ? (BOARD.lane.has(key) ? 0 : 2)
      : GRID_R - Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
    let dofAlpha = edgeDist <= 1 ? 0.5 + edgeDist * 0.5 : 1;
    if (alive0 && !BOARD) {
      const pDist = Math.max(Math.abs(q - p0.q), Math.abs(r - p0.r), Math.abs((-q - r) - (-p0.q - p0.r)));
      if (pDist > 3) dofAlpha *= Math.max(0.55, 1 - (pDist - 3) * 0.08);
    }
    ctx.save();
    if (dofAlpha < 1) ctx.globalAlpha = dofAlpha;

    // base fill — checkerboard for depth
    let fill = t ? TCOL[t.type] : ((q + r) % 2 === 0 ? activeBiome.hexA : activeBiome.hexB);
    ctx.fillStyle = fill;
    ctx.fill();

    // movement preview overlay
    if (reachSet.has(key)) {
      ctx.fillStyle = 'rgba(126,168,121,0.08)';
      ctx.fill();
    }

    // attack range overlay — pulsing
    if (atkSet.has(key)) {
      const atkPulse = 0.1 + 0.06 * Math.sin(ts * 0.006 + q + r * 2);
      ctx.fillStyle = `rgba(196,90,60,${atkPulse})`;
      ctx.fill();
    }

    // skill range overlay — animated pulse
    if (skillSet && skillSet.has(key)) {
      const skPulse = 0.08 + 0.06 * Math.sin(ts * 0.008 + q * 2 + r * 3);
      const skCol = p0.classIdx === 1
        ? `rgba(107,140,174,${skPulse})`
        : p0.classIdx === 3
          ? `rgba(241,250,140,${skPulse * 0.8})`
          : `rgba(196,90,60,${skPulse})`;
      ctx.fillStyle = skCol;
      ctx.fill();
      ctx.save();
      ctx.strokeStyle = p0.classIdx === 1
        ? 'rgba(107,140,174,0.3)'
        : p0.classIdx === 3
          ? 'rgba(241,250,140,0.25)'
          : 'rgba(196,90,60,0.25)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.lineDashOffset = ts * 0.02;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // danger zone (enemy threat range)
    if (dangerSet && dangerSet.has(key) && !reachSet.has(key)) {
      ctx.fillStyle = 'rgba(233,50,50,0.04)';
      ctx.fill();
    }

    // active player hex glow + breathing ring
    if (alive0 && q === p0.q && r === p0.r) {
      ctx.save();
      ctx.globalAlpha = 0.08 + 0.04 * Math.sin(ts * 0.004);
      ctx.fillStyle = p0.color;
      ctx.fill();
      ctx.globalAlpha = 0.15 + 0.1 * Math.sin(ts * 0.005);
      ctx.strokeStyle = p0.color;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // queued move preview with path line — all players
    for (let pi = 0; pi < state.players.length; pi++) {
      const pp2 = state.players[pi];
      if (!pp2 || pp2.hp <= 0 || pp2.ghost || pp2.isBot) continue;
      const pInp = pi === 0 ? state.pendingInput : state.pendingInputs[pi];
      if (!pInp || typeof pInp !== 'object') continue;
      const moveSteps = (pp2.classIdx === 2 || pp2.fleet) ? 2 : 1;
      let fq = pp2.q, fr = pp2.r;
      for (let ms = 0; ms < moveSteps; ms++) {
        const nq = fq + pInp.dq, nr = fr + pInp.dr;
        if (isPassable(nq, nr, pp2)) { fq = nq; fr = nr; }
        else break;
      }
      if (q === fq && r === fr) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fill();
        ctx.save();
        ctx.globalAlpha = pi === 0 ? 0.4 : 0.3;
        ctx.beginPath();
        ctx.arc(x, y, HEX * 0.18, 0, Math.PI * 2);
        ctx.fillStyle = pp2.color;
        ctx.fill();
        const pOrig = h2p(pp2.q, pp2.r);
        ctx.globalAlpha = pi === 0 ? 0.3 : 0.2;
        ctx.strokeStyle = pp2.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -ts * 0.01;
        ctx.beginPath();
        ctx.moveTo(pOrig.x, pOrig.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);
        const ang = Math.atan2(y - pOrig.y, x - pOrig.x);
        ctx.globalAlpha = pi === 0 ? 0.5 : 0.35;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(ang) * HEX * 0.3, y + Math.sin(ang) * HEX * 0.3);
        ctx.lineTo(x + Math.cos(ang + 2.5) * HEX * 0.15, y + Math.sin(ang + 2.5) * HEX * 0.15);
        ctx.lineTo(x + Math.cos(ang - 2.5) * HEX * 0.15, y + Math.sin(ang - 2.5) * HEX * 0.15);
        ctx.closePath();
        ctx.fillStyle = pp2.color;
        ctx.fill();
        ctx.restore();
      }
    }

    // hover highlight
    if (state.mouseHex && state.mouseHex.q === q && state.mouseHex.r === r) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fill();
      if (state.hoverEntity && state.hoverEntity.q === q && state.hoverEntity.r === r) {
        ctx.save();
        ctx.strokeStyle = state.hoverEntity.isEnemy ? 'rgba(196,90,60,0.5)' : 'rgba(126,168,121,0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.strokeStyle = t ? TBORD[t.type] : activeBiome.gridLine;
    ctx.lineWidth = t ? 1.5 : 0.5;
    ctx.stroke();

    // subtle hex coords
    if (!t && state.paused) {
      ctx.save();
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = '#aaa';
      ctx.font = '6px Rajdhani,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${q},${r}`, x, y);
      ctx.restore();
    }

    if (t) {
      if (t.type === T_LAVA && ts) {
        ctx.save();
        ctx.globalAlpha = 0.08 + 0.04 * Math.sin(ts * 0.003 + q * 2 + r * 3);
        ctx.fillStyle = '#ff4400';
        ctx.fill();
        ctx.globalAlpha = 0.04 + 0.02 * Math.sin(ts * 0.002 + q);
        ctx.shadowColor = '#ff4400';
        ctx.shadowBlur = HEX * 0.6;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
        if (ts % 80 < 16 && Math.random() > 0.85) {
          state.statusParticles.push({
            x: x + (Math.random() - 0.5) * HEX * 0.6, y: y,
            vx: (Math.random() - 0.5) * 0.3, vy: -0.8 - Math.random() * 0.4,
            color: '#ff6600', life: 600, maxLife: 600, size: 1.5
          });
        }
      }
      if (t.type === T_HAZARD && ts) {
        ctx.save();
        ctx.globalAlpha = 0.05 + 0.03 * Math.sin(ts * 0.004 + q * 3 + r);
        ctx.fillStyle = '#884422';
        ctx.fill();
        ctx.restore();
      }
      if (t.type === T_COVER && ts) {
        ctx.save();
        ctx.globalAlpha = 0.04 + 0.02 * Math.sin(ts * 0.002 + q * 5 + r * 3);
        ctx.fillStyle = '#7ea879';
        ctx.fill();
        ctx.restore();
      }
      if (!drawSpr(TERRAIN_SPR[t.type], x, y, HEX * 0.7, false)) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.font = '11px Rajdhani,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(TICON[t.type], x, y);
      }
      if (state.mouseHex && state.mouseHex.q === q && state.mouseHex.r === r) {
        const tNames = { [T_WALL]: 'WALL', [T_HAZARD]: 'SPIKES', [T_COVER]: 'COVER', [T_LAVA]: 'LAVA' };
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#ccc';
        ctx.font = 'bold 7px Rajdhani,sans-serif';
        ctx.fillText(tNames[t.type] || '', x, y + HEX * 0.35);
        ctx.restore();
      }
    }
    ctx.restore();
  }
}

export function drawCompass(ts) {
  if (BOARD) return;
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = '#8a8077';
  ctx.font = 'bold 9px Rajdhani,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const n = h2p(0, -GRID_R), s = h2p(0, GRID_R), e = h2p(GRID_R, 0), w = h2p(-GRID_R, 0);
  ctx.fillText('N', n.x, n.y - HEX * 0.7);
  ctx.fillText('S', s.x, s.y + HEX * 0.7);
  ctx.fillText('E', e.x + HEX * 0.7, e.y);
  ctx.fillText('W', w.x - HEX * 0.7, w.y);
  ctx.restore();
}

function lerp(a, b, t) {
  const e = t * t * (3 - 2 * t);
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e };
}

export function triggerSquash(e) {
  e._sqT = performance.now();
}

export function triggerLunge(e, tgt) {
  emit('fx', 'triggerLunge', e, tgt);
  if (!tgt) return;
  const a = h2p(e.q, e.r), b = h2p(tgt.q, tgt.r);
  e._lungeT = performance.now();
  e._lungeAng = Math.atan2(b.y - a.y, b.x - a.x);
}

export const _hpGhosts = new Map();

function drawHPBar(x, y, hp, maxHp, color, dmgPreview, entity) {
  const bw = HEX * 0.82, bh = Math.max(3, HEX * 0.1);
  const bx = x - bw / 2, by = y - HEX * 0.54;

  ctx.fillStyle = 'rgba(140,120,80,0.25)';
  ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
  ctx.fillStyle = '#0f0d0a';
  ctx.fillRect(bx, by, bw, bh);

  const pct = hp / maxHp;

  // delayed ghost bar
  if (entity) {
    const key = (entity.name || '?') + '@' + entity.q + ',' + entity.r;
    let g = _hpGhosts.get(key);
    if (!g) { g = { pct: pct }; _hpGhosts.set(key, g); }
    if (pct < g.pct) {
      ctx.fillStyle = 'rgba(196,120,90,0.35)';
      ctx.fillRect(bx, by, bw * g.pct, bh);
      g.pct = Math.max(pct, g.pct - 0.012);
    } else {
      g.pct = pct;
    }
  }

  const col = pct > 0.5 ? color : pct > 0.25 ? '#c49040' : '#c44040';
  const grad = ctx.createLinearGradient(bx, by, bx, by + bh);
  grad.addColorStop(0, col);
  grad.addColorStop(1, col + 'aa');
  ctx.fillStyle = grad;
  ctx.fillRect(bx, by, bw * pct, bh);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(bx, by, bw * pct, 1);

  if (dmgPreview && dmgPreview > 0) {
    const dpct = Math.min(pct, dmgPreview / maxHp);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(bx + bw * (pct - dpct), by, bw * dpct, bh);
  }
}

const ENEMY_PATHS = {
  tank(x, y, s) {
    ctx.rect(x - s, y - s * 0.8, s * 2, s * 1.6);
  },
  glasscannon(x, y, s) {
    ctx.moveTo(x, y - s * 1.2);
    ctx.lineTo(x + s * 0.7, y);
    ctx.lineTo(x, y + s * 0.8);
    ctx.lineTo(x - s * 0.7, y);
  },
  healer(x, y, s) {
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * 2 * i / 6 - Math.PI / 2;
      ctx.lineTo(x + s * 0.9 * Math.cos(a), y + s * 0.9 * Math.sin(a));
    }
  },
  splasher(x, y, s) {
    ctx.arc(x, y, s * 0.85, 0, Math.PI * 2);
  },
  bomber(x, y, s) {
    ctx.arc(x, y, s * 0.7, 0, Math.PI * 2);
    ctx.moveTo(x, y - s * 0.7);
    ctx.lineTo(x, y - s * 1.2);
  },
  assassin(x, y, s) {
    ctx.moveTo(x, y - s * 1.1);
    ctx.lineTo(x + s * 0.3, y - s * 0.2);
    ctx.lineTo(x + s * 0.9, y + s * 0.5);
    ctx.lineTo(x - s * 0.9, y + s * 0.5);
    ctx.lineTo(x - s * 0.3, y - s * 0.2);
  },
  shieldbearer(x, y, s) {
    ctx.rect(x - s * 0.8, y - s * 0.9, s * 1.6, s * 1.8);
    ctx.moveTo(x - s * 0.5, y - s * 0.6);
    ctx.lineTo(x + s * 0.5, y - s * 0.6);
  },
  summoner(x, y, s) {
    for (let i = 0; i < 8; i++) {
      const a = Math.PI * 2 * i / 8 - Math.PI / 2;
      ctx.lineTo(x + s * (i % 2 ? 0.5 : 0.9) * Math.cos(a), y + s * (i % 2 ? 0.5 : 0.9) * Math.sin(a));
    }
  },
};

const BOSS_BASE_DMG = { boss_warlord: 3, boss_lich: 2, boss_dragon: 2, boss_golem: 2 };
const BOSS_USES_DD = new Set(['boss_warlord', 'boss_lich']);

const INTENT_HANDLERS = {
  healer(e) {
    const hurt = state.enemies.find(a => a !== e && a.hp > 0 && a.hp < a.maxHp);
    return { intent: hurt ? '💚' : '🚶' };
  },
  charger(e, tgt, dd) {
    if (e.charging) return { intent: '💨', intentNum: '' + (2 + dd) };
    return { intent: '⚠' };
  },
  glasscannon(e, tgt, dd) {
    if (e.telegraphTarget || (e.shootTimer || 0) >= 1) return { intent: '🎯', intentNum: '' + (3 + dd) };
    if (tgt && hDist(e, tgt) <= 2) return { intent: '⚡' };
    return { intent: '🚶' };
  },
  splasher(e, tgt) {
    if (tgt && hDist(e, tgt) <= 1) return { intent: '💥', intentNum: '1' };
    return { intent: '🚶' };
  },
  bomber(e) {
    return { intent: (e.bossTimer || 0) % 3 === 2 ? '💣' : '🚶' };
  },
  assassin(e, tgt) {
    if (e._invisible) return { intent: '👁' };
    if (tgt && hDist(e, tgt) <= 1) return { intent: '⚔', intentNum: '1' };
    return { intent: '⚔' };
  },
  shieldbearer(e, tgt) {
    if (tgt && hDist(e, tgt) <= 1) return { intent: '🛡⚔', intentNum: '1' };
    return { intent: '🛡' };
  },
  summoner(e) {
    return { intent: (e.bossTimer || 0) % 3 === 2 ? '✦' : '🚶' };
  },
};

function getEnemyIntent(e, tgt, dd) {
  const handler = INTENT_HANDLERS[e.ai];
  if (handler) return handler(e, tgt, dd);
  if (e.isBoss) {
    const base = BOSS_BASE_DMG[e.ai] ?? 2;
    const bDmg = base + (BOSS_USES_DD.has(e.ai) ? dd : 0) + (e.bossPhase >= 2 ? 1 : 0);
    if (e.telegraph) return { intent: '⚡', intentNum: '' + bDmg };
    if (tgt && hDist(e, tgt) <= 1) return { intent: '⚔', intentNum: '' + Math.min(bDmg, 2) };
    return { intent: '🚶' };
  }
  if (tgt && hDist(e, tgt) <= 1) return { intent: '⚔', intentNum: '1' };
  return { intent: '🚶' };
}

export function drawEntity(e, t, globalTime) {
  const prev = h2p(e.prevQ ?? e.q, e.prevR ?? e.r);
  const curr = h2p(e.q, e.r);
  let { x, y } = lerp(prev, curr, t);

  // idle bob
  if (e.hp > 0 && !e.ghost) {
    const bobSpeed = e.isEnemy ? 2 : 1.5;
    y += Math.sin(globalTime * 0.003 * bobSpeed + (e.q * 3 + e.r * 7)) * 3;
  }

  // lunge offset
  let lungeP = 0;
  if (e._lungeT != null) {
    const la = Math.min(1, (globalTime - e._lungeT) / 140);
    if (la < 1) {
      lungeP = la < 0.35 ? la / 0.35 : (1 - la) / 0.65;
      const d = HEX * 0.3 * lungeP;
      x += Math.cos(e._lungeAng) * d;
      y += Math.sin(e._lungeAng) * d;
    } else {
      e._lungeT = null;
    }
  }

  // squash on land
  let sqX = 1, sqY = 1;
  if (e._sqT != null) {
    const sa = Math.min(1, (globalTime - e._sqT) / 180);
    if (sa < 1) {
      const w = sa < 0.3 ? sa / 0.3 : 1 - (sa - 0.3) / 0.7;
      const s = w * 0.18;
      sqX = 1 + s;
      sqY = 1 - s;
    } else {
      e._sqT = null;
    }
  }

  // spawn portal particles
  const spawnAge = e.spawnTick != null ? state.tickCount - e.spawnTick : 99;
  if (e.isEnemy && spawnAge < 3 && globalTime % 40 < 16) {
    const ang = globalTime * 0.02 + e.q * 5;
    state.statusParticles.push({
      x: x + Math.cos(ang) * HEX * 0.5, y: y + Math.sin(ang) * HEX * 0.5,
      vx: Math.cos(ang) * -0.5, vy: Math.sin(ang) * -0.5,
      color: e.color, life: 350, maxLife: 350, size: 2
    });
  }

  const spawnAlpha = spawnAge < 8 ? Math.min(1, spawnAge / 8 + t / 8) : 1;
  const spawnScale = spawnAge < 4 ? 0.6 + 0.4 * Math.min(1, (spawnAge + t) / 4) : 1;
  const alpha = (e.ghost ? 0.3 : e._invisible ? 0.08 : 1) * spawnAlpha;
  ctx.globalAlpha = alpha;
  const flashing = state.flashEffects.find(f => f.target === e);

  // telegraph
  if (e.telegraph) {
    ctx.save();
    ctx.globalAlpha = 0.2 + 0.25 * Math.sin(globalTime * 0.012);
    hexPath(x, y, HEX * 0.78);
    ctx.fillStyle = '#ff4500';
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = alpha;
  }

  // bounty target indicator
  if (e._bounty && e.hp > 0) {
    ctx.save();
    const bp = 0.5 + 0.5 * Math.sin(globalTime * 0.008);
    ctx.strokeStyle = '#e8c840';
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.4 + 0.4 * bp;
    hexPath(x, y, HEX * 0.75 + bp * 4);
    ctx.stroke();
    ctx.fillStyle = '#e8c840';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('★ BOUNTY', x, y - HEX * 0.85);
    ctx.restore();
    ctx.globalAlpha = alpha;
  }

  // enemy aggro line
  if (e.isEnemy && e.hp > 0 && !e.telegraphTarget) {
    const targ = nearestAlive(e);
    if (targ && hDist(e, targ) <= 3) {
      const tp = h2p(targ.q, targ.r);
      ctx.save();
      ctx.globalAlpha = 0.06;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(tp.x, tp.y);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = alpha;
    }
  }

  // mimic mirror link
  if (e.ai === 'mimic' && e.mimicTarget && e.hp > 0) {
    if (Math.sin(globalTime * 0.008) > 0.7) {
      ctx.save();
      ctx.globalAlpha = 0.15;
      ctx.beginPath();
      ctx.arc(x, y, HEX * 0.38, 0, Math.PI * 2);
      ctx.fillStyle = e.mimicTarget.color;
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = alpha;
    }
    const tp = h2p(e.mimicTarget.q, e.mimicTarget.r);
    ctx.save();
    ctx.globalAlpha = 0.15;
    ctx.strokeStyle = '#cc88ff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tp.x, tp.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    ctx.globalAlpha = alpha;
  }

  // healer beam
  if (e.healBeamTarget && e.hp > 0) {
    const tp = h2p(e.healBeamTarget.q, e.healBeamTarget.r);
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = '#98fb98';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tp.x, tp.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const pulseT = (globalTime % 800) / 800;
    const px = x + (tp.x - x) * pulseT, py = y + (tp.y - y) * pulseT;
    ctx.globalAlpha = 0.4 * (1 - pulseT);
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#98fb98';
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = alpha;
  }

  // targeting line
  if (e.telegraphTarget) {
    const tp = h2p(e.telegraphTarget.q, e.telegraphTarget.r);
    const isGC = e.ai === 'glasscannon';
    ctx.save();
    ctx.globalAlpha = isGC
      ? 0.5 + 0.2 * Math.sin(globalTime * 0.015)
      : 0.3 + 0.15 * Math.sin(globalTime * 0.01);
    ctx.strokeStyle = isGC ? '#c49040' : '#a38530';
    ctx.lineWidth = isGC ? 3 : 2;
    ctx.setLineDash(isGC ? [2, 3] : [6, 4]);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tp.x, tp.y);
    ctx.stroke();
    if (isGC) {
      ctx.globalAlpha = 0.15 + 0.1 * Math.sin(globalTime * 0.02);
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, HEX * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = '#c49040';
      ctx.fill();
      const chargeR = HEX * 0.15 + HEX * 0.12 * Math.sin(globalTime * 0.012);
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(x, y, chargeR, 0, Math.PI * 2);
      ctx.fillStyle = '#ffcc44';
      ctx.fill();
    }
    ctx.setLineDash([]);
    ctx.restore();
    ctx.globalAlpha = alpha;
  }

  // poison tint + drip
  const poisoned = hasStatus(e, 'poison');
  if (poisoned && e.hp > 0 && globalTime % 200 < 16) {
    state.statusParticles.push({
      x: x + (Math.random() - 0.5) * 8, y: y + HEX * 0.3,
      vx: 0, vy: 1 + Math.random() * 0.5,
      color: '#5a9a60', life: 400, maxLife: 400, size: 2
    });
  }
  // 6-digit so the fallback circle can append alpha ('#ffffff88')
  const col = flashing ? '#ffffff' : poisoned ? '#55aa44' : e.color;

  // spawn scale
  if (spawnScale < 1) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(spawnScale, spawnScale);
    ctx.translate(-x, -y);
  }

  // squash/stretch transform
  const hasSq = sqX !== 1 || sqY !== 1;
  if (hasSq) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sqX, sqY);
    ctx.translate(-x, -y);
  }

  // drop shadow
  if (e.hp > 0 || e.ghost) {
    ctx.save();
    ctx.globalAlpha = alpha * 0.2;
    ctx.beginPath();
    ctx.ellipse(x, y + HEX * 0.18, HEX * 0.38, HEX * 0.12, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = alpha;
  }

  if (e.isEnemy) {
    const eKey = e.isBoss ? BOSS_SPR[e.ai] : e.ai;
    const eSz = e.isBoss ? HEX * 1.5 : HEX * 1.1;
    if (!drawSpr(eKey, x, y, eSz, flashing)) {
      if (e.isBoss) {
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = Math.PI * 2 * i / 5 - Math.PI / 2;
          ctx.lineTo(x + HEX * 0.55 * Math.cos(a), y + HEX * 0.55 * Math.sin(a));
        }
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();
      } else {
        const s = HEX * 0.46;
        ctx.beginPath();
        const drawPath = ENEMY_PATHS[e.ai];
        if (drawPath) {
          drawPath(x, y, s);
        } else {
          ctx.moveTo(x, y - HEX * 0.46);
          ctx.lineTo(x + s, y + HEX * 0.3);
          ctx.lineTo(x - s, y + HEX * 0.3);
        }
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // boss aura
    if (e.isBoss) {
      ctx.save();
      ctx.globalAlpha = 0.06 + 0.04 * Math.sin(globalTime * 0.003);
      ctx.shadowColor = '#b8943e';
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.arc(x, y, HEX * 0.6, 0, Math.PI * 2);
      ctx.strokeStyle = '#b8943e';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = alpha;
    }

    // facing arrow for enemies
    if (e.faceDQ != null && e.hp > 0) {
      const fp = h2p(e.q + e.faceDQ, e.r + e.faceDR);
      const ang = Math.atan2(fp.y - y, fp.x - x);
      const arD = e.isBoss ? HEX * 0.55 : HEX * 0.46;
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(ang) * arD, y + Math.sin(ang) * arD);
      ctx.lineTo(x + Math.cos(ang + 2.6) * arD * 0.3, y + Math.sin(ang + 2.6) * arD * 0.3);
      ctx.lineTo(x + Math.cos(ang - 2.6) * arD * 0.3, y + Math.sin(ang - 2.6) * arD * 0.3);
      ctx.closePath();
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = alpha;
    }

    // intent icon
    if (e.hp > 0 && !isStunned(e)) {
      const tgt = nearestAlive(e);
      const dd = Math.max(1, state.difficulty - 1);
      const { intent, intentNum } = getEnemyIntent(e, tgt, dd);

      if (intent) {
        const ix = x + HEX * 0.38, iy = y - HEX * 0.42;
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.font = `${Math.round(HEX * 0.3)}px Rajdhani,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(intent, ix, iy);
        if (intentNum) {
          ctx.font = `bold ${Math.round(HEX * 0.24)}px Rajdhani,sans-serif`;
          ctx.fillStyle = '#ff6666';
          ctx.fillText(intentNum, ix, iy + HEX * 0.28);
        }
        ctx.restore();
        ctx.globalAlpha = alpha;
      }
    }

    // elite crown
    if (e.isElite && e.hp > 0) {
      ctx.save();
      ctx.globalAlpha = 0.7;
      if (!drawSpr('crown', x, y - HEX * 0.5, HEX * 0.4, false)) {
        ctx.font = '8px Rajdhani,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('👑', x, y - HEX * 0.5);
      }
      ctx.restore();
      ctx.globalAlpha = alpha;
    }

    // tank bodyblock indicator
    if (e.ai === 'tank' && e.hp > 0 && hNbrs(e.q, e.r).some(n => state.enemies.find(en => en !== e && en.hp > 0 && en.q === n.q && en.r === n.r))) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.font = '9px Rajdhani,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('🛡', x, y - HEX * 0.45);
      ctx.restore();
      ctx.globalAlpha = alpha;
    }

    // shieldbearer facing indicator
    if (e.ai === 'shieldbearer' && e.hp > 0 && e.faceDQ != null) {
      const fAng = Math.atan2(e.faceDR, e.faceDQ);
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.2 * Math.sin(globalTime * 0.008);
      ctx.beginPath();
      ctx.arc(x, y, HEX * 0.48, fAng - 0.8, fAng + 0.8);
      ctx.strokeStyle = '#88bbdd';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = alpha;
    }

    // critical HP pulse
    if (e.hp === 1 && !e.isBoss) {
      ctx.save();
      ctx.globalAlpha = 0.15 + 0.12 * Math.sin(globalTime * 0.015);
      ctx.beginPath();
      ctx.arc(x, y, HEX * 0.48, 0, Math.PI * 2);
      ctx.strokeStyle = '#c44040';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = alpha;
    }

    // enrage glow
    if (e.enraged) {
      ctx.save();
      ctx.globalAlpha = 0.2 + 0.15 * Math.sin(globalTime * 0.01);
      ctx.beginPath();
      ctx.arc(x, y, HEX * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = '#c44030';
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = alpha;
    }

    // splasher death-pulse warning
    if (e.ai === 'splasher' && e.hp > 0 && e.hp <= Math.ceil(e.maxHp * 0.5)) {
      const rate = e.hp === 1 ? 0.02 : 0.008;
      ctx.save();
      ctx.globalAlpha = 0.15 + 0.2 * Math.abs(Math.sin(globalTime * rate));
      ctx.beginPath();
      ctx.arc(x, y, HEX * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = '#b87a8a';
      ctx.fill();
      if (e.hp === 1) {
        ctx.globalAlpha = 0.08 + 0.06 * Math.sin(globalTime * 0.015);
        ctx.beginPath();
        ctx.arc(x, y, HEX * 1.2, 0, Math.PI * 2);
        ctx.strokeStyle = '#b87a8a';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
      ctx.globalAlpha = alpha;
    }

    // eyes
    ctx.fillStyle = flashing ? '#000' : '#0c0a08';
    const eyeOff = HEX * 0.1, eyeR = HEX * 0.04;
    ctx.beginPath();
    ctx.arc(x - eyeOff, y - 1, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + eyeOff, y - 1, eyeR, 0, Math.PI * 2);
    ctx.fill();

  } else {
    // player rendering

    // colored ground ring
    ctx.save();
    ctx.globalAlpha = alpha * 0.25;
    ctx.beginPath();
    ctx.arc(x, y + HEX * 0.08, HEX * 0.44, 0, Math.PI * 2);
    ctx.fillStyle = e.color;
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = alpha;

    // outer glow ring for active player
    if (e === state.players[0] && e.hp > 0) {
      ctx.save();
      ctx.globalAlpha = 0.12 + 0.06 * Math.sin(globalTime * 0.004);
      ctx.shadowColor = e.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(x, y, HEX * 0.48, 0, Math.PI * 2);
      ctx.strokeStyle = e.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = alpha;
    }

    // player sprite or fallback circle
    if (!drawSpr(CLASS_SPR[e.classIdx], x, y, HEX * 1.05, flashing)) {
      const pGrad = ctx.createRadialGradient(x - HEX * 0.08, y - HEX * 0.1, 0, x, y, HEX * 0.44);
      pGrad.addColorStop(0, '#fff');
      pGrad.addColorStop(0.3, col);
      pGrad.addColorStop(1, col + '88');
      ctx.beginPath();
      ctx.arc(x, y, HEX * 0.44, 0, Math.PI * 2);
      ctx.fillStyle = pGrad;
      ctx.fill();
      ctx.strokeStyle = e === state.players[0] ? '#fff' : 'rgba(255,255,255,0.4)';
      ctx.lineWidth = e === state.players[0] ? 2.5 : 1.2;
      ctx.stroke();
      if (e.hp > 0) {
        const cIcons = ['⚔', '🔥', '🗡', '✚'];
        ctx.save();
        ctx.globalAlpha = 0.7;
        ctx.font = `${Math.round(HEX * 0.38)}px Rajdhani,sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cIcons[e.classIdx] || '?', x, y + 1);
        ctx.restore();
        ctx.globalAlpha = alpha;
      }
    }

    // player name label
    if (e.hp > 0 || e.ghost) {
      ctx.save();
      ctx.globalAlpha = e.ghost ? 0.3 : 0.65;
      ctx.font = `bold ${Math.round(HEX * 0.32)}px Rajdhani,sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = e.color;
      ctx.fillText(e.name, x, y + HEX * 0.5);
      ctx.restore();
      ctx.globalAlpha = alpha;
    }

    // facing arrow
    if (e.faceDQ != null && e.hp > 0) {
      const fp = h2p(e.q + e.faceDQ, e.r + e.faceDR);
      const ang = Math.atan2(fp.y - y, fp.x - x);
      const arD = HEX * 0.44;
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(ang) * arD, y + Math.sin(ang) * arD);
      ctx.lineTo(x + Math.cos(ang + 2.6) * arD * 0.35, y + Math.sin(ang + 2.6) * arD * 0.35);
      ctx.lineTo(x + Math.cos(ang - 2.6) * arD * 0.35, y + Math.sin(ang - 2.6) * arD * 0.35);
      ctx.closePath();
      ctx.fillStyle = e.color;
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = alpha;
    }

    // queued action icon
    {
      const pi = state.players.indexOf(e);
      const pInp = pi === 0 ? state.pendingInput : state.pendingInputs[pi];
      if (pInp && e.hp > 0 && !e.ghost) {
        const qi = pInp === 'attack' ? '⚔'
          : pInp === 'skill' ? '✦'
          : pInp === 'defend' ? '🛡'
          : pInp === 'item' ? '📦'
          : typeof pInp === 'object' ? '➜' : '';
        if (qi) {
          ctx.save();
          ctx.globalAlpha = 0.75;
          ctx.font = `bold ${Math.round(HEX * 0.32)}px Rajdhani,sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillStyle = e.color;
          ctx.fillText(qi, x, y - HEX * 0.5);
          ctx.restore();
          ctx.globalAlpha = alpha;
        }
      }
    }

    // incoming attack warning
    if (e === state.players[0] && e.hp > 0) {
      const incomingTelegraph = state.enemies.find(en => en.hp > 0 && en.telegraphTarget === e);
      if (incomingTelegraph) {
        ctx.save();
        ctx.globalAlpha = 0.4 + 0.3 * Math.sin(globalTime * 0.02);
        ctx.font = 'bold 9px Rajdhani,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#c45050';
        ctx.fillText('⚠ INCOMING!', x, y - HEX * 0.62);
        ctx.restore();
        ctx.globalAlpha = alpha;
      }
    }

    // player indicator
    if (e === state.players[0]) {
      ctx.beginPath();
      ctx.arc(x, y - HEX * 0.34 - 6, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      if (e.hp > 0 && !state.pendingInput && state.running && !state.gameOver && !state.paused && state.tickTimer / state.tickMs > 0.6) {
        const urgency = Math.min(1, (state.tickTimer / state.tickMs - 0.6) / 0.4);
        ctx.save();
        ctx.globalAlpha = urgency * 0.25 * (0.5 + 0.5 * Math.sin(globalTime * 0.015));
        ctx.beginPath();
        ctx.arc(x, y, HEX * 0.55 + urgency * 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#b8943e';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = alpha;
      }
      if (e.hp > 0 && hNbrs(e.q, e.r).some(n => _enemyAt(n.q, n.r))) {
        ctx.save();
        ctx.globalAlpha = 0.12 + 0.08 * Math.sin(globalTime * 0.01);
        ctx.beginPath();
        ctx.arc(x, y, HEX * 0.52, 0, Math.PI * 2);
        ctx.strokeStyle = '#c45a3c';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = alpha;
      }
    }

    if (!e.isEnemy && e.hp > 0) {
      const pIdx = state.players.indexOf(e) + 1;
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = 'bold 6px Rajdhani,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(e.isBot ? 'P' + pIdx : 'P1', x, y - HEX * 0.34 - 5);
    }

    // cover ring
    const tr = terrainAt(e.q, e.r);
    if (tr && tr.type === T_COVER && e.hp > 0) {
      ctx.strokeStyle = 'rgba(42,106,74,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, HEX * 0.42, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // cover ring for enemies too
  if (e.isEnemy && e.hp > 0) {
    const tr2 = terrainAt(e.q, e.r);
    if (tr2 && tr2.type === T_COVER) {
      ctx.strokeStyle = 'rgba(42,106,74,0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, HEX * 0.42, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // defend shield
  if (!e.isEnemy && e.defending && e.hp > 0) {
    ctx.save();
    const dPulse = 0.4 + 0.15 * Math.sin(globalTime * 0.008);
    ctx.globalAlpha = dPulse;
    hexPath(x, y, HEX * 0.55);
    ctx.strokeStyle = '#607a90';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    for (let di = 0; di < 3; di++) {
      const da = globalTime * 0.004 + di * Math.PI * 2 / 3;
      const dx = x + Math.cos(da) * HEX * 0.48;
      const dy = y + Math.sin(da) * HEX * 0.48;
      ctx.globalAlpha = dPulse * 0.8;
      ctx.beginPath();
      ctx.arc(dx, dy, HEX * 0.08, 0, Math.PI * 2);
      ctx.fillStyle = '#8ab0cc';
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = alpha;
  }

  // heal shimmer glow
  if (e._healT != null) {
    const ha = Math.min(1, (globalTime - e._healT) / 400);
    if (ha < 1) {
      ctx.save();
      ctx.globalAlpha = (1 - ha) * 0.3;
      ctx.shadowColor = '#7ea879';
      ctx.shadowBlur = HEX * 0.8;
      ctx.beginPath();
      ctx.arc(x, y, HEX * 0.45 * (1 + ha * 0.3), 0, Math.PI * 2);
      ctx.fillStyle = '#7ea879';
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = alpha;
    } else {
      e._healT = null;
    }
  }

  // item badge
  if (!e.isEnemy && e.item && e.hp > 0) {
    const itemSprMap = {
      '💣': 'bomb', '🧪': 'potion', '💨': 'smoke', '📜': 'scroll',
      '❄️': 'frost-bomb', '📯': 'war-horn', '🧫': 'poison-vial',
      '⚡': 'stun-trap', '🛡': 'shield-bash-item'
    };
    const iKey = itemSprMap[e.item.icon];
    if (!drawSpr(iKey, x - HEX * 0.45, y - HEX * 0.25, HEX * 0.35, false)) {
      ctx.font = '10px Rajdhani,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(e.item.icon, x - HEX * 0.45, y - HEX * 0.25);
    }
  }

  // HP bar
  let dmgPrev = 0;
  if (e.isEnemy && e.hp > 0 && state.hoverEntity === e) {
    const p0 = state.players[0];
    if (p0 && p0.hp > 0 && hDist(p0, e) <= 1) {
      dmgPrev = 1 + (p0.dmgBonus || 0);
      if (state.players.find(a => a !== p0 && a.hp > 0 && hDist(a, e) <= 1 && hDist(a, p0) >= 2)) dmgPrev++;
      dmgPrev += state.players.filter(a => a.ghost && hDist(a, p0) <= 1).length;
      if (p0.lastStand) dmgPrev++;
      if (terrainAt(e.q, e.r)?.type === T_COVER) dmgPrev = Math.max(1, dmgPrev - 1);
    }
  }
  if (e.hp > 0) drawHPBar(x, y, e.hp, e.maxHp, e.isEnemy ? '#c45a3c' : '#7ea879', dmgPrev, e);

  // name
  ctx.font = '8px Rajdhani,sans-serif';
  ctx.fillStyle = '#777';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(e.name, x, y + HEX * 0.4 + 2);

  // flanking indicator
  if (!e.isEnemy && e.hp > 0) {
    const flanks = hNbrs(e.q, e.r).filter(n => {
      const t = _enemyAt(n.q, n.r);
      if (!t) return false;
      return state.players.find(a => a !== e && a.hp > 0 && hDist(a, t) <= 1 && hDist(a, e) >= 2);
    });
    if (flanks.length > 0) {
      ctx.fillStyle = 'rgba(184,148,62,0.6)';
      ctx.font = 'bold 8px Rajdhani,sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillText('⚔ FLANK', x, y - HEX * 0.42);
    }
  }

  // being flanked warning
  if (!e.isEnemy && e.hp > 0) {
    const adjE = hNbrs(e.q, e.r).map(n => _enemyAt(n.q, n.r)).filter(Boolean);
    if (adjE.length >= 2 && adjE.some((a, i) => adjE.some((b, j) => j > i && hDist(a, b) >= 2))) {
      ctx.save();
      ctx.globalAlpha = 0.12 + 0.06 * Math.sin(globalTime * 0.01);
      ctx.beginPath();
      ctx.arc(x, y, HEX * 0.52, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff8800';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = alpha;
    }
  }

  // cooldown
  if (!e.isEnemy && e.hp > 0) {
    ctx.textBaseline = 'middle';
    if (e.cdTimer > 0) {
      ctx.fillStyle = 'rgba(255,255,0,0.6)';
      ctx.font = 'bold 8px Rajdhani,sans-serif';
      ctx.fillText(e.cdTimer, x + HEX * 0.43, y - HEX * 0.22);
    } else {
      const pulse = 0.6 + 0.4 * Math.sin(globalTime * 0.008);
      ctx.fillStyle = `rgba(0,255,0,${pulse * 0.15})`;
      ctx.beginPath();
      ctx.arc(x, y, HEX * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0f0';
      ctx.font = 'bold 9px Rajdhani,sans-serif';
      ctx.fillText('✦', x + HEX * 0.43, y - HEX * 0.22);
    }
  }

  // status effect icons
  if (e.statuses && e.statuses.length > 0 && e.hp > 0) {
    const icons = { poison: '🟢', stun: '⚡', slow: '❄️' };
    let sx = x - ((e.statuses.length - 1) * 6);
    ctx.font = '8px Rajdhani,sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    e.statuses.forEach(s => {
      ctx.globalAlpha = 0.7 + 0.2 * Math.sin(globalTime * 0.006);
      ctx.fillText(icons[s.type] || '?', sx, y + HEX * 0.4);
      sx += 12;
    });
    // spinning stars for stun
    if (hasStatus(e, 'stun')) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.font = '7px Rajdhani,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let si = 0; si < 3; si++) {
        const sa = globalTime * 0.008 + si * Math.PI * 2 / 3;
        ctx.fillText('⭐', x + Math.cos(sa) * HEX * 0.4, y - HEX * 0.25 + Math.sin(sa) * HEX * 0.15);
      }
      ctx.restore();
      ctx.globalAlpha = alpha;
    }
    // icy ring for slow
    if (hasStatus(e, 'slow')) {
      ctx.save();
      ctx.globalAlpha = 0.2 + 0.1 * Math.sin(globalTime * 0.01);
      ctx.beginPath();
      ctx.arc(x, y, HEX * 0.46, 0, Math.PI * 2);
      ctx.strokeStyle = '#88ccff';
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      ctx.globalAlpha = alpha;
    }
  }

  if (e.ghost) {
    const isBlocking = hNbrs(e.q, e.r).some(n => state.enemies.find(en => en.hp > 0 && en.q === n.q && en.r === n.r));
    if (isBlocking) {
      ctx.save();
      ctx.globalAlpha = 0.1 + 0.06 * Math.sin(globalTime * 0.008);
      hexPath(x, y, HEX - 3);
      ctx.fillStyle = e.color;
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = alpha;
    }
    // ghost buff radius ring
    ctx.save();
    ctx.globalAlpha = 0.06 + 0.03 * Math.sin(globalTime * 0.003);
    ctx.beginPath();
    ctx.arc(x, y, HEX * 1.3, 0, Math.PI * 2);
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    // ghost float offset
    const ghostFloat = Math.sin(globalTime * 0.003 + e.q * 2) * 4;
    ctx.globalAlpha = 0.5 + 0.1 * Math.sin(globalTime * 0.004);
    if (!drawSpr('ghost', x, y + 2 + ghostFloat, HEX * 0.7, false)) {
      ctx.font = '13px Rajdhani,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('👻', x, y + 2 + ghostFloat);
    }
    if (globalTime % 120 < 16) {
      state.statusParticles.push({
        x: x + (Math.random() - 0.5) * 10, y: y + 8 + ghostFloat,
        vx: 0, vy: 0.3,
        color: e.color, life: 400, maxLife: 400, size: 1.5
      });
    }
    // ethereal trail
    if (t < 0.8 && (e.prevQ !== e.q || e.prevR !== e.r) && globalTime % 30 < 16) {
      for (let gi = 0; gi < 2; gi++) {
        state.statusParticles.push({
          x: x + (Math.random() - 0.5) * 12, y: y + (Math.random() - 0.5) * 12,
          vx: (Math.random() - 0.5) * 0.5, vy: -0.3 - Math.random() * 0.5,
          color: e.color + '88', life: 300, maxLife: 300, size: 1 + Math.random()
        });
      }
    }
  }

  if (hasSq) ctx.restore();
  if (spawnScale < 1) ctx.restore();

  // cleric aura ring
  if (!e.isEnemy && e.hp > 0 && e.classIdx === 3) {
    ctx.save();
    ctx.globalAlpha = 0.06 + 0.03 * Math.sin(globalTime * 0.004);
    ctx.beginPath();
    ctx.arc(x, y, HEX * 1.3, 0, Math.PI * 2);
    ctx.strokeStyle = '#c9973e';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    ctx.globalAlpha = alpha;
  }

  // tick countdown ring
  if (e === state.players[0] && e.hp > 0 && state.running && !state.gameOver && !state.paused) {
    const pct = Math.min(1, state.tickTimer / state.tickMs);
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.arc(x, y, HEX * 0.48, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
    ctx.strokeStyle = pct > 0.8 ? '#c45a3c' : '#7ea879';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  // berserker aura
  if (!e.isEnemy && e.hp > 0 && e.berserk && e.hp <= Math.ceil(e.maxHp * 0.5)) {
    ctx.save();
    ctx.globalAlpha = 0.12 + 0.06 * Math.sin(globalTime * 0.008);
    ctx.beginPath();
    ctx.arc(x, y, HEX * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = '#ff4400';
    ctx.fill();
    ctx.restore();
  }

  // last stand aura
  if (!e.isEnemy && e.hp > 0 && e.lastStand) {
    ctx.save();
    ctx.globalAlpha = 0.15 + 0.1 * Math.sin(globalTime * 0.006);
    ctx.beginPath();
    ctx.arc(x, y, HEX * 0.58, 0, Math.PI * 2);
    ctx.fillStyle = '#b8943e';
    ctx.fill();
    ctx.strokeStyle = '#b8943e';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  ctx.globalAlpha = 1;
  ctx.textBaseline = 'alphabetic';
}

// === HUD ===
function updateHud() {
  const diffNames = ['Easy', 'Normal', 'Hard'];
  const gsTxt = document.getElementById('game-status-txt');
  if (gsTxt) gsTxt.textContent = `${activeBiome.name} · ${diffNames[state.difficulty] || 'Normal'} · ${state.players.length}P · Lv${state.partyLevel} · Tick ${state.tickCount}`;

  const fp = state.players.map(p =>
    p.hp + '|' + p.maxHp + '|' + (p.cdTimer || 0) + '|' + (p.defending ? 1 : 0)
    + '|' + (p.ghost ? 1 : 0) + '|' + (p.item ? p.item.icon : '')
    + '|' + (p.upgrades ? p.upgrades.length : 0) + '|' + (p._dc ? 1 : 0)
  ).join(',') + ';' + state.enemies.filter(e => e.hp > 0).map(e =>
    e.hp + '|' + (e.statuses ? e.statuses.length : 0)
  ).join(',');

  if (fp === updateHud._fp) return;
  updateHud._fp = fp;

  let html = '';
  state.players.forEach((p, i) => {
    const tag = p._dc ? ' (DC)' : i === 0 ? ' (YOU)' : p.isBot ? ' (AI)' : ' (P' + (i + 1) + ')';
    const status = p.ghost ? ' 👻' : p.hp <= 0 ? ' ☠️' : '';
    const cd = p.hp > 0 ? (p.cdTimer > 0 ? ` [${p.ability}: ${p.cdTimer}]` : ` [${p.ability}: ✦]`) : '';
    const item = p.item ? ` ${p.item.icon}` : '';
    const def = p.defending ? ' 🛡' : '';
    const ups = p.upgrades && p.upgrades.length
      ? '<br><span style="font-size:0.5625rem;color:#b8943e">' + p.upgrades.join('') + '</span>' : '';
    const hpChanged = p._lastHudHp !== undefined && p._lastHudHp !== p.hp;
    const hpFlash = hpChanged
      ? (p.hp < p._lastHudHp ? 'background:rgba(196,90,60,0.25)' : 'background:rgba(126,168,121,0.25)')
      : '';
    p._lastHudHp = p.hp;
    const hpPct = Math.round(p.hp / p.maxHp * 100);
    const hpCol = hpPct > 50 ? '#7ea879' : hpPct > 25 ? '#c49040' : '#c44040';
    html += `<div class="phud" style="border-left:2px solid ${p.color};${hpFlash};transition:background 0.3s">` +
      `<b style="letter-spacing:0.031rem">${_esc(p.name)}${tag}</b>${status}${def}<br>` +
      `<span style="color:${hpCol}">${p.hp}/${p.maxHp}</span>${cd}${item}${ups}` +
      `<div style="height:2px;background:#0f0d0a;margin-top:0.1875rem;border-radius:1px">` +
      `<div style="width:${hpPct}%;height:100%;background:${hpCol};border-radius:1px;transition:width 0.3s"></div>` +
      `</div></div>`;
  });

  state.enemies.filter(e => e.hp > 0).forEach(e => {
    const bossTag = e.isBoss ? ' ⭐' : e.isElite ? ' 👑' : '';
    const eStatus = e.statuses && e.statuses.length
      ? (' ' + e.statuses.map(s => ({ poison: '🟢', stun: '⚡', slow: '❄️' }[s.type] || '')).join(''))
      : '';
    const eHpPct = Math.round(e.hp / e.maxHp * 100);
    html += `<div class="ehud"><b>${e.name}${bossTag}</b>${eStatus}<br>` +
      `<span style="color:#777">${e.hp}/${e.maxHp}</span>` +
      `<div style="height:2px;background:#0f0d0a;margin-top:0.125rem;border-radius:1px">` +
      `<div style="width:${eHpPct}%;height:100%;background:#c45a3c;border-radius:1px"></div>` +
      `</div></div>`;
  });

  document.getElementById('hud').innerHTML = html;
}

export function updatePauseInfo() {
  const aliveP = state.players.filter(p => p.hp > 0).length;
  const aliveE = state.enemies.filter(e => e.hp > 0).length;
  const pi = document.getElementById('pause-info');
  if (!pi) return;

  const diffNames = ['Easy', 'Normal', 'Hard'];
  let html = `<div style="color:#888;font-size:0.75rem;margin-bottom:0.5rem">${activeBiome.name} · ${diffNames[state.difficulty] || 'Normal'} · Tick ${state.tickCount} · ${encLabel()} · Lv${state.partyLevel}</div>`;

  const surv = gameMode === 'survival' && typeof S !== 'undefined' && S;
  if (surv) {
    html += `<div style="color:#e8c878;font-size:0.9375rem;font-weight:700;letter-spacing:0.0625rem;margin-bottom:0.25rem">WAVE ${S.wave} · ${survivalScore()} PTS · BEST ${S.best}</div>`;
    if (S.relics.length) {
      html += `<div style="font-size:0.6875rem;color:#b8943e;margin-bottom:0.5rem">${S.relics.map(r => r.icon + ' ' + r.name).join(' · ')}</div>`;
    }
  }

  // campaign progress dots
  html += '<div style="display:flex;gap:0.25rem;justify-content:center;margin-bottom:0.625rem">';
  for (let i = 0; i < (surv ? 0 : state.campaignTotal); i++) {
    const done = i < state.campaignNode;
    const cur = i === state.campaignNode;
    const ntype = state.CAMPAIGN_NODES[i]?.type;
    const icon = ntype === 'boss' ? '⭐' : ntype === 'event' ? '🎁' : '⚔';
    const bg = done ? 'rgba(126,168,121,0.2)' : cur ? 'rgba(196,90,60,0.2)' : 'rgba(30,26,22,0.5)';
    const border = done ? '#7ea879' : cur ? '#c45a3c' : '#333';
    html += `<div style="width:22px;height:22px;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);background:${bg};display:flex;align-items:center;justify-content:center;font-size:0.5625rem;color:${border}">${icon}</div>`;
  }
  html += '</div>';

  // player cards
  html += '<div style="display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap;margin-bottom:0.5rem">';
  state.players.forEach(p => {
    const hpPct = p.ghost ? 0 : Math.round(p.hp / p.maxHp * 100);
    const hCol = p.ghost ? '#888' : hpPct > 50 ? '#7ea879' : hpPct > 25 ? '#c49040' : '#c44040';
    const cd = p.hp > 0 ? (p.cdTimer > 0 ? `${p.ability}: ${p.cdTimer}` : `${p.ability} ✦`) : '';
    const item = p.item ? p.item.icon + ' ' + p.item.name : '—';
    const ups = p.upgrades?.length ? p.upgrades.join('') : '';
    html += `<div style="background:rgba(20,18,14,0.9);border:1px solid ${p.color}44;border-radius:4px;padding:0.375rem 0.625rem;min-width:6.875rem;text-align:center">
      <div style="color:${p.color};font-weight:700;font-size:0.8125rem">${_esc(p.name)}${p._dc ? ' (DC)' : p.isBot ? ' (AI)' : ''}</div>
      <div style="color:${hCol};font-size:0.6875rem">${p.ghost ? 'Ghost' : p.hp + '/' + p.maxHp}</div>
      <div style="height:3px;background:#0f0d0a;margin:0.1875rem 0;border-radius:2px"><div style="width:${hpPct}%;height:100%;background:${hCol};border-radius:2px"></div></div>
      <div style="font-size:0.5625rem;color:#6b8cae">${cd}</div>
      <div style="font-size:0.5625rem;color:#888">Item: ${item}</div>
      ${ups ? '<div style="font-size:0.5625rem;color:#b8943e;margin-top:0.125rem">' + ups + '</div>' : ''}
    </div>`;
  });
  html += '</div>';

  // enemy list
  if (aliveE > 0) {
    html += `<div style="font-size:0.625rem;color:#c45a3c;margin-bottom:0.25rem">${aliveE} enemies alive</div>`;
    html += '<div style="display:flex;gap:0.25rem;justify-content:center;flex-wrap:wrap;margin-bottom:0.375rem">';
    state.enemies.filter(e => e.hp > 0).forEach(e => {
      html += `<span style="background:rgba(40,20,15,0.8);border:1px solid ${e.color}44;border-radius:3px;padding:0.125rem 0.375rem;font-size:0.5625rem;color:${e.color}">${e.name} ${e.hp}/${e.maxHp}${e.isBoss ? ' ⭐' : ''}</span>`;
    });
    html += '</div>';
  }

  // resume button
  html += `<div style="margin-top:0.5rem"><button class="gbtn gbtn-go" style="padding:0.625em 2.5em;font-size:1rem;letter-spacing:0.125rem;animation:none" data-action="resume">RESUME</button></div>`;
  // controls
  html += `<div style="font-size:0.5625rem;color:#706a60;margin-top:0.5rem;line-height:1.6">WASD move · Space attack · F skill · G defend · 1 item · R ${surv ? 'restart run' : 'restart encounter'} · H help</div>`;
  // destructive actions
  html += `<div style="margin-top:0.375rem;display:flex;gap:0.5rem;justify-content:center">
    <button class="gbtn" style="padding:0.25em 0.875em;font-size:0.625rem" data-action="restart" data-confirm-text="Progress will be lost. Confirm?">${surv ? 'RESTART RUN' : 'NEW CAMPAIGN'}</button>
    <button class="gbtn" style="padding:0.25em 0.875em;font-size:0.625rem" data-action="quit" data-confirm-text="Leave run? Confirm?">QUIT TO LOBBY</button>
  </div>`;
  pi.innerHTML = html;
  pi.querySelector('[data-action="resume"]').addEventListener('click', () => {
    state.paused = false;
    document.getElementById('pause-overlay').classList.remove('show');
  });
  // destructive actions ask once before they go through
  pi.querySelectorAll('[data-confirm-text]').forEach(b => b.addEventListener('click', () => {
    if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = b.dataset.confirmText; b.style.color = '#c45a3c'; return; }
    if (b.dataset.action === 'restart') restartRun(); else quitToLobby();
  }));
}

// === On-Canvas HUD ===
export function drawCanvasHud(ts) {
  if (state.gamePhase !== 'game') return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // tick progress bar
  if (state.running && !state.gameOver && !state.paused) {
    const tickPct = Math.min(1, state.tickTimer / state.tickMs);
    const barCol = state.pendingInput ? '#7ea879' : tickPct > 0.85 ? '#b8943e' : '#c45a3c';
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, C.width, 3);
    ctx.fillStyle = barCol;
    ctx.fillRect(0, 0, C.width * tickPct, 3);
    if (tickPct > 0.85 && !state.pendingInput) {
      ctx.shadowColor = barCol;
      ctx.shadowBlur = 6;
      ctx.fillRect(0, 0, C.width * tickPct, 3);
      ctx.shadowBlur = 0;
    }
  }

  // msg
  if (state.msg && state.msgTimer > 0) {
    ctx.globalAlpha = Math.min(1, state.msgTimer / 300);
    ctx.font = `700 ${Math.round(22 * state.uiS)}px Rajdhani,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#c45a3c';
    ctx.fillText(state.msg, C.width / 2, Math.round(52 * state.uiS));
    ctx.globalAlpha = 1;
  }

  // player HP cards
  const cardW = Math.round(110 * state.uiS), cardH = Math.round(32 * state.uiS);
  const cardGap = Math.round(6 * state.uiS), cardY = C.height - cardH - Math.round(10 * state.uiS);
  const cFs = Math.round(10 * state.uiS), cFsB = Math.round(10 * state.uiS);
  const cPad = Math.round(6 * state.uiS), cBarH = Math.round(4 * state.uiS);
  ctx.globalAlpha = 0.75;

  state.players.forEach((p, i) => {
    const cx = Math.round(10 * state.uiS) + i * (cardW + cardGap), cy = cardY;
    ctx.fillStyle = 'rgba(6,6,16,0.8)';
    ctx.fillRect(cx, cy, cardW, cardH);
    ctx.strokeStyle = p.color + '88';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx, cy, cardW, cardH);
    ctx.fillStyle = p.color;
    ctx.fillRect(cx, cy, Math.round(2 * state.uiS), cardH);
    const tag = p._dc ? ' (DC)' : i === 0 && hostPlaying ? ' (YOU)' : p.isBot ? ' (AI)' : '';
    const status = p.ghost ? ' 👻' : '';
    ctx.fillStyle = p.color;
    ctx.font = `600 ${cFs}px Rajdhani,sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(p.name + tag + status, cx + cPad, cy + Math.round(3 * state.uiS));
    const hpPct = p.ghost ? 0 : Math.max(0, p.hp / p.maxHp);
    const hpCol = hpPct > 0.5 ? '#7ea879' : hpPct > 0.25 ? '#c49040' : '#c44040';
    const barY = cy + Math.round(16 * state.uiS);
    ctx.fillStyle = '#0f0d0a';
    ctx.fillRect(cx + cPad, barY, cardW - cPad * 2, cBarH);
    ctx.fillStyle = hpCol;
    ctx.fillRect(cx + cPad, barY, (cardW - cPad * 2) * hpPct, cBarH);
    ctx.fillStyle = hpCol;
    ctx.font = `${cFsB}px Rajdhani,sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(p.ghost ? 'Ghost' : p.hp + '/' + p.maxHp, cx + cPad, cy + Math.round(22 * state.uiS));
    const cdTxt = p.hp > 0 ? (p.cdTimer > 0 ? p.ability + ': ' + p.cdTimer : p.ability + ' ✦') : '';
    if (cdTxt) {
      ctx.fillStyle = p.cdTimer > 0 ? '#666' : '#6b8cae';
      ctx.textAlign = 'right';
      ctx.fillText(cdTxt, cx + cardW - cPad, cy + Math.round(22 * state.uiS));
    }
    if (p.defending) {
      ctx.fillStyle = '#6b8cae';
      ctx.textAlign = 'right';
      ctx.font = `${cFs}px Rajdhani,sans-serif`;
      ctx.fillText('🛡', cx + cardW - cPad, cy + Math.round(3 * state.uiS));
    }
    if (p.item) {
      ctx.textAlign = 'right';
      ctx.fillText(p.item.icon, cx + cardW - Math.round(18 * state.uiS), cy + Math.round(3 * state.uiS));
    }
  });
  ctx.globalAlpha = 1;

  // tutorial hints
  if (isTutorial && state.running && !state.gameOver) {
    const hint = TUT_HINTS[Math.min(tutStep, TUT_HINTS.length - 1)];
    ctx.save();
    ctx.globalAlpha = 0.85 + 0.1 * Math.sin(ts * 0.003);
    ctx.font = `700 ${Math.round(20 * state.uiS)}px Rajdhani,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText(hint, C.width / 2 + 1, C.height * 0.18 + 1);
    ctx.fillStyle = '#b8943e';
    ctx.fillText(hint, C.width / 2, C.height * 0.18);
    const subHints = ['', '', 'Cooldown: ' + state.players[0]?.cd + ' ticks', 'Halves next hit taken', ''];
    const sub = subHints[Math.min(tutStep, 4)];
    if (sub) {
      ctx.font = `500 ${Math.round(13 * state.uiS)}px Rajdhani,sans-serif`;
      ctx.fillStyle = '#8a7e6e';
      ctx.fillText(sub, C.width / 2, C.height * 0.18 + Math.round(24 * state.uiS));
    }
    ctx.restore();
  }

  // top HUD
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const aliveE2 = state.enemies.filter(e => e.hp > 0).length;
  const encSec = Math.floor(state.tickCount * state.tickMs / 1000);
  const encMin = Math.floor(encSec / 60);
  const encSecR = encSec % 60;
  const timeStr = encMin > 0 ? `${encMin}:${String(encSecR).padStart(2, '0')}` : `${encSecR}s`;
  const lastStandTxt = state.players.some(p => p.lastStand) ? ' ⚔ LAST STAND' : '';
  const diffLabel = ['Easy', 'Normal', 'Hard'][state.difficulty] || '';
  const diffCol = ['#7ea879', '#c49040', '#c45a3c'][state.difficulty] || '#888';
  const totalDmgDealt = Object.values(state.stats).reduce((s, st) => s + st.dmgDealt, 0);
  const biomeName = activeBiome ? activeBiome.name : '';
  const hudTop = Math.round(5 * state.uiS);

  // center: big encounter + foe count
  if (!BOARD && state.waveAnnounce.life <= 0) {
    const bigFs = Math.round(20 * state.uiS);
    ctx.font = `700 ${bigFs}px Rajdhani,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const centerTxt = `${biomeName} ${encLabel()}  —  ${aliveE2} foes${lastStandTxt}`;
    const centerW = ctx.measureText(centerTxt).width;
    const cx = C.width / 2;
    ctx.fillStyle = 'rgba(6,6,16,0.85)';
    ctx.fillRect(cx - centerW / 2 - Math.round(14 * state.uiS), hudTop, centerW + Math.round(28 * state.uiS), Math.round(28 * state.uiS));
    ctx.fillStyle = '#eee';
    ctx.fillText(centerTxt, cx, hudTop + Math.round(3 * state.uiS));
  }

  // left: small secondary stats
  const smFs = Math.round(12 * state.uiS);
  ctx.font = `600 ${smFs}px Rajdhani,sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const secLine = `${timeStr}  ·  ${totalDmgDealt} dmg`;
  const secW = ctx.measureText(secLine).width;
  ctx.fillStyle = 'rgba(6,6,16,0.8)';
  ctx.fillRect(0, hudTop, secW + Math.round(20 * state.uiS), Math.round(20 * state.uiS));
  ctx.fillStyle = diffCol;
  ctx.fillText(diffLabel, Math.round(8 * state.uiS), hudTop + Math.round(3 * state.uiS));
  const dlw = ctx.measureText(diffLabel + '  ').width;
  ctx.fillStyle = '#aaa';
  ctx.fillText(secLine, Math.round(8 * state.uiS) + dlw, hudTop + Math.round(3 * state.uiS));

  ctx.restore();
  ctx.restore();
}
