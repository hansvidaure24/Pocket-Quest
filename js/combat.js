// === Consumable Items ===

import { state } from './state.js';
import { audio } from './audio.js';
import { T_COVER, T_HAZARD, T_LAVA } from './data.js';
import {
  _enemyAt, _occMap, BOARD, gameMode, h2p, hDist, HEX, hNbrs, inGrid, inLane, isPassable, isWall, rk,
  terrainAt
} from './hex.js';
import { emit } from './hooks.js';
import { _esc } from './lobby.js';
import { triggerLunge, triggerSquash } from './render.js';
import {
  survivalEnemyDmgBonus, survivalNextStep, survivalOnEnemyKilled, survivalOnPlayerDown
} from './survival.js';
import {
  doShake, spawnAoe, spawnDeath, spawnDmg, spawnFlash, spawnProjectile, spawnTrail, stat
} from './vfx.js';

export const ITEMS = [
  {
    name: 'Bomb', desc: '2 dmg AoE to all enemies in 2 hex', icon: '💣',
    use(p) {
      state.entities.filter(e => e.isEnemy && e.hp > 0 && hDist(e, p) <= 2)
        .forEach(t => { spawnProjectile(p, t, '#c45050'); dealDamage(t, 2, p); });
      spawnAoe(p.q, p.r, '#c45050', HEX * 2.5);
      doShake(12);
      audio.explode();
      combatLog(p.name + ' used Bomb!', '#c45050');
    }
  },
  {
    name: 'Potion', desc: 'Full heal', icon: '🧪',
    use(p) {
      healEntity(p, p.maxHp, p);
      combatLog(p.name + ' used Potion!', '#7ea879');
    }
  },
  {
    name: 'Smoke', desc: 'All players dodge next hit', icon: '💨',
    use(p) {
      state.players.forEach(pl => { if (pl.hp > 0) pl.dodgeNext = true; });
      spawnAoe(p.q, p.r, '#aaaaaa', HEX * 3);
      combatLog(p.name + ' used Smoke! Party dodges next hit.', '#aaaaaa');
    }
  },
  {
    name: 'Shield Scroll', desc: '+1 max HP permanently', icon: '📜',
    use(p) {
      p.maxHp += 1;
      p.hp += 1;
      spawnDmg(p.q, p.r, '+1 MAX HP', '#b8943e');
      combatLog(p.name + ' used Shield Scroll! +1 max HP', '#b8943e');
    }
  },
  {
    name: 'Stun Trap', desc: 'Stuns all adjacent enemies 1 tick', icon: '⚡',
    use(p) {
      hNbrs(p.q, p.r).forEach(n => {
        const t = _enemyAt(n.q, n.r);
        if (t) applyStatus(t, 'stun', 1);
      });
      spawnAoe(p.q, p.r, '#c9a030');
      audio.stun();
      combatLog(p.name + ' used Stun Trap!', '#c9a030');
    }
  },
  {
    name: 'Frost Bomb', desc: 'Slows all enemies in 2 hex for 2 ticks', icon: '❄️',
    use(p) {
      state.entities.filter(e => e.isEnemy && e.hp > 0 && hDist(e, p) <= 2)
        .forEach(t => applyStatus(t, 'slow', 2));
      spawnAoe(p.q, p.r, '#5588aa', HEX * 2.5);
      combatLog(p.name + ' used Frost Bomb!', '#5588aa');
    }
  },
  {
    name: 'War Horn', desc: 'Stun all enemies for 1 tick', icon: '📯',
    use(p) {
      state.enemies.forEach(e => { if (e.hp > 0) applyStatus(e, 'stun', 1); });
      spawnAoe(p.q, p.r, '#c9a030', HEX * 4);
      doShake(10);
      audio.stun();
      combatLog(p.name + ' blew the War Horn!', '#c9a030');
    }
  },
  {
    name: 'Shield Bash', desc: 'Push all adjacent enemies 2 hex + stun 1 tick', icon: '🛡',
    use(p) {
      hNbrs(p.q, p.r).forEach(n => {
        const t = _enemyAt(n.q, n.r);
        if (t) {
          applyStatus(t, 'stun', 1);
          const dq = Math.sign(t.q - p.q), dr = Math.sign(t.r - p.r);
          for (let s = 0; s < 2; s++) {
            const nq = t.q + dq, nr = t.r + dr;
            if (inGrid(nq, nr) && !isWall(nq, nr) && isPassable(nq, nr, t)) {
              spawnTrail(t.q, t.r, t.color);
              t.q = nq;
              t.r = nr;
            } else break;
          }
        }
      });
      spawnAoe(p.q, p.r, '#607a90');
      doShake(8);
      combatLog(p.name + ' used Shield Bash!', '#607a90');
    }
  },
  {
    name: 'Tempo Shift', desc: '3 ticks at double speed', icon: '⏩',
    use(p) {
      state.originalTickMs = state.tickMs;
      state.tickMs = Math.floor(state.tickMs * 0.5);
      state.tempoTicks = 3;
      spawnAoe(p.q, p.r, '#b87acc', HEX * 4);
      doShake(6);
      audio.combo();
      showWaveAnnounce('TEMPO RUSH', '3 fast ticks', 1200);
      combatLog(p.name + ' used Tempo Shift! 3 fast ticks!', '#b87acc');
    }
  },
];

