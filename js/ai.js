// === Bot AI ===
// bossPhase enum: 1 = default, 2 = enraged (50% HP), 3 = fury (25% HP)

import { state } from './state.js';
import { audio } from './audio.js';
import {
  applyStatus, combatLog, dealDamage, doAttack, doDefend, doSkill, healEntity, isStunned, moveAway,
  moveToward, nearestAlive, nearestEnemy, showWaveAnnounce, useItem
} from './combat.js';
import { T_HAZARD, T_LAVA } from './data.js';
import {
  _enemyAt, _occMap, _terrainMapRebuild, boardHexes, gameMode, h2p, hDist, HEX, hexRound, hNbrs, inGrid,
  isPassable, terrainAt
} from './hex.js';
import { canSummon } from './survival.js';
import { doShake, spawnAoe, spawnDmg, spawnProjectile, spawnTrail } from './vfx.js';

export function botDecide(p) {
  if (p.hp <= 0 && p.ghost) {
    const a = nearestAlive(p);
    if (a && hDist(p, a) > 1) moveToward(p, a);
    return;
  }
  if (p.hp <= 0) return;
  const ne = nearestEnemy(p);
  if (!ne) return;
  const dist = hDist(p, ne);

  // defend when low HP and enemies adjacent
  if (p.hp <= Math.ceil(p.maxHp * 0.25) && dist <= 1 && !p.defending && p.classIdx !== 3) {
    doDefend(p);
    return;
  }

  // bot item usage
  if (p.item && p.hp > 0) {
    if (p.item.name === 'Potion' && p.hp <= p.maxHp * 0.4) { useItem(p); return; }
    if (p.item.name === 'Bomb' && state.enemies.filter(e => e.hp > 0 && hDist(e, p) <= 2).length >= 3) { useItem(p); return; }
    if (p.item.name === 'Shield Scroll' && dist <= 2) { useItem(p); return; }
    if (p.item.name === 'Stun Trap' && hNbrs(p.q, p.r).filter(n => _enemyAt(n.q, n.r)).length >= 2) { useItem(p); return; }
    if (p.item.name === 'Frost Bomb' && state.enemies.filter(e => e.hp > 0 && hDist(e, p) <= 2).length >= 2) { useItem(p); return; }
    if (p.item.name === 'Poison Vial' && hNbrs(p.q, p.r).filter(n => _enemyAt(n.q, n.r)).length >= 2) { useItem(p); return; }
    if (p.item.name === 'Smoke' && state.players.filter(pl => pl.hp > 0 && pl.hp <= 2).length >= 2) { useItem(p); return; }
    if (p.item.name === 'War Horn' && state.enemies.filter(e => e.hp > 0).length >= 3) { useItem(p); return; }
    if (p.item.name === 'Shield Bash' && hNbrs(p.q, p.r).filter(n => _enemyAt(n.q, n.r)).length >= 2) { useItem(p); return; }
    if (p.classIdx === 3 && p.item.name === 'Potion') {
      const crit = state.players.find(a => a !== p && a.hp > 0 && a.hp <= 2 && hDist(p, a) <= 2);
      if (crit) { useItem(p); return; }
    }
  }

  // Cleric: revive priority, then heal
  if (p.classIdx === 3) {
    const ghost = state.players.find(a => a.ghost && hDist(p, a) <= 2);
    if (ghost && p.cdTimer <= 0) {
      if (hDist(p, ghost) <= 1) { doSkill(p); return; }
      moveToward(p, ghost);
      return;
    }
    const hurt = state.players.find(a => a !== p && a.hp > 0 && a.hp <= a.maxHp * 0.6);
    if (hurt && p.cdTimer <= 0) {
      if (hDist(p, hurt) <= 1) { doSkill(p); return; }
      moveToward(p, hurt);
      return;
    }
    if (hurt && p.cdTimer > 0 && hDist(p, hurt) > 1) { moveToward(p, hurt); return; }
    if (p.hp <= p.maxHp * 0.4 && p.cdTimer <= 0) { doSkill(p); return; }
  }

  // Mage: kite at range 3, fireball lands 3 hexes out with 1-hex blast
  if (p.classIdx === 1) {
    if (dist <= 3 && p.cdTimer <= 0) {
      p.faceDQ = Math.sign(ne.q - p.q) || 0;
      p.faceDR = Math.sign(ne.r - p.r) || 0;
      doSkill(p);
      return;
    }
    if (dist <= 1) { moveAway(p, ne); return; }
    if (dist > 3) { moveToward(p, ne); return; }
    if (dist <= 2) { doAttack(p); return; }
    if (!p.defending) { doDefend(p); return; }
    return;
  }

  // Rogue: dash or melee
  if (p.classIdx === 2) {
    if (p.cdTimer <= 0 && dist <= 4) { doSkill(p); return; }
    if (dist <= 1) { doAttack(p); return; }
    moveToward(p, ne);
    return;
  }

  // Warrior: cleave groups or attack
  if (dist <= 1 && p.cdTimer <= 0) {
    const adj = hNbrs(p.q, p.r).filter(n => _enemyAt(n.q, n.r));
    if (adj.length >= 2) { doSkill(p); return; }
  }
  if (dist <= 1) { doAttack(p); return; }
  moveToward(p, ne);
}