// === Status Effects ===
// Types: 'poison' (1 dmg/tick), 'stun' (skip action), 'slow' (can't move)
export function applyStatus(target, type, ticks) {
  if (target.ai === 'boss_golem') {
    spawnDmg(target.q, target.r, 'IMMUNE', '#8a8070');
    return;
  }
  if (!target.statuses) target.statuses = [];
  const existing = target.statuses.find(s => s.type === type);
  if (existing) {
    existing.ticks = Math.max(existing.ticks, ticks);
    return;
  }
  target.statuses.push({ type, ticks });
  const icons = { poison: '🟢 POISON', stun: '⚡ STUN', slow: '🔵 SLOW' };
  const colors = { poison: '#5a9a60', stun: '#c9a030', slow: '#5588aa' };
  spawnDmg(target.q, target.r, icons[type] || type, colors[type] || '#c9a030');
  combatLog(target.name + ' is ' + type + 'ed', colors[type] || '#c9a030');
  if (type === 'stun') audio.stun();
  if (type === 'poison') audio.poison();
}

export function tickStatuses(e) {
  if (!e.statuses) return;
  e.statuses = e.statuses.filter(s => {
    s.ticks--;
    if (s.type === 'poison' && e.hp > 0) {
      e.hp--;
      spawnDmg(e.q, e.r, '-1', '#5a9a60');
      if (e.hp <= 0) {
        e.hp = 0;
        spawnDeath(e.q, e.r, e.color, e.isBoss);
        if (!e.isEnemy) {
          e.ghost = true;
          state.enemies.forEach(en => {
            if (en.hp > 0) {
              en.maxHp = Math.max(1, en.maxHp - 1);
              en.hp = Math.min(en.hp, en.maxHp);
            }
          });
        } else {
          showMsg(e.name + ' defeated!');
          audio.death();
          tryDropLoot(e);
        }
      }
    }
    return s.ticks > 0;
  });
}

export function hasStatus(e, type) { return e.statuses && e.statuses.find(s => s.type === type); }
export function isStunned(e) {
  return hasStatus(e, 'stun');
}

export function isSlowed(e) {
  return hasStatus(e, 'slow');
}

// === Combo System ===
let comboTracker = {};
export let comboChain = 0;
export function resetComboChain() { comboChain = 0; }

function trackCombo(target, attacker) {
  const key = target.name + '@' + target.q + ',' + target.r;
  if (!comboTracker[key]) comboTracker[key] = { attackers: new Set(), target };
  comboTracker[key].attackers.add(attacker.name);
}

export function resolveCombo() {
  let hadCombo = false;
  for (const [key, data] of Object.entries(comboTracker)) {
    if (data.attackers.size >= 2 && data.target.hp > 0) {
      hadCombo = true;
      const bonus = data.attackers.size - 1 + Math.floor(comboChain / 3);
      dealDamage(data.target, bonus, null);
      const chainTxt = comboChain >= 3 ? ` (chain x${Math.floor(comboChain / 3) + 1})` : '';
      spawnDmg(data.target.q, data.target.r, `${data.attackers.size}x COMBO!${chainTxt}`, '#b8943e');
      audio.combo();
      combatLog(`${data.attackers.size}x combo on ${data.target.name}! +${bonus} bonus dmg${chainTxt}`, '#b8943e');
    }
  }
  if (hadCombo) comboChain++;
  else comboChain = 0;
  comboTracker = {};
}

// === Loot Drops ===
const LOOT_TABLE = [
  { name: 'Bomb',        icon: '💣', chance: 0.2  },
  { name: 'Potion',      icon: '🧪', chance: 0.18 },
  { name: 'Smoke',       icon: '💨', chance: 0.12 },
  { name: 'Poison Vial', icon: '🧫', chance: 0.12 },
  { name: 'War Horn',    icon: '📯', chance: 0.1  },
  { name: 'Shield Bash', icon: '🛡', chance: 0.1  },
  { name: 'Frost Bomb',  icon: '❄️', chance: 0.1  },
  { name: 'Tempo Shift', icon: '⏩', chance: 0.08 },
];

function tryDropLoot(enemy) {
  if (!enemy.isBoss && !enemy.isElite && Math.random() > 0.35) return;
  const roll = Math.random();
  let cumul = 0;
  for (const loot of LOOT_TABLE) {
    cumul += loot.chance;
    if (roll <= cumul) {
      const candidates = state.players
        .filter(p => p.hp > 0 && !p.item)
        .sort((a, b) => hDist(a, enemy) - hDist(b, enemy));
      if (candidates.length > 0) {
        const p = candidates[0];
        if (loot.name === 'Poison Vial') {
          p.item = {
            name: 'Poison Vial', desc: 'Poisons all adjacent enemies (3 ticks)', icon: '🧫',
            use(pl) {
              hNbrs(pl.q, pl.r).forEach(n => {
                const t = _enemyAt(n.q, n.r);
                if (t) applyStatus(t, 'poison', 3);
              });
              spawnAoe(pl.q, pl.r, '#5a9a60');
              combatLog(pl.name + ' used Poison Vial!', '#5a9a60');
            }
          };
        } else {
          p.item = ITEMS.find(i => i.name === loot.name);
        }
        if (p.item) {
          spawnDmg(enemy.q, enemy.r, loot.icon + ' LOOT', '#b8943e');
          audio.loot();
          combatLog(p.name + ' picked up ' + loot.icon + ' ' + loot.name, '#b8943e');
          spawnProjectile(enemy, p, '#b8943e', false);
          const { x: lx, y: ly } = h2p(enemy.q, enemy.r);
          for (let li = 0; li < 8; li++) {
            state.statusParticles.push({
              x: lx + (Math.random() - 0.5) * 14, y: ly,
              vx: (Math.random() - 0.5) * 0.8, vy: -1.2 - Math.random(),
              color: li % 2 ? '#b8943e' : '#e8c878',
              life: 700, maxLife: 700, size: 2 + Math.random(), star: true
            });
          }
        }
      }
      return;
    }
  }
}

// === Damage & Healing ===
export function dealDamage(target, dmg, attacker) {
  if (target.hp <= 0 && !target.ghost) return;
  if (gameMode === 'survival' && attacker && attacker.isEnemy && !target.isEnemy)
    dmg += survivalEnemyDmgBonus();

  // shieldbearer: immune from front
  if (target.ai === 'shieldbearer' && attacker && target.faceDQ != null) {
    const aq = attacker.q - target.q, ar = attacker.r - target.r;
    if (Math.sign(aq) === target.faceDQ && Math.sign(ar) === target.faceDR) {
      spawnDmg(target.q, target.r, 'BLOCKED', '#6688aa');
      return;
    }
  }

  // dodge (smoke / Shadow Cloak passive)
  if (!target.isEnemy && target.dodgeNext) {
    target.dodgeNext = false;
    spawnDmg(target.q, target.r, 'DODGE', '#aaaaaa');
    combatLog(target.name + ' dodged', '#aaa');
    return;
  }
  if (!target.isEnemy && (target.dodgeChance || 0) > 0 && Math.random() < Math.min(0.35, target.dodgeChance)) {
    spawnDmg(target.q, target.r, 'DODGE', '#aaaaaa');
    combatLog(target.name + ' shadow-dodged', '#aaa');
    return;
  }

  // defend halves damage
  if (!target.isEnemy && target.defending) {
    const before = dmg;
    dmg = Math.max(1, Math.floor(dmg / 2));
    target.defending = false;
    if (before > dmg) {
      spawnDmg(target.q, target.r, 'PARRY', '#607a90');
      combatLog(target.name + ' parried, blocked ' + (before - dmg) + ' dmg', '#607a90');
    }
  }

  // thorns: melee attackers take 1 dmg back
  if (attacker && attacker.isEnemy && !target.isEnemy && target.hp > 0
      && (target.classIdx === 0 || target.hasThorns) && hDist(attacker, target) <= 1) {
    if (attacker.hp > 0) {
      spawnDmg(attacker.q, attacker.r, 'THORNS', '#c45a3c');
      dealDamage(attacker, Math.max(1, target.thorns || 0), target);
    }
  }

  // enemy flanking: another enemy on opposite side = +1
  if (attacker && attacker.isEnemy && !target.isEnemy && target.hp > 0
      && attacker.ai !== 'swarm' && !attacker._charge) {
    if (state.enemies.find(e => e !== attacker && e.hp > 0 && hDist(e, target) <= 1 && hDist(e, attacker) >= 3)) {
      dmg++;
      spawnDmg(target.q, target.r, 'FLANKED', '#ff8800');
    }
  }

  // cover damage reduction
  const cov = terrainAt(target.q, target.r);
  if (cov && cov.type === T_COVER) {
    dmg = target.bulwark ? Math.max(0, dmg - 2) : Math.max(1, dmg - 1);
    spawnDmg(target.q, target.r, 'COVERED', '#2a6a4a');
    if (dmg <= 0) return;
  }

  target.hp -= dmg;

  // vampiric enemy heal
  if (attacker && attacker._vamp && attacker.hp > 0
      && attacker.hp < attacker.maxHp && !target.isEnemy) {
    attacker.hp++;
    spawnDmg(attacker.q, attacker.r, '+1', '#ff4488');
  }

  // enemy attack VFX
  if (attacker && attacker.isEnemy && attacker.hp > 0) {
    triggerLunge(attacker, target);
    const { x: ax, y: ay } = h2p(attacker.q, attacker.r);
    state.aoeEffects.push({ x: ax, y: ay, radius: HEX * 0.8, color: attacker.color, life: 250, maxLife: 250 });
  }

  combatLog(`${attacker ? attacker.name : 'Hazard'} → ${target.name} for ${dmg} dmg`, dmg >= 3 ? '#ff6666' : '#cc8888');
  spawnDmg(target.q, target.r, '-' + dmg, '#c45050');
  spawnFlash(target);
  doShake(3 + dmg * 2);

  if (!target.isEnemy) { stat(target.name, 'dmgTaken', dmg); state.encDmgTaken += dmg; }
  if (attacker && !attacker.isEnemy) stat(attacker.name, 'dmgDealt', dmg);

  if (dmg >= 3) {
    audio.crit();
    if (gameMode !== 'survival') state.hitStopTimer = 60;
  } else {
    audio.hit();
  }

  // --- Death handling ---
  if (target.hp <= 0) {
    const overkillAmt = -target.hp;
    target.hp = 0;
    if (overkillAmt > 0 && attacker && !attacker.isEnemy)
      stat(attacker.name, 'overkill', overkillAmt);
    spawnDeath(target.q, target.r, target.color, target.isBoss);

    if (target.isBoss) {
      state.slowMoTimer = 1500;
      state.slowMoFactor = 3;
      state.screenFlash = { color: '#b8943e', life: 600, maxLife: 600 };
      doShake(25);
      audio.bossDeath();
    }

    if (!target.isEnemy) {
      // player death → ghost
      target.ghost = true;
      target.killedBy = attacker ? attacker.name : 'Hazard';
      target.killedAtTick = state.tickCount;
      audio.death();
      state.screenFlash = { color: '#c45a3c', life: 400, maxLife: 400 };
      doShake(15);
      state.slowMoTimer = 600;
      state.slowMoFactor = 2.5;
      showWaveAnnounce('FALLEN', target.name + ' is down', 1500);
      combatLog(`${target.name} fell to ${attacker ? attacker.name : 'hazard'}!`, '#c45a3c');
      state.killFeed.push({
        killer: attacker ? attacker.name : 'Hazard', victim: target.name,
        kColor: attacker ? attacker.color : '#888', vColor: target.color,
        boss: false, t: 4000
      });
      if (!state.stats[target.name].diedAt) state.stats[target.name].diedAt = state.totalTicks + state.tickCount;
      if (gameMode === 'survival') survivalOnPlayerDown(target);
      else state.enemies.forEach(e => {
        if (e.hp > 0) {
          e.maxHp = Math.max(1, e.maxHp - 1);
          e.hp = Math.min(e.hp, e.maxHp);
        }
      });
    } else {
      // enemy death
      if (target.ai === 'splasher') {
        hNbrs(target.q, target.r).forEach(n => {
          const hit = _occMap.get(n.q + ',' + n.r);
          if (hit && hit.hp > 0 && !hit.isEnemy && !hit.ghost) dealDamage(hit, 1, target);
        });
        spawnAoe(target.q, target.r, '#b87a8a');
        doShake(14);
        audio.explode();
      }
      doShake(3 + Math.min(12, target.maxHp));

      const { x: skx, y: sky } = h2p(target.q, target.r);
      state.damageNumbers.push({ x: skx, y: sky - 8, text: '💀', color: '#888', life: 1500, maxLife: 1500 });
      const totalK = Object.values(state.stats).reduce((s, st) => s + st.kills, 0);
      if (totalK === 0 && attacker && !attacker.isEnemy)
        showWaveAnnounce('FIRST BLOOD', attacker.name, 1200);

      if (gameMode === 'survival') survivalOnEnemyKilled(target, attacker);
      else showMsg(target.name + ' defeated!');
      audio.death();
      state.killFeed.push({
        killer: attacker ? attacker.name : '???', victim: target.name,
        kColor: attacker ? attacker.color : '#888', vColor: target.color,
        boss: !!target.isBoss, t: 3000
      });
      tryDropLoot(target);

      // XP orb particles
      const { x: dx, y: dy } = h2p(target.q, target.r);
      const orbCount = target.isBoss ? 8 : 3;
      const nearP = attacker && !attacker.isEnemy && attacker.hp > 0
        ? attacker : state.players.find(p => p.hp > 0);
      const orbTarget = nearP ? h2p(nearP.q, nearP.r) : null;
      for (let oi = 0; oi < orbCount; oi++) {
        const ang = Math.random() * Math.PI * 2, spd = 1 + Math.random() * 2;
        state.statusParticles.push({
          x: dx + (Math.random() - 0.5) * 16, y: dy,
          vx: orbTarget ? ((orbTarget.x - dx) * 0.002 + Math.cos(ang) * spd * 0.3) : (Math.random() - 0.5) * 1.5,
          vy: orbTarget ? ((orbTarget.y - dy) * 0.002 + Math.sin(ang) * spd * 0.3) : (-1.5 - Math.random()),
          color: '#b8943e', life: 700, maxLife: 700, size: 3, star: true
        });
      }

      // XP gain
      const xpGain = target.isBoss ? 5 : 1;
      state.partyXP += xpGain;
      spawnDmg(target.q, target.r, '+' + xpGain + ' XP', '#b8943e');
      if (state.partyXP >= state.xpToNext) {
        state.partyXP -= state.xpToNext;
        state.partyLevel++;
        state.xpToNext = Math.floor(state.xpToNext * 1.5);
        state.players.forEach(p => {
          if (p.hp > 0) {
            p.maxHp++;
            p.hp++;
            spawnDmg(p.q, p.r, 'LEVEL UP!', '#b8943e');
          } else if (gameMode === 'survival' && p.ghost) {
            p.maxHp++;
          }
        });
        audio.levelup();
        combatLog(`Party leveled up to ${state.partyLevel}`, '#b8943e');
        showWaveAnnounce('LEVEL UP', 'party lv' + state.partyLevel + ' — +1 max HP', 1500);
        state.screenFlash = { color: '#b8943e', life: 300, maxLife: 300 };
        doShake(6);
      }

      // kill credit + streaks
      if (attacker && !attacker.isEnemy) {
        stat(attacker.name, 'kills', 1);
        if (attacker.vampiric && attacker.hp > 0 && attacker.hp < attacker.maxHp) {
          const vh = rk(attacker.vampiric);
          attacker.hp = Math.min(attacker.maxHp, attacker.hp + vh);
          spawnDmg(attacker.q, attacker.r, '+' + vh + ' VAMP', '#ff4488');
        }
        if (attacker.adrenaline && attacker.cdTimer > 0) {
          attacker.cdTimer = 1;
          spawnDmg(attacker.q, attacker.r, 'ADRENALINE!', '#ff8800');
        }
        if (state.tickCount - state.lastKillTick <= 1) {
          state.killStreak++;
          if (state.killStreak >= 2) {
            const labels = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'MULTI KILL', 'MEGA KILL'];
            spawnDmg(target.q, target.r, labels[Math.min(state.killStreak, 5)] || 'RAMPAGE', '#b8943e');
            audio.combo();
            doShake(4 + state.killStreak * 3);
            state.screenFlash = {
              color: state.killStreak >= 4 ? '#ff8833' : '#b8943e',
              life: 150 + state.killStreak * 50, maxLife: 150 + state.killStreak * 50
            };
            if (state.killStreak >= 3) {
              const { x: kx, y: ky } = h2p(target.q, target.r);
              for (let ki = 0; ki < state.killStreak * 3; ki++) {
                state.statusParticles.push({
                  x: kx, y: ky,
                  vx: (Math.random() - 0.5) * 3, vy: -2 - Math.random() * 2,
                  color: ki % 2 ? '#e8c878' : '#ff8833',
                  life: 800, maxLife: 800, size: 2 + Math.random() * 2, star: true
                });
              }
            }
          }
        } else {
          state.killStreak = 1;
        }
        state.lastKillTick = state.tickCount;
      }
    }
  }
}