// === Enemy AI ===
export function enemyAI(e) {
  if (e.hp <= 0) return;
  if (isStunned(e)) {
    e.charging = false;
    spawnDmg(e.q, e.r, 'STUNNED', '#c9a030');
    return;
  }
  const target = nearestAlive(e);
  if (!target) return;
  const dist = hDist(e, target);

  // face target
  if (dist > 0) {
    e.faceDQ = Math.sign(target.q - e.q) || 0;
    e.faceDR = Math.sign(target.r - e.r) || 0;
  }
  if (e._lastTarget && e._lastTarget !== target && e._lastTarget.hp > 0) {
    spawnDmg(e.q, e.r, '❗', '#c49040');
  }
  e._lastTarget = target;
  e.telegraph = false;
  e.telegraphTarget = null;

  // enrage: last non-boss enemy alive gets extra move
  const aliveEnemies = state.enemies.filter(en => en.hp > 0);
  e.enraged = aliveEnemies.length === 1 && !e.isBoss && state.enemies.length > 1;
  if (e.enraged && !e._enrageAnnounced) {
    e._enrageAnnounced = true;
    spawnDmg(e.q, e.r, 'ENRAGED', '#c45050');
    combatLog(e.name + ' is enraged', '#c45050');
  }

  // --- AI type dispatch ---

  // Swarm: walk straight at hero and bite
  if (e.ai === 'swarm' || e._charge) {
    if (hDist(e, target) > 1) {
      if (hDist(e, target) > 2) e._wind = false;
      moveToward(e, target);
    }
    if (hDist(e, target) <= 1) {
      if (!e._wind) {
        e._wind = true;
        e.telegraph = true;
        e.telegraphTarget = target;
      } else {
        e._wind = false;
        dealDamage(target, e.dmg || 1, e);
      }
    }
    return;
  }

  // Charger: telegraph → charge 2 hexes + hit
  if (e.ai === 'charger') {
    if (!e.charging) {
      e.telegraph = true;
      e.telegraphTarget = target;
      e.charging = true;
    } else {
      e.charging = false;
      const preQ = e.q, preR = e.r;
      for (let i = 0; i < 2; i++) {
        const bq = e.q, br = e.r;
        moveToward(e, target);
        if (e.q !== bq || e.r !== br) {
          const { x: sx, y: sy } = h2p(bq, br);
          for (let d = 0; d < 3; d++) {
            state.statusParticles.push({
              x: sx + (Math.random() - 0.5) * 12, y: sy + (Math.random() - 0.5) * 8,
              vx: (Math.random() - 0.5) * 1, vy: 0.3 + Math.random() * 0.5,
              color: '#aa7744', life: 350, maxLife: 350, size: 2
            });
          }
        }
      }
      if (e.q !== preQ || e.r !== preR) doShake(4);
      if (hDist(e, target) <= 1) {
        spawnProjectile(e, target, e.color);
        dealDamage(target, 2 + state.difficulty, e);
      }
    }
    return;
  }

  // Glass Cannon: ranged, flees melee
  if (e.ai === 'glasscannon') {
    e.shootTimer = (e.shootTimer || 0) + 1;
    if (dist <= 1) {
      moveAway(e, target);
    } else if (dist <= 2 && e.shootTimer >= 2) {
      e.shootTimer = 0;
      spawnProjectile(e, target, '#a38530', true);
      dealDamage(target, 3 + state.difficulty, e);
    } else if (dist <= 2) {
      e.telegraph = true;
      e.telegraphTarget = target;
    } else {
      moveToward(e, target);
    }
    return;
  }

  // Splasher: moves toward player centroid, explodes on death
  if (e.ai === 'splasher') {
    let cx = 0, cy = 0, n = 0;
    state.players.forEach(p => { if (p.hp > 0) { cx += p.q; cy += p.r; n++; } });
    if (n) moveToward(e, hexRound(cx / n, cy / n));
    const inRange = gameMode === 'survival' ? hDist(e, target) <= 1 : dist <= 1;
    if (inRange) {
      if (gameMode === 'survival' && !e._wind) {
        e._wind = true;
        e.telegraph = true;
        e.telegraphTarget = target;
      } else {
        e._wind = false;
        dealDamage(target, 1, e);
      }
    } else if (hDist(e, target) > 2) {
      e._wind = false;
    }
    return;
  }

  // Tank: slow walk + melee
  if (e.ai === 'tank') {
    moveToward(e, target);
    if (hDist(e, target) <= 1) dealDamage(target, 1, e);
    return;
  }

  // Healer: heals wounded allies, melee if adjacent
  if (e.ai === 'healer') {
    e.healBeamTarget = null;
    const hurt = state.enemies.filter(a => a !== e && a.hp > 0 && a.hp < a.maxHp).sort((a, b) => a.hp - b.hp)[0];
    if (hurt) {
      if (hDist(e, hurt) > 2) moveToward(e, hurt);
      else {
        healEntity(hurt, 1, null);
        spawnDmg(e.q, e.r, '💚', '#98fb98');
        e.healBeamTarget = hurt;
      }
    } else if (dist > 2) {
      moveToward(e, target);
    }
    if (dist <= 1) dealDamage(target, 1, e);
    return;
  }

  // --- Boss phase transitions (bossPhase: 1 → 2 → 3) ---
  if (e.isBoss && e.hp > 0) {
    if (!e.bossPhase) e.bossPhase = 1;
    const hpPct = e.hp / e.maxHp;
    if (hpPct <= 0.25 && e.bossPhase < 3) {
      e.bossPhase = 3;
      spawnAoe(e.q, e.r, '#ff0000', HEX * 3);
      doShake(20);
      state.screenFlash = { color: '#c44030', life: 400, maxLife: 400 };
      showWaveAnnounce('PHASE 3', e.name + ' — fury', 1500);
      audio.bossPhase();
      state.slowMoTimer = 600;
      state.slowMoFactor = 2;
    } else if (hpPct <= 0.5 && e.bossPhase < 2) {
      e.bossPhase = 2;
      spawnAoe(e.q, e.r, '#ff4400', HEX * 2.5);
      doShake(15);
      showWaveAnnounce('PHASE 2', e.name + ' — enraged', 1500);
      audio.bossPhase();
    }
  }

  // Boss AI: Warlord
  if (e.ai === 'boss_warlord') {
    e.bossTimer = (e.bossTimer || 0) + 1;
    if (e.bossTimer % 5 === 0 && e.bossTimer <= 15) {
      const sp = canSummon() && hNbrs(e.q, e.r).find(n => isPassable(n.q, n.r, null));
      if (sp) {
        const add = {
          name: 'Charger', hp: 3, maxHp: 3, color: '#d47a3c',
          q: sp.q, r: sp.r, prevQ: sp.q, prevR: sp.r,
          isEnemy: true, ai: 'charger', charging: false,
          shootTimer: 0, telegraph: false, telegraphTarget: null, spawnTick: state.tickCount
        };
        state.enemies.push(add);
        state.entities.push(add);
        spawnDmg(sp.q, sp.r, 'SUMMON!', '#d47a3c');
        spawnAoe(sp.q, sp.r, '#d47a3c');
        audio.summon();
      }
    }
    const chargeInterval = e.bossPhase >= 3 ? 2 : 3;
    if (e.bossTimer % chargeInterval === 0) {
      e.telegraph = false;
      for (let i = 0; i < 2; i++) moveToward(e, target);
      const bDmg = 3 + state.difficulty - 1 + (e.bossPhase >= 2 ? 1 : 0);
      if (hDist(e, target) <= 1) {
        spawnProjectile(e, target, e.color);
        dealDamage(target, bDmg, e);
      }
    } else {
      e.telegraph = true;
      moveToward(e, target);
      if (hDist(e, target) <= 1) dealDamage(target, 1, e);
    }
    return;
  }

  // Boss AI: Lich
  if (e.ai === 'boss_lich') {
    e.bossTimer = (e.bossTimer || 0) + 1;
    e._raiseCount = e._raiseCount || 0;
    if (e.bossTimer % 6 === 0 && e._raiseCount < 4) {
      const dead = state.enemies.find(d => d.hp <= 0 && !d.raised && d !== e);
      if (dead) {
        e._raiseCount++;
        dead.raised = true;
        const sp = canSummon() && hNbrs(e.q, e.r).find(n => isPassable(n.q, n.r, null));
        if (sp) {
          const add = {
            name: 'Zombie', hp: 1, maxHp: 1, color: '#9966cc',
            q: sp.q, r: sp.r, prevQ: sp.q, prevR: sp.r,
            isEnemy: true, ai: 'splasher', charging: false,
            shootTimer: 0, telegraph: false, telegraphTarget: null, spawnTick: state.tickCount
          };
          state.enemies.push(add);
          state.entities.push(add);
          spawnDmg(sp.q, sp.r, 'RISE!', '#9933ff');
          spawnAoe(sp.q, sp.r, '#9933ff');
          audio.summon();
        }
      }
    }
    const lichShootInterval = e.bossPhase >= 3 ? 1 : 2;
    const lichDmg = Math.max(1, 2 + state.difficulty - 1 + (e.bossPhase >= 2 ? 1 : 0));
    if (dist <= 3) {
      if (e.bossTimer % lichShootInterval === 0) {
        spawnProjectile(e, target, '#9933ff', true);
        dealDamage(target, lichDmg, e);
      } else {
        e.telegraph = true;
        e.telegraphTarget = target;
      }
      if (dist <= 1) moveAway(e, target);
    } else {
      moveToward(e, target);
    }
    return;
  }

  // Boss AI: Hydra
  if (e.ai === 'boss_hydra') {
    e.bossTimer = (e.bossTimer || 0) + 1;
    if (!e._hasSplit && e.hp <= Math.floor(e.maxHp * 0.5)) {
      e._hasSplit = true;
      showWaveAnnounce('SPLIT', e.name + ' divides', 1200);
      audio.summon();
      doShake(18);
      const headHp = Math.max(2, Math.floor(e.maxHp * 0.3));
      for (let hi = 0; hi < 2; hi++) {
        const sp = hNbrs(e.q, e.r).filter(n => isPassable(n.q, n.r, null))[hi];
        if (sp) {
          const head = {
            name: 'Hydra Head', hp: headHp, maxHp: headHp, color: '#33dd99',
            q: sp.q, r: sp.r, prevQ: sp.q, prevR: sp.r,
            isEnemy: true, ai: 'splasher', charging: false,
            shootTimer: 0, telegraph: false, telegraphTarget: null, spawnTick: state.tickCount
          };
          state.enemies.push(head);
          state.entities.push(head);
          spawnDmg(sp.q, sp.r, 'SPLIT!', '#22cc88');
          spawnAoe(sp.q, sp.r, '#22cc88');
        }
      }
    }
    if (e.bossTimer % 3 === 0 && dist <= 3) {
      spawnProjectile(e, target, '#22cc88');
      dealDamage(target, 1 + (e.bossPhase >= 2 ? 1 : 0), e);
      audio.hiss();
      if (target.hp > 0) applyStatus(target, 'poison', 2);
    } else if (e.bossTimer % 3 === 1) {
      e.telegraph = true;
      e.telegraphTarget = target;
    }
    moveToward(e, target);
    if (hDist(e, target) <= 1) dealDamage(target, 1, e);
    return;
  }

  // Boss AI: Dragon
  if (e.ai === 'boss_dragon') {
    e.bossTimer = (e.bossTimer || 0) + 1;
    const breathInterval = e.bossPhase >= 3 ? 3 : 4;
    if (e.bossTimer % breathInterval === 0) {
      const dq = Math.sign(target.q - e.q) || 0, dr = Math.sign(target.r - e.r) || 0;
      for (let i = 1; i <= 3; i++) {
        const bq = e.q + dq * i, br = e.r + dr * i;
        if (!inGrid(bq, br)) break;
        const hit = _occMap.get(bq + ',' + br);
        if (hit && hit.hp > 0 && !hit.isEnemy) dealDamage(hit, 2 + (e.bossPhase >= 2 ? 1 : 0), e);
        spawnAoe(bq, br, '#ff4400', HEX * 0.8);
        if (!terrainAt(bq, br)) {
          state.terrain.push({ q: bq, r: br, type: T_LAVA });
          const lavaCount = state.terrain.filter(t => t.type === T_LAVA).length;
          if (lavaCount > 12) {
            const fi = state.terrain.findIndex(t => t.type === T_LAVA);
            if (fi >= 0) state.terrain.splice(fi, 1);
          }
          _terrainMapRebuild();
        }
      }
      doShake(10);
      audio.dragonBreath();
    } else if (e.bossTimer % breathInterval === breathInterval - 1) {
      e.telegraph = true;
      e.telegraphTarget = target;
    }
    if (e.bossTimer % 5 === 0) {
      const open = [];
      for (const { q, r } of boardHexes()) {
        if (isPassable(q, r, e) && hDist({ q, r }, target) >= 2 && hDist({ q, r }, target) <= 4)
          open.push({ q, r });
      }
      if (open.length) {
        const dest = open[Math.floor(Math.random() * open.length)];
        spawnTrail(e.q, e.r, e.color);
        e.q = dest.q;
        e.r = dest.r;
        spawnDmg(e.q, e.r, 'SWOOP', '#cc3300');
      }
    } else {
      moveToward(e, target);
    }
    if (hDist(e, target) <= 1) dealDamage(target, 2, e);
    return;
  }

  // Boss AI: Golem
  if (e.ai === 'boss_golem') {
    e.bossTimer = (e.bossTimer || 0) + 1;
    const poundInterval = e.bossPhase >= 3 ? 2 : 3;
    if (e.bossTimer % poundInterval === 0) {
      hNbrs(e.q, e.r).forEach(n => {
        const hit = _occMap.get(n.q + ',' + n.r);
        if (hit && hit.hp > 0 && !hit.isEnemy) dealDamage(hit, 2 + (e.bossPhase >= 2 ? 1 : 0), e);
        spawnAoe(n.q, n.r, '#8a8070', HEX * 0.6);
      });
      doShake(15);
      audio.golemPound();
      spawnDmg(e.q, e.r, 'POUND', '#8a8070');
    } else {
      e.telegraph = e.bossTimer % poundInterval === poundInterval - 1;
      moveToward(e, target);
      if (hDist(e, target) <= 1) dealDamage(target, 2, e);
    }
    return;
  }

  // Bomber: drops hazard tiles, flees melee
  if (e.ai === 'bomber') {
    e.bossTimer = (e.bossTimer || 0) + 1;
    if (dist <= 1) moveAway(e, target);
    else if (dist > 3) moveToward(e, target);
    if (e.bossTimer % 3 === 0 && !terrainAt(e.q, e.r)) {
      state.terrain.push({ q: e.q, r: e.r, type: T_HAZARD });
      _terrainMapRebuild();
      spawnDmg(e.q, e.r, '💣', '#cc6644');
      spawnAoe(e.q, e.r, '#cc6644', HEX * 0.5);
      audio.bomberDrop();
    }
    return;
  }

  // Assassin: invisible until adjacent, high first strike
  if (e.ai === 'assassin') {
    if (!e._revealed) {
      e._invisible = true;
      moveToward(e, target);
      if (dist <= 1) {
        e._revealed = true;
        e._invisible = false;
        dealDamage(target, Math.max(2, 3 + state.difficulty - 1), e);
        spawnDmg(e.q, e.r, 'AMBUSH!', '#554466');
        doShake(6);
        audio.ambush();
      }
    } else {
      moveToward(e, target);
      if (hDist(e, target) <= 1) dealDamage(target, 1, e);
    }
    return;
  }

  // ShieldBearer: immune from front, must be flanked
  if (e.ai === 'shieldbearer') {
    moveToward(e, target);
    if (hDist(e, target) <= 1) dealDamage(target, 1, e);
    return;
  }

  // Summoner: spawns minions, stays at range
  if (e.ai === 'summoner') {
    e.bossTimer = (e.bossTimer || 0) + 1;
    // ponytail: cap at 4 minions per summoner
    if (e.bossTimer % 3 === 0 && state.enemies.filter(en => en.ai === 'splasher' && en.name === 'Minion' && en.hp > 0).length < 4) {
      const sp = canSummon() && hNbrs(e.q, e.r).find(n => isPassable(n.q, n.r, null));
      if (sp) {
        const add = {
          name: 'Minion', hp: 1, maxHp: 1, color: '#bb88bb',
          q: sp.q, r: sp.r, prevQ: sp.q, prevR: sp.r,
          isEnemy: true, ai: 'splasher', charging: false,
          shootTimer: 0, telegraph: false, telegraphTarget: null, spawnTick: state.tickCount
        };
        state.enemies.push(add);
        state.entities.push(add);
        spawnDmg(sp.q, sp.r, 'SUMMON', '#aa66aa');
        audio.summon();
      }
    }
    if (dist <= 2) moveAway(e, target);
    else if (dist > 4) moveToward(e, target);
    return;
  }

  // Mimic: copies nearest player's last move, delayed 1 tick
  if (e.ai === 'mimic') {
    if (e.mimicTarget) {
      const dq = e.mimicTarget.q - e.mimicTarget.prevQ;
      const dr = e.mimicTarget.r - e.mimicTarget.prevR;
      if (dq || dr) {
        const nq = e.q + dq, nr = e.r + dr;
        if (isPassable(nq, nr, e)) {
          spawnTrail(e.q, e.r, e.color);
          e.q = nq;
          e.r = nr;
        }
      }
    }
    e.mimicTarget = target;
    if (hDist(e, target) <= 1) dealDamage(target, 1, e);
    return;
  }

  // fallback
  moveToward(e, target);
  if (hDist(e, target) <= 1) dealDamage(target, 1, e);
}