export function healEntity(target, amt, healer) {
  const old = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + amt);
  const h = target.hp - old;
  if (h > 0) {
    spawnDmg(target.q, target.r, '+' + h, '#7ea879');
    audio.heal();
    if (healer) stat(healer.name, 'heals', h);
    target._healT = performance.now();
    const { x, y } = h2p(target.q, target.r);
    for (let i = 0; i < 10; i++) {
      state.statusParticles.push({
        x: x + (Math.random() - 0.5) * 20, y: y + 10 + Math.random() * 8,
        vx: (Math.random() - 0.5) * 0.4, vy: -1.0 - Math.random() * 0.8,
        color: i % 3 === 0 ? '#aaffaa' : '#7ea879',
        life: 600, maxLife: 600, size: 1.5 + Math.random() * 1.5
      });
    }
    spawnAoe(target.q, target.r, '#7ea879', HEX * 0.8);
  }
}

export function showMsg(text, dur) {
  emit('fx', 'showMsg', text, dur);
  state.msg = text; state.msgTimer = dur || 2000;
}
export function showWaveAnnounce(text, sub, dur) {
  emit('fx', 'showWaveAnnounce', text, sub, dur);
  state.waveAnnounce = { text, sub: sub || '', life: dur || 2500, maxLife: dur || 2500 };
}

export function combatLog(text, color) {
  emit('fx', 'combatLog', text, color);
  state.combatLogLines.push({ tick: state.tickCount, text, color: color || '#888' });
  if (state.combatLogLines.length > 40) state.combatLogLines.shift();
  const el = document.getElementById('combat-log');
  if (el._lastLen === state.combatLogLines.length - 1 && state.combatLogLines.length <= 40) {
    const l = state.combatLogLines[state.combatLogLines.length - 1];
    if (el._lastTick !== l.tick) {
      const d = document.createElement('div');
      d.style.cssText = 'color:#444;font-size:0.5rem;margin-top:0.1875rem;border-top:1px solid rgba(140,120,80,0.1);padding-top:0.125rem';
      d.textContent = 'T' + l.tick;
      el.appendChild(d);
    }
    const d = document.createElement('div');
    d.style.cssText = `color:${l.color};padding-left:0.375rem`;
    d.textContent = l.text;
    el.appendChild(d);
    el._lastTick = l.tick;
    el._lastLen = state.combatLogLines.length;
  } else {
    let html = '', lastTick = -1;
    state.combatLogLines.forEach(l => {
      if (l.tick !== lastTick) {
        lastTick = l.tick;
        html += `<div style="color:#444;font-size:0.5rem;margin-top:0.1875rem;border-top:1px solid rgba(140,120,80,0.1);padding-top:0.125rem">T${l.tick}</div>`;
      }
      html += `<div style="color:${l.color};padding-left:0.375rem">${_esc(l.text)}</div>`;
    });
    el.innerHTML = html;
    el._lastTick = lastTick;
    el._lastLen = state.combatLogLines.length;
  }
  el.scrollTop = el.scrollHeight;
}

// === Movement ===
export function moveToward(e, target) {
  if (isSlowed(e) && state.tickCount % 2 === 0) return;
  const nbrs = hNbrs(e.q, e.r);
  let best = null, bd = hDist(e, target);
  let sidestep = null, sd = Infinity;
  if (BOARD) {
    best = survivalNextStep(e, target);
  } else {
    nbrs.forEach(n => {
      if (!isPassable(n.q, n.r, e)) return;
      const t = terrainAt(n.q, n.r);
      const penalty = (t && (t.type === T_HAZARD || t.type === T_LAVA))
        ? (t.type === T_LAVA ? 2 : 0.5) : 0;
      const d = hDist(n, target) + penalty;
      if (d < bd) { bd = d; best = n; }
      else if (!best && d <= sd) { sd = d; sidestep = n; }
    });
  }
  if (!best) best = sidestep;
  if (best) {
    spawnTrail(e.q, e.r, e.color);
    e.faceDQ = best.q - e.q;
    e.faceDR = best.r - e.r;
    e.q = best.q;
    e.r = best.r;
    if (!e.isEnemy) stat(e.name, 'moved', 1);
    const t = terrainAt(e.q, e.r);
    if (t && t.type === T_HAZARD && e.hp > 0) dealDamage(e, 1, null);
    if (t && t.type === T_LAVA && e.hp > 0) { dealDamage(e, 2, null); applyStatus(e, 'poison', 1); }
  }
}

export function moveAway(e, target) {
  if (isSlowed(e) && state.tickCount % 2 === 0) return;
  const nbrs = hNbrs(e.q, e.r);
  let best = null, bd = hDist(e, target);
  nbrs.forEach(n => {
    if (!isPassable(n.q, n.r, e)) return;
    const t = terrainAt(n.q, n.r);
    const penalty = (t && (t.type === T_HAZARD || t.type === T_LAVA)) ? 2 : 0;
    const d = hDist(n, target) - penalty;
    if (d > bd) { bd = d; best = n; }
  });
  if (best) {
    spawnTrail(e.q, e.r, e.color);
    e.q = best.q;
    e.r = best.r;
  }
}

export function nearestEnemy(from) {
  let b = null, d = 99;
  state.enemies.forEach(e => {
    if (e.hp > 0) { const dd = hDist(from, e); if (dd < d) { d = dd; b = e; } }
  });
  return b;
}

export function nearestAlive(from) {
  let b = null, d = 99;
  if (state.difficulty >= 2) {
    let lowestHp = Infinity;
    state.players.forEach(p => {
      if (p.hp > 0 && hDist(from, p) <= 4 && p.hp < lowestHp) {
        lowestHp = p.hp;
        d = hDist(from, p);
        b = p;
      }
    });
    if (b) return b;
  }
  d = 99;
  state.players.forEach(p => {
    if (p.hp > 0) { const dd = hDist(from, p); if (dd < d) { d = dd; b = p; } }
  });
  return b;
}

// === Player Actions ===
export function doAttack(p) {
  const atkRange = p.classIdx === 1 ? 2 : 1;
  const adj = [];
  if (atkRange > 1) {
    state.entities.filter(e => e.isEnemy && e.hp > 0 && hDist(e, p) <= atkRange)
      .forEach(e => adj.push(e));
  } else {
    hNbrs(p.q, p.r).forEach(n => {
      const e = _enemyAt(n.q, n.r);
      if (e) adj.push(e);
    });
  }
  if (!adj.length) return false;

  // pick target by facing direction
  let t = adj[0];
  if (adj.length > 1 && p.faceDQ != null && (p.faceDQ || p.faceDR)) {
    t = adj.reduce((best, e) => {
      const dot = (e.q - p.q) * p.faceDQ + (e.r - p.r) * p.faceDR;
      const bd = (best.q - p.q) * p.faceDQ + (best.r - p.r) * p.faceDR;
      return dot > bd ? e : best;
    });
  }

  let dmg = 1 + (p.dmgBonus || 0) + (p.syncBonus || 0);
  if (state.players.find(a => a !== p && a.hp > 0 && hDist(a, t) <= 1 && hDist(a, p) >= 3)) dmg++;
  const ghostBonus = state.players.filter(a => a.ghost && hDist(a, p) <= 1).length;
  dmg += ghostBonus;
  if (ghostBonus) spawnDmg(p.q, p.r, '+' + ghostBonus + ' GHOST', '#b87acc');
  if (p.lastStand) dmg++;
  if (p.berserk && p.hp <= Math.ceil(p.maxHp * 0.5)) dmg += rk(p.berserk);

  // rogue backstab
  if (p.classIdx === 2 && t.faceDQ != null) {
    const behindQ = t.q - t.faceDQ, behindR = t.r - t.faceDR;
    if (p.q === behindQ && p.r === behindR) {
      dmg++;
      spawnDmg(t.q, t.r, 'BACKSTAB!', '#7ea879');
    }
  }

  // crit
  const critChance = 0.15 + (p.critBonus || 0);
  const crit = Math.random() < critChance;
  if (crit) {
    dmg++;
    spawnDmg(t.q, t.r, 'CRIT!', '#ff6600');
    audio.crit();
    state.screenFlash = { color: '#ffffff', life: 80, maxLife: 80 };
  }

  triggerLunge(p, t);
  spawnProjectile(p, t, p.color);
  dealDamage(t, dmg, p);
  trackCombo(t, p);

  if (p.doubleStrike && Math.random() < p.doubleStrike && t.hp > 0) {
    dealDamage(t, 1 + (p.dmgBonus || 0), p);
    spawnDmg(t.q, t.r, 'DOUBLE!', '#7ea879');
  }
  if (p.poisonBlade && t.hp > 0) applyStatus(t, 'poison', rk(p.poisonBlade));
  if (p.pierce) {
    const bq = t.q + (t.q - p.q), br = t.r + (t.r - p.r);
    const t2 = _enemyAt(bq, br);
    if (t2) {
      spawnDmg(t2.q, t2.r, 'PIERCE', '#b8943e');
      dealDamage(t2, rk(p.pierce), p);
    }
  }
  return true;
}

export function doSkill(p) {
  if (p.cdTimer > 0) return false;
  p.cdTimer = Math.max(1, p.cd - (p.cdBonus || 0));
  audio.skill();
  const ci = p.classIdx;
  const ghostBonus = state.players.filter(a => a.ghost && hDist(a, p) <= 1).length;
  if (ghostBonus) spawnDmg(p.q, p.r, '+' + ghostBonus + ' GHOST', '#b87acc');
  const lsBonus = (p.lastStand ? 1 : 0)
    + (p.dmgBonus || 0)
    + (p.berserk && p.hp <= Math.ceil(p.maxHp * 0.5) ? rk(p.berserk) : 0)
    + ghostBonus + (p.syncBonus || 0);

  if (ci === 0) {
    // Warrior: Cleave — hit all adjacent + knockback
    const cleaveHits = [];
    hNbrs(p.q, p.r).forEach(n => {
      const t = _enemyAt(n.q, n.r);
      if (t) {
        spawnProjectile(p, t, '#c45a3c');
        dealDamage(t, 1 + lsBonus, p);
        cleaveHits.push(t);
      }
    });
    cleaveHits.forEach(t => {
      if (t.hp > 0) {
        const dq = Math.sign(t.q - p.q), dr = Math.sign(t.r - p.r);
        const nq = t.q + dq, nr = t.r + dr;
        if (inGrid(nq, nr) && !isWall(nq, nr) && isPassable(nq, nr, t)) {
          spawnTrail(t.q, t.r, t.color);
          t.q = nq;
          t.r = nr;
        }
      }
    });
    const { x: cx, y: cy } = h2p(p.q, p.r);
    for (let ai = 0; ai < 8; ai++) {
      const a = Math.PI * 2 * ai / 8;
      state.statusParticles.push({
        x: cx + Math.cos(a) * HEX * 0.8, y: cy + Math.sin(a) * HEX * 0.8,
        vx: Math.cos(a) * 1.5, vy: Math.sin(a) * 1.5,
        color: '#c45a3c', life: 250, maxLife: 250, size: 2.5
      });
    }
    triggerSquash(p);
    spawnDmg(p.q, p.r, cleaveHits.length ? `CLEAVE x${cleaveHits.length}` : 'CLEAVE', '#c45a3c');
    spawnAoe(p.q, p.r, '#c45a3c');
    doShake(4 + cleaveHits.length * 3);

  } else if (ci === 1) {
    // Mage: Fireball — aim 3 hexes in facing direction, 1-hex blast
    const ne = nearestEnemy(p);
    let dq = p.faceDQ, dr = p.faceDR;
    if ((!dq && !dr) && ne) { dq = Math.sign(ne.q - p.q) || 0; dr = Math.sign(ne.r - p.r) || 0; }
    if (!dq && !dr) { dq = 1; dr = 0; }
    let lq = p.q, lr = p.r;
    for (let s = 0; s < 3; s++) {
      const nq = lq + dq, nr = lr + dr;
      if (!inGrid(nq, nr) || isWall(nq, nr)) break;
      lq = nq;
      lr = nr;
    }
    const fbHits = [];
    state.entities.filter(e => e.isEnemy && e.hp > 0 && hDist(e, { q: lq, r: lr }) <= 1)
      .forEach(t => {
        spawnProjectile(p, t, '#6b8cae');
        dealDamage(t, 1 + lsBonus, p);
        if (t.hp > 0) applyStatus(t, 'poison', 1);
        fbHits.push(t);
      });
    triggerSquash(p);
    spawnDmg(lq, lr, fbHits.length ? `FIREBALL x${fbHits.length}` : 'FIREBALL', '#6b8cae');
    spawnAoe(lq, lr, '#6b8cae', HEX * 1.5);
    doShake(6 + fbHits.length * 3);
    const { x: sx, y: sy } = h2p(lq, lr);
    for (let si = 0; si < 6; si++) {
      const sa = Math.random() * Math.PI * 2, sd = Math.random() * HEX * 1.2;
      state.statusParticles.push({
        x: sx + Math.cos(sa) * sd, y: sy + Math.sin(sa) * sd,
        vx: 0, vy: -0.2, color: '#553388', life: 800, maxLife: 800, size: 3
      });
    }

  } else if (ci === 2) {
    // Rogue: Dash — 3 hexes in facing direction
    const ne = nearestEnemy(p);
    const hasFacing = p.faceDQ != null && (p.faceDQ || p.faceDR);
    const useFacing = !p.isBot && hasFacing;
    if (ne || useFacing) {
      const dq = useFacing ? p.faceDQ : Math.sign(ne.q - p.q);
      const dr = useFacing ? p.faceDR : Math.sign(ne.r - p.r);
      for (let s = 0; s < 3; s++) {
        const nq = p.q + dq, nr = p.r + dr;
        if (!inGrid(nq, nr) || isWall(nq, nr) || inLane(nq, nr)) break;
        const blocked = state.players.find(a => a !== p && a.q === nq && a.r === nr && (a.hp > 0 || a.ghost));
        if (blocked) break;
        spawnTrail(p.q, p.r, '#7ea879');
        const { x: tx, y: ty } = h2p(p.q, p.r);
        for (let di = 0; di < 3; di++) {
          state.statusParticles.push({
            x: tx + (Math.random() - 0.5) * 12, y: ty,
            vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
            color: '#7ea879', life: 350, maxLife: 350, size: 2
          });
        }
        const hit = _enemyAt(nq, nr);
        // afterimage
        const { x: aix, y: aiy } = h2p(p.q, p.r);
        for (let ai = 0; ai < 4; ai++) {
          state.statusParticles.push({
            x: aix + (Math.random() - 0.5) * 8, y: aiy + (Math.random() - 0.5) * 8,
            vx: 0, vy: 0, color: p.color, life: 400, maxLife: 400, size: HEX * 0.15
          });
        }
        p.q = nq;
        p.r = nr;
        stat(p.name, 'moved', 1);
        if (hit) { dealDamage(hit, 2 + lsBonus, p); doShake(8); break; }
      }
    }
    spawnDmg(p.q, p.r, 'DASH', '#7ea879');

  } else if (ci === 3) {
    // Cleric: Revive ghost, or heal lowest adjacent ally
    const ghost = hNbrs(p.q, p.r)
      .map(n => state.players.find(a => a.q === n.q && a.r === n.r && a.ghost))
      .find(Boolean);
    if (ghost) {
      ghost.ghost = false;
      ghost.hp = Math.max(1, Math.floor(ghost.maxHp * 0.25));
      spawnDmg(ghost.q, ghost.r, 'REVIVED!', '#c9973e');
      spawnAoe(ghost.q, ghost.r, '#c9973e', HEX * 1.5);
      spawnAoe(ghost.q, ghost.r, '#ffffff', HEX * 2);
      const { x: rx, y: ry } = h2p(ghost.q, ghost.r);
      for (let ri = 0; ri < 10; ri++) {
        const ra = Math.PI * 2 * ri / 10;
        state.statusParticles.push({
          x: rx, y: ry,
          vx: Math.cos(ra) * 2, vy: Math.sin(ra) * 2 - 0.5,
          color: '#c9973e', life: 600, maxLife: 600, size: 3, star: true
        });
      }
      state.screenFlash = { color: '#c9973e', life: 300, maxLife: 300 };
      doShake(8);
      showWaveAnnounce('REVIVED', ghost.name + ' returns', 1500);
      audio.levelup();
      combatLog(`${p.name} revived ${ghost.name}`, '#c9973e');
    } else {
      let ht = null, low = 99;
      hNbrs(p.q, p.r).forEach(n => {
        const a = state.players.find(a => a.q === n.q && a.r === n.r && a.hp > 0 && a.hp < a.maxHp);
        if (a && a.hp < low) { low = a.hp; ht = a; }
      });
      if (ht) healEntity(ht, 2, p);
      else healEntity(p, 2, p);
    }
    spawnDmg(p.q, p.r, 'HEAL', '#c9973e');
  }
  return true;
}

export function doDefend(p) {
  p.defending = true;
  spawnDmg(p.q, p.r, 'DEFEND', '#607a90');
  combatLog(p.name + ' defends! Half dmg next hit.', '#607a90');
  stat(p.name, 'defends', 1);
  audio.defend();
}

export function useItem(p) {
  if (!p.item) return false;
  audio.useItem();
  const itemCol = {
    '💣': '#c45050', '🧪': '#7ea879', '💨': '#aaaaaa', '📜': '#b8943e',
    '⚡': '#c9a030', '❄️': '#5588aa', '📯': '#c9a030', '🛡': '#607a90', '🧫': '#5a9a60'
  }[p.item.icon] || '#b8943e';
  state.screenFlash = { color: itemCol, life: 200, maxLife: 200 };
  p.item.use(p);
  p.item = null;
  return true;
}

export function doMove(p, dq, dr) {
  p.faceDQ = dq;
  p.faceDR = dr;
  const steps = (p.classIdx === 2 || p.fleet) ? 2 : 1;
  for (let s = 0; s < steps; s++) {
    const nq = p.q + dq, nr = p.r + dr;
    if (isPassable(nq, nr, p)) {
      spawnTrail(p.q, p.r, p.color);
      if (steps >= 2) {
        const { x: ax, y: ay } = h2p(p.q, p.r);
        for (let ai = 0; ai < 2; ai++) {
          state.statusParticles.push({
            x: ax + (Math.random() - 0.5) * 8, y: ay,
            vx: (Math.random() - 0.5) * 0.5, vy: -0.3,
            color: p.color, life: 300, maxLife: 300, size: 1.5
          });
        }
      }
      p.q = nq;
      p.r = nr;
      stat(p.name, 'moved', 1);
    } else break;
  }
  const t = terrainAt(p.q, p.r);
  if (t && t.type === T_HAZARD && p.hp > 0) {
    dealDamage(p, 1, null);
    spawnDmg(p.q, p.r, 'HAZARD', '#8b2020');
  }
  if (t && t.type === T_LAVA && p.hp > 0) {
    dealDamage(p, 2, null);
    applyStatus(p, 'poison', 1);
    spawnDmg(p.q, p.r, 'LAVA!', '#a35530');
    spawnAoe(p.q, p.r, '#ff4400', HEX * 0.6);
  }
  if (t && t.type === T_COVER && p.hp > 0) {
    const { x: cx, y: cy } = h2p(p.q, p.r);
    for (let i = 0; i < 3; i++) {
      state.statusParticles.push({
        x: cx + (Math.random() - 0.5) * 12, y: cy,
        vx: 0, vy: -0.4, color: '#2a6a4a', life: 300, maxLife: 300, size: 1.5
      });
    }
  }
}
