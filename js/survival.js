// Pocket Quest — Survival mode.
//
// The whole screen is the map: a rectangle of hexes whose outer ring is a spawn lane that only
// enemies can enter. Packs of enemies are announced on an edge one tick ahead, then walk in.
// Waves escalate until every hero is down at once. Score = waves cleared, kills and bosses.
//
// Loaded before the main script in host.html; everything here runs at call time and uses the
// game's globals (players, enemies, entities, terrain, tickCount, ...).

import { state } from './state.js';
import { audio } from './audio.js';
import { applyUpgradePick, biomeBossIdx, pickUpgrade } from './campaign.js';
import { C, ctx, irisWipe } from './canvas.js';
import { combatLog, dealDamage, healEntity, resetComboChain, showWaveAnnounce } from './combat.js';
import {
  activeBiome, BIOMES, BOSSES, CLASSES, ENEMIES, setBiome, T_COVER, T_HAZARD, T_LAVA, T_WALL
} from './data.js';
import {
  _occupied, BOARD, gameMode, h2p, hDist, HEX, hNbrs, isPassable, isWall, rk, setBoard, setGameMode, SQRT3,
  terrainAt
} from './hex.js';
import { showStats } from './input.js';
import { _esc, dedupeNames, hostCustomColor, hostPlaying, selectedMode, setTutorial } from './lobby.js';
import { _hpGhosts, hexPath, updatePauseInfo } from './render.js';
import { doShake, initStats, spawnAoe, spawnDmg } from './vfx.js';

// ───────────────────────────── tuning ─────────────────────────────

const SURV = {
  targetCells: 260,        // ~21×12 on a 16:9 screen
  minRows: 9, maxRows: 15,
  cap: 45,                 // max enemies alive at once (summons count too)
  firstPackDelay: 3,       // ticks of calm before wave 1's first pack is announced
  budget: (w) => 4 + 2 * w,
  partyFactor: (n) => 0.8 + 0.4 * (n - 1), // 1p 0.8 · 2p 1.2 · 3p 1.6 · 4p 2.0
  diffMult: [0.75, 1, 1.35],
  packEvery: (w) => (w >= 8 ? 2 : w >= 3 ? 3 : 4),
  packSize: (w) => [Math.min(3, 1 + Math.ceil(w / 2)), Math.min(6, 2 + Math.floor(w / 2))],
  twoSideChance: (w) => (w >= 4 ? 0.3 : 0),
  clearGrace: 15,          // ticks after the last pack before stragglers charge
  fleeAfter: 20,           // ...and ticks after that before leftovers give up and flee (anti-stall)
  bossFleeAfter: 60,
  breatherTicks: 12,       // max breather length; ends ~3 ticks after everyone has picked
  breatherMin: 3,
  reviveHpPct: 0.5,
  breatherHealPct: 0.25,
  hpEveryWaves: 4,         // +1 HP on non-swarmlings every N waves...
  lateFrom: 12,            // ...and from this wave, +1 more every wave (the cap stops numbers growing, so toughness does)
  swarmHpEvery: 6,         // swarmlings +1 HP every N waves
  dmgEveryWaves: 6,        // +1 enemy damage every N waves (wave 7+)
  eliteFrom: 6,            // elites start appearing on this wave...
  eliteChance: (w) => Math.min(0.8, 0.07 * (w - 5)), // ...and get more common
  doubleEliteFrom: 15,     // elites get two traits from this wave
  volatilePerRank: 0.4,    // Volatile: chance per rank that a kill explodes
  emberChance: 0.25,       // Ember Heart relic
  pactKills: 8,            // Blood Pact relic: every N kills heal the party 1
  bossEvery: 5,
  playerDownDelay: 2,      // a hero going down delays the next pack (replaces campaign's comeback nerf)
  points: { wave: 100, kill: 10, summonKill: 2, boss: 250 },
  scoreMult: [0.75, 1, 1.5],
  walls: 0.05, cover: 0.025, hazards: 0.012,
};

// What can spawn, what it costs from the wave budget, and the first wave it appears.
const SURV_ROSTER = [
  { ai: 'swarm', cost: 1, from: 1, weight: 5 },
  { ai: 'splasher', cost: 1, from: 1, weight: 3 },
  { ai: 'charger', cost: 2, from: 2, weight: 2 },
  { ai: 'mimic', cost: 2, from: 2, weight: 1 },
  { ai: 'tank', cost: 3, from: 3, weight: 1.5 },
  { ai: 'glasscannon', cost: 2, from: 3, weight: 1.5 },
  { ai: 'healer', cost: 3, from: 4, weight: 1 },
  { ai: 'bomber', cost: 3, from: 5, weight: 1 },
  { ai: 'assassin', cost: 3, from: 6, weight: 1 },
  { ai: 'shieldbearer', cost: 4, from: 6, weight: 1 },
  { ai: 'summoner', cost: 4, from: 7, weight: 0.7 },
];
export const SWARMLING = { name: 'Swarmling', hp: 1, color: '#8fa35a', ai: 'swarm', desc: 'Fast fodder. Rushes the nearest hero.' };

export let S = null; // run state
export function setSurvivalRun(run) { S = run; }

// ───────────────────────────── board ─────────────────────────────
// Pointy-top axial hexes. A "rectangle" keeps x = q + r/2 within [-CW, CW] on every row.
function makeBoard(W, H) {
  const ratio = (1.5 / SQRT3) * (W / Math.max(1, H)); // cols/rows that fills the screen
  let rows = Math.round(Math.sqrt(SURV.targetCells / Math.max(0.3, ratio)));
  rows = Math.max(SURV.minRows, Math.min(SURV.maxRows, rows));
  if (rows % 2 === 0) rows++;
  const RH = (rows - 1) / 2;
  const CW = Math.max(4, Math.floor(Math.round(SURV.targetCells / rows) / 2));
  return makeBoardDims(CW, RH);
}
// Build the board from its half-width/half-height (remote viewers get these from the host).
export function makeBoardDims(CW, RH) {
  const cells = new Set(), list = [];
  for (let r = -RH; r <= RH; r++) {
    for (let q = Math.ceil(-CW - r / 2); q <= Math.floor(CW - r / 2); q++) {
      cells.add(q + ',' + r); list.push({ q, r });
    }
  }
  const lane = new Set(), sides = { N: [], S: [], W: [], E: [] };
  for (const h of list) {
    if (hNbrs(h.q, h.r).some((n) => !cells.has(n.q + ',' + n.r))) {
      lane.add(h.q + ',' + h.r);
      const x = h.q + h.r / 2;
      const side = h.r === -RH ? 'N' : h.r === RH ? 'S' : x < 0 ? 'W' : 'E';
      sides[side].push(h);
    }
  }
  sides.N.sort((a, b) => a.q - b.q); sides.S.sort((a, b) => a.q - b.q);
  sides.W.sort((a, b) => a.r - b.r); sides.E.sort((a, b) => a.r - b.r);
  const index = new Map(); list.forEach((h, i) => index.set(h.q + ',' + h.r, i));
  const nbr = list.map((h) => hNbrs(h.q, h.r).map((n) => index.get(n.q + ',' + n.r)).filter((i) => i !== undefined));
  return {
    cells, list, lane, sides, index, nbr, RH, CW,
    occupied(q, r, ex) { return !!_occupied(q, r, ex); },
  };
}

// Fit the fixed board to the current canvas (called every frame, so resizing just rescales).
export function survivalHexSize(W, H) {
  if (!BOARD) return 34;
  const byW = (W - 24) / (SQRT3 * (2 * BOARD.CW + 1.5));
  const byH = (H - 90) / (1.5 * (2 * BOARD.RH) + 2);
  return Math.max(window.PQ_VIEWER ? 6 : 14, Math.min(64, Math.min(byW, byH))); // remote boards can be small
}

function survivalTerrain() {
  const inner = BOARD.list.filter((h) => !BOARD.lane.has(h.q + ',' + h.r) && hDist(h, { q: 0, r: 0 }) > 2);
  const n = BOARD.list.length;
  for (let attempt = 0; attempt < 30; attempt++) {
    const t = [];
    const used = new Set();
    const free = inner.slice().sort(() => Math.random() - 0.5);
    const take = (type) => { const h = free.find((c) => !used.has(c.q + ',' + c.r)); if (h) { used.add(h.q + ',' + h.r); t.push({ q: h.q, r: h.r, type, base: true }); } return h; };
    // walls in short clusters make chokepoints rather than noise
    let walls = Math.round(n * SURV.walls);
    while (walls > 0) {
      const a = take(T_WALL); if (!a) break; walls--;
      const len = 1 + Math.floor(Math.random() * 2);
      let cur = a;
      for (let i = 0; i < len && walls > 0; i++) {
        const nx = hNbrs(cur.q, cur.r).filter((h) => inner.some((c) => c.q === h.q && c.r === h.r) && !used.has(h.q + ',' + h.r));
        if (!nx.length) break;
        cur = nx[Math.floor(Math.random() * nx.length)];
        used.add(cur.q + ',' + cur.r); t.push({ q: cur.q, r: cur.r, type: T_WALL, base: true }); walls--;
      }
    }
    for (let i = 0; i < Math.round(n * SURV.cover); i++) take(T_COVER);
    for (let i = 0; i < Math.round(n * SURV.hazards); i++) take(T_HAZARD);
    if (survivalConnected(t)) return t;
  }
  return []; // never trap anyone: fall back to an open field
}
// Every non-wall hex must be reachable from the centre.
function survivalConnected(t) {
  const walls = new Set(t.filter((x) => x.type === T_WALL).map((x) => x.q + ',' + x.r));
  const seen = new Uint8Array(BOARD.list.length);
  const start = BOARD.index.get('0,0');
  const queue = [start]; seen[start] = 1; let count = 1;
  while (queue.length) {
    const i = queue.shift();
    for (const j of BOARD.nbr[i]) {
      const h = BOARD.list[j];
      if (seen[j] || walls.has(h.q + ',' + h.r)) continue;
      seen[j] = 1; count++; queue.push(j);
    }
  }
  return count === BOARD.list.length - walls.size;
}

// ───────────────────────────── pathing ─────────────────────────────
// Distance field (BFS through non-wall hexes) from a target, cached per tick.
function survivalField(target) {
  const key = target.q + ',' + target.r;
  if (!S.fields || S.fieldsTick !== state.tickCount) { S.fields = new Map(); S.fieldsTick = state.tickCount; }
  let f = S.fields.get(key);
  if (f) return f;
  f = new Int16Array(BOARD.list.length).fill(-1);
  const seeds = [];
  const ti = BOARD.index.get(key);
  if (ti !== undefined && !isWall(target.q, target.r)) seeds.push(ti);
  else hNbrs(target.q, target.r).forEach((n) => { const i = BOARD.index.get(n.q + ',' + n.r); if (i !== undefined && !isWall(n.q, n.r)) seeds.push(i); });
  const queue = [];
  seeds.forEach((i) => { f[i] = 0; queue.push(i); });
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi];
    for (const j of BOARD.nbr[i]) {
      if (f[j] !== -1) continue;
      const h = BOARD.list[j];
      if (isWall(h.q, h.r)) continue;
      f[j] = f[i] + 1; queue.push(j);
    }
  }
  S.fields.set(key, f);
  return f;
}
// Next hex for e on its way to target (null = stay). Steps downhill, sidesteps around jams.
export function survivalNextStep(e, target) {
  const f = survivalField(target);
  const here = BOARD.index.get(e.q + ',' + e.r);
  const cur = here !== undefined && f[here] >= 0 ? f[here] : 9999;
  let best = null, bestScore = cur, side = [];
  for (const n of hNbrs(e.q, e.r)) {
    const i = BOARD.index.get(n.q + ',' + n.r);
    if (i === undefined || f[i] < 0 || !isPassable(n.q, n.r, e)) continue;
    const t = terrainAt(n.q, n.r);
    const pen = t && t.type === T_LAVA ? 2 : t && t.type === T_HAZARD ? 0.5 : 0;
    const sc = f[i] + pen;
    if (sc < bestScore) { bestScore = sc; best = n; }
    else if (f[i] === cur && !pen) side.push(n);
  }
  if (!best && side.length && Math.random() < 0.5) best = side[Math.floor(Math.random() * side.length)];
  return best;
}

// ───────────────────────────── run lifecycle ─────────────────────────────
export function startSurvival() {
  setGameMode('survival');
  state.entities = []; state.players = []; state.enemies = []; state.pendingInput = null; state.pendingInputs = {}; state.tickCount = 0; state.totalTicks = 0; state.gameOver = false; state.paused = false;
  state.damageNumbers = []; state.flashEffects = []; state.projectiles = []; state.deathEffects = []; state.aoeEffects = []; state.trailEffects = []; state.statusParticles = [];
  state.killStreak = 0; state.lastKillTick = 0; state.killFeed = []; state.dpsTicks = []; state.dpsDisplay = 0; state.encDmgTaken = 0; resetComboChain(); _hpGhosts.clear();
  window._upgradeState = null;
  ['transition-overlay', 'stats-overlay', 'pause-overlay'].forEach((id) => document.getElementById(id).classList.remove('show'));
  state.msg = ''; state.msgTimer = 0;
  document.getElementById('input-indicator').textContent = '';
  state.campaignNode = 0; state.campaignActive = false; state.campaignTotal = 999; setTutorial(false);
  state.difficulty = parseInt(document.getElementById('diff-sel').value);
  const biomeVal = document.getElementById('biome-sel').value;
  setBiome(biomeVal === 'random' ? BIOMES[Math.floor(Math.random() * BIOMES.length)] : BIOMES[parseInt(biomeVal)]);
  state.combatLogLines = []; document.getElementById('combat-log').innerHTML = '';
  state.partyXP = 0; state.partyLevel = 1; state.xpToNext = 5; state.perfectClears = 0; state.waveRatings = [];

  // the board is fixed for the whole run; window resizes only rescale it
  setBoard(makeBoard(window.innerWidth, window.innerHeight));
  state.terrain = survivalTerrain();

  const spawns = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 1 }, { q: 0, r: -1 }];
  survivalBuildRoster().forEach((r, i) => {
    const cls = CLASSES[r.classIdx], sp = spawns[i % spawns.length];
    const p = { name: r.name || cls.name, hp: cls.hp, maxHp: cls.hp, color: r.customColor || cls.color, q: sp.q, r: sp.r, prevQ: sp.q, prevR: sp.r, isEnemy: false, classIdx: r.classIdx, ability: cls.ability, cd: cls.cd, cdTimer: 0, ghost: false, isBot: r.isBot, dmgBonus: 0, cdBonus: 0, upgrades: [] };
    cls.loadouts[r.loadout].apply(p); p.loadout = cls.loadouts[r.loadout].name;
    if (r.controllerId) state.controllerSlots[r.controllerId] = i;
    state.players.push(p);
  });
  dedupeNames(state.players);
  initStats();
  state.entities = [...state.players];

  const numP = state.players.length;
  S = {
    wave: 0, phase: 'spawn', phaseTick: 0, budget: 0, telegraph: [], delay: 0,
    cleared: 0, kills: 0, summonKills: 0, bossKills: 0, bossPending: false,
    bestKey: 'pq-surv-best-' + numP + 'p-d' + state.difficulty, best: survivalLoadBest('pq-surv-best-' + numP + 'p-d' + state.difficulty), newBest: false,
    startTime: Date.now(), autoPaused: false,
    relics: [], chain: 0, pactCount: 0,
  };
  state.players.forEach((p) => { p.upg = {}; });
  survivalStartWave(1);
  S.delay = SURV.firstPackDelay;

  state.tickMs = parseInt(document.getElementById('speed-sel').value); state.originalTickMs = state.tickMs; state.tempoTicks = 0;
  state.tickTimer = 0; state.running = true; state.paused = false;
  audio.startDrone();
  document.getElementById('restart-btn').style.display = 'none';
  survivalUpdateBar();
}

function survivalBuildRoster() {
  const numP = parseInt(document.getElementById('player-sel').value);
  const roster = [];
  state.controllerSlots = {};
  if (hostPlaying) {
    roster.push({ classIdx: parseInt(document.getElementById('class-sel').value), loadout: parseInt(document.getElementById('loadout-sel').value), isBot: false, controllerId: null, name: document.getElementById('host-name').value.trim().toUpperCase() || null, customColor: hostCustomColor });
  }
  while (roster.length < numP) {
    const lp = state.lobbyPlayers.find((p) => !p.isLocal && !roster.some((r) => r.controllerId === p.id));
    if (lp) roster.push({ classIdx: lp.classIdx || 0, loadout: lp.loadout || 0, isBot: false, controllerId: lp.id, name: lp.name, customColor: lp.customColor || null });
    else {
      const used = roster.map((r) => r.classIdx); let ci = 0;
      for (let j = 0; j < 4; j++) if (!used.includes(j)) { ci = j; break; }
      roster.push({ classIdx: ci, loadout: Math.floor(Math.random() * 2), isBot: true, controllerId: null, name: null, customColor: null });
    }
  }
  return roster;
}

function survivalStartWave(n) {
  survivalClosePicks();
  S.wave = n; S.phase = 'spawn'; S.phaseTick = 0; S.telegraph = []; S.bounty = null;
  const numP = state.players.length;
  S.budget = Math.round(SURV.budget(n) * SURV.partyFactor(numP) * (SURV.diffMult[state.difficulty] || 1));
  S.bossPending = n % SURV.bossEvery === 0;
  // wave variety: bounty waves every 3rd non-boss wave from wave 4
  S.waveType = (!S.bossPending && n >= 4 && n % 3 === 1) ? 'bounty' : 'normal';
  if (S.bossPending) S.budget = Math.round(S.budget * 0.6);
  const title = S.bossPending ? 'BOSS WAVE ' + n : S.waveType === 'bounty' ? 'BOUNTY WAVE ' + n : 'WAVE ' + n;
  const sub = S.bossPending ? 'something big is coming' : S.waveType === 'bounty' ? 'kill the bounty to end it' : 'they come from the edges';
  showWaveAnnounce(title, sub, 1800);
  combatLog('── Wave ' + n + ' ──', '#c49040');
  survivalUpdateBar();
}

// Called from tick() after players and enemies have acted.
export function survivalAfterTick() {
  survivalPruneDead();
  if (state.players.every((p) => p.hp <= 0 || p.ghost)) { survivalGameOver(); return; }
  S.phaseTick++;
  const alive = state.enemies.filter((e) => e.hp > 0).length;
  // Regeneration upgrade
  state.players.forEach((p) => { if (p.regen && p.hp > 0 && p.hp < p.maxHp && state.tickCount % Math.max(2, 6 - p.regen) === 0) healEntity(p, 1, null); });

  if (S.phase === 'spawn') {
    if (S.delay > 0) { S.delay--; }
    else {
      if (S.telegraph.length) { survivalSpawnTelegraphed(); }
      if (S.bossPending) survivalPlanBoss();
      else if (S.budget > 0 && S.phaseTick % SURV.packEvery(S.wave) === 0) survivalPlanPack();
      // bounty wave: spawn the bounty target once after the first pack
      if (S.waveType === 'bounty' && !S.bounty && state.enemies.some((e) => e.hp > 0 && e._surv)) survivalSpawnBounty();
      if (S.budget <= 0 && !S.bossPending && !S.telegraph.length) { S.phase = 'clear'; S.phaseTick = 0; }
    }
  } else if (S.phase === 'clear') {
    // bounty wave: killing the bounty clears instantly — remaining enemies flee
    if (S.bounty && S.bounty.hp <= 0) {
      state.enemies.forEach((e) => { if (e.hp > 0 && e !== S.bounty) { e.hp = 0; e._fled = true; spawnAoe(e.q, e.r, '#555', HEX * 0.8); } });
      showWaveAnnounce('BOUNTY CLAIMED', 'remaining foes scatter', 1400);
      S.bounty = null;
    }
    if (alive === 0 || (S.bounty === null && S.waveType === 'bounty' && state.enemies.every((e) => e.hp <= 0))) survivalStartBreather();
    else if (S.phaseTick === SURV.clearGrace) {
      // stragglers (kiting casters, mimics far away) charge so a wave can't stall forever
      state.enemies.forEach((e) => { if (e.hp > 0 && !e.isBoss && e.ai !== 'swarm') { e._charge = true; e.dmg = 1; e.telegraph = false; } });
      showWaveAnnounce('THE HORDE CHARGES', alive + ' left', 1400);
    } else {
      // safety net: a wave must always end (pockets, ghost bodyblocks, kiting bosses...)
      const t = S.phaseTick - SURV.clearGrace;
      const flee = state.enemies.filter((e) => e.hp > 0 && (e.isBoss ? t >= SURV.bossFleeAfter : t >= SURV.fleeAfter));
      if (flee.length) {
        flee.forEach((e) => { e.hp = 0; e._fled = true; spawnAoe(e.q, e.r, '#555', HEX * 0.8); });
        showWaveAnnounce('STRAGGLERS FLEE', 'no points for runaways', 1400);
      }
    }
  } else if (S.phase === 'breather') {
    if (S.phaseTick === 1) survivalBotPicks();
    if (S.phaseTick >= SURV.breatherTicks) survivalStartWave(S.wave + 1);
  }
  survivalUpdateBar();
}

function survivalStartBreather() {
  S.phase = 'breather'; S.phaseTick = 0; S.cleared = S.wave;
  // bomber hazards and dragon lava don't pile up across an endless run
  state.terrain = state.terrain.filter((t) => t.base);
  let revived = 0;
  const revPct = survivalHasRelic('phoenix') ? 1 : SURV.reviveHpPct;
  state.players.forEach((p) => {
    if (p.ghost) { p.ghost = false; p.hp = Math.max(1, Math.ceil(p.maxHp * revPct)); revived++; spawnDmg(p.q, p.r, 'REVIVED', '#c9973e'); }
    else if (p.hp > 0) { const h = Math.max(1, Math.round(p.maxHp * SURV.breatherHealPct)); healEntity(p, h, null); }
  });
  showWaveAnnounce('WAVE ' + S.wave + ' CLEARED', revived ? revived + ' revived · breather' : 'breather', 2000);
  audio.levelup();
  combatLog('Wave ' + S.wave + ' cleared · score ' + survivalScore(), '#7ea879');
  if (S.wave % SURV.bossEvery === 0) survivalGrantRelic();
  survivalOpenPicks();
}

function survivalGameOver() {
  if (state.gameOver) return;
  state.gameOver = true; audio.stopDrone(); audio.defeat();
  const score = survivalScore();
  if (score > S.best) { S.best = score; S.newBest = true; survivalSaveBest(S.bestKey, score); }
  state.screenFlash = { color: '#c45a3c', life: 1000, maxLife: 1000 }; doShake(25);
  showWaveAnnounce('OVERRUN', 'survived ' + S.cleared + ' wave' + (S.cleared === 1 ? '' : 's') + ' · ' + score + ' pts', 2600);
  state.slowMoTimer = 1500; state.slowMoFactor = 3;
  setTimeout(() => irisWipe({ speed: 0.003, color: '#000', hold: 150, onMid: showStats }), 2600);
}

// Dead enemies leave the lists a few ticks after dying (the Lich can still raise fresh corpses);
// otherwise every loop in the game would grow with the run's total kill count.
function survivalPruneDead() {
  let changed = false;
  state.enemies.forEach((e) => { if (e.hp <= 0 && e._deadAt == null) e._deadAt = state.tickCount; });
  const keep = (e) => !(e.isEnemy && e.hp <= 0 && state.tickCount - e._deadAt >= 3);
  if (state.enemies.some((e) => !keep(e))) { state.enemies = state.enemies.filter(keep); state.entities = state.entities.filter(keep); changed = true; }
  return changed;
}

// ───────────────────────────── spawning ─────────────────────────────
function survivalPickSide() {
  const opts = ['N', 'S', 'W', 'E'].filter((s) => BOARD.sides[s].length);
  // weight by lane length so long edges get proportionally more packs
  const total = opts.reduce((a, s) => a + BOARD.sides[s].length, 0);
  let roll = Math.random() * total;
  for (const s of opts) { roll -= BOARD.sides[s].length; if (roll <= 0) return s; }
  return opts[0];
}
function survivalFreeLaneHexes(side) {
  const taken = new Set(S.telegraph.map((t) => t.q + ',' + t.r));
  return BOARD.sides[side].filter((h) => !taken.has(h.q + ',' + h.r) && !BOARD.occupied(h.q, h.r, null) && !isWall(h.q, h.r));
}
function survivalEnemyDef(ai) {
  if (ai === 'swarm') return SWARMLING;
  return ENEMIES.find((d) => d.ai === ai);
}
function survivalPlanPack() {
  const alive = state.enemies.filter((e) => e.hp > 0).length;
  let room = SURV.cap - alive - S.telegraph.length;
  if (room <= 0) return; // board is full: wait, budget carries over
  const [mn, mx] = SURV.packSize(S.wave);
  let size = Math.min(room, mn + Math.floor(Math.random() * (mx - mn + 1)));
  const sides = [survivalPickSide()];
  if (Math.random() < SURV.twoSideChance(S.wave)) { const s2 = survivalPickSide(); if (s2 !== sides[0]) sides.push(s2); }
  const pool = SURV_ROSTER.filter((x) => x.from <= S.wave && survivalEnemyDef(x.ai));
  let si = 0;
  while (size > 0 && S.budget > 0) {
    const afford = pool.filter((x) => x.cost <= S.budget);
    if (!afford.length) break;
    const wsum = afford.reduce((a, x) => a + x.weight, 0);
    let roll = Math.random() * wsum, pick = afford[0];
    for (const x of afford) { roll -= x.weight; if (roll <= 0) { pick = x; break; } }
    const side = sides[si++ % sides.length];
    const free = survivalFreeLaneHexes(side);
    if (!free.length) break;
    // cluster the pack around one spot on the edge
    const anchor = S.telegraph.find((t) => t.side === side) || free[Math.floor(Math.random() * free.length)];
    free.sort((a, b) => hDist(a, anchor) - hDist(b, anchor));
    const h = free[0];
    S.telegraph.push({ q: h.q, r: h.r, side, ai: pick.ai, cost: pick.cost });
    S.budget -= pick.cost; size--;
  }
  if (S.telegraph.length) audio.tick(true);
}
function survivalPlanBoss() {
  const side = survivalPickSide();
  const free = survivalFreeLaneHexes(side);
  if (!free.length) return;
  const h = free[Math.floor(free.length / 2)];
  S.telegraph.push({ q: h.q, r: h.r, side, boss: true, cost: 0 });
  S.bossPending = false;
  showWaveAnnounce('BOSS INCOMING', 'from the ' + { N: 'north', S: 'south', W: 'west', E: 'east' }[side], 1600);
  state.screenFlash = { color: '#220000', life: 800, maxLife: 800 };
  state.slowMoTimer = 600; state.slowMoFactor = 2;
  doShake(15);
  audio.setBossDrone && audio.setBossDrone(true);
}
function survivalSpawnBounty() {
  const side = survivalPickSide();
  const free = survivalFreeLaneHexes(side);
  if (!free.length) return;
  const h = free[Math.floor(free.length / 2)];
  const extraHp = Math.floor((S.wave - 1) / SURV.hpEveryWaves) + Math.max(0, S.wave - SURV.lateFrom);
  const hp = 4 + extraHp + state.players.length;
  const e = { name: 'Bounty', hp, maxHp: hp, color: '#e8c840', q: h.q, r: h.r, prevQ: h.q, prevR: h.r, isEnemy: true, ai: 'charger', charging: false, shootTimer: 0, telegraph: false, telegraphTarget: null, spawnTick: state.tickCount, _surv: true, _bounty: true };
  survivalMakeElite(e);
  state.enemies.push(e); state.entities.push(e);
  S.bounty = e;
  spawnAoe(h.q, h.r, '#e8c840', HEX * 1.5); spawnDmg(h.q, h.r, '★ BOUNTY', '#e8c840');
  showWaveAnnounce('BOUNTY SPAWNED', 'kill it to clear the wave', 1400);
}
function survivalSpawnTelegraphed() {
  const extraHp = Math.floor((S.wave - 1) / SURV.hpEveryWaves) + Math.max(0, S.wave - SURV.lateFrom);
  const swarmHp = Math.floor(S.wave / SURV.swarmHpEvery);
  for (const t of S.telegraph) {
    let h = { q: t.q, r: t.r };
    if (BOARD.occupied(h.q, h.r, null)) {
      const free = BOARD.sides[t.side].filter((x) => !BOARD.occupied(x.q, x.r, null) && !isWall(x.q, x.r));
      if (!free.length) { S.budget += t.cost; continue; } // edge jammed: refund, try again next pack
      free.sort((a, b) => hDist(a, h) - hDist(b, h)); h = free[0];
    }
    let e;
    if (t.boss) {
      const def = BOSSES[biomeBossIdx(Math.floor(S.wave / SURV.bossEvery) - 1)];
      const cycle = Math.floor(S.wave / SURV.bossEvery);
      const hp = def.hp + state.difficulty * 4 + (cycle - 1) * 4 + 2 * (state.players.length - 1);
      e = { name: def.name, hp, maxHp: hp, color: def.color, q: h.q, r: h.r, prevQ: h.q, prevR: h.r, isEnemy: true, ai: def.ai, isBoss: true, charging: false, shootTimer: 0, telegraph: false, telegraphTarget: null, bossTimer: 0, spawnTick: state.tickCount, _surv: true };
      audio.bossPhase && audio.bossPhase();
    } else {
      const def = survivalEnemyDef(t.ai);
      const hp = def.hp + (t.ai === 'swarm' ? swarmHp : extraHp);
      e = { name: def.name, hp, maxHp: hp, color: def.color, q: h.q, r: h.r, prevQ: h.q, prevR: h.r, isEnemy: true, ai: def.ai, charging: false, shootTimer: 0, telegraph: false, telegraphTarget: null, spawnTick: state.tickCount, _surv: true };
      if (t.ai !== 'swarm' && S.wave >= SURV.eliteFrom && Math.random() < SURV.eliteChance(S.wave)) survivalMakeElite(e);
    }
    state.enemies.push(e); state.entities.push(e);
    spawnAoe(h.q, h.r, e.color, HEX * 0.8);
  }
  S.telegraph = [];
}

// ───────────────────────────── hooks from the main game ─────────────────────────────
export function canSummon() { return gameMode !== 'survival' || state.enemies.filter((e) => e.hp > 0).length < SURV.cap; }
export function survivalOnPlayerDown() { if (S && S.phase === 'spawn') S.delay += SURV.playerDownDelay; }
export function survivalOnEnemyKilled(e, attacker) {
  if (!S) return;
  if (e.isBoss) S.bossKills++;
  else if (e._surv) S.kills++;
  else S.summonKills++;
  // Blood Pact relic
  if (survivalHasRelic('pact') && ++S.pactCount >= SURV.pactKills) {
    S.pactCount = 0;
    state.players.forEach((p) => { if (p.hp > 0 && p.hp < p.maxHp) healEntity(p, 1, null); });
    spawnDmg(e.q, e.r, 'BLOOD PACT', '#c44040');
  }
  // explosions (chain depth is capped so one kill can't wipe the whole horde)
  if (S.chain >= 2) return;
  const killer = attacker && !attacker.isEnemy ? attacker : null;
  const boom = (killer && killer.volatile && Math.random() < killer.volatile * SURV.volatilePerRank) || (survivalHasRelic('ember') && Math.random() < SURV.emberChance);
  S.chain++;
  try {
    if (boom) {
      spawnAoe(e.q, e.r, '#ff8833', HEX * 1.3); audio.explode && audio.explode();
      hNbrs(e.q, e.r).forEach((n) => { const t = state.enemies.find((x) => x.q === n.q && x.r === n.r && x.hp > 0); if (t) dealDamage(t, 1, killer || state.players.find((p) => p.hp > 0) || null); });
    }
    if (e._explosive) { // explosive elite: hurts heroes next to it
      spawnAoe(e.q, e.r, '#c45a3c', HEX * 1.3);
      hNbrs(e.q, e.r).forEach((n) => { const t = state.players.find((x) => x.q === n.q && x.r === n.r && x.hp > 0 && !x.ghost); if (t) dealDamage(t, 1, e); });
    }
  } finally { S.chain--; }
}
export function survivalEnemyDmgBonus() { return S ? Math.floor((S.wave - 1) / SURV.dmgEveryWaves) : 0; }
export function survivalWave() { return S ? S.wave : 0; }
export function survivalScore() {
  if (!S) return 0;
  if (S._score != null) return S._score; // remote viewer: the host's number
  const P = SURV.points;
  const raw = S.cleared * P.wave + S.kills * P.kill + S.summonKills * P.summonKill + S.bossKills * P.boss;
  return Math.round(raw * (SURV.scoreMult[state.difficulty] || 1));
}
function survivalLoadBest(key) { try { return parseInt(localStorage.getItem(key) || '0', 10) || 0; } catch (e) { return 0; } }
function survivalSaveBest(key, v) { try { localStorage.setItem(key, String(v)); } catch (e) { /* private mode etc. */ } }

export function updateBestScoreLabel() {
  const el = document.getElementById('best-score'); if (!el) return;
  const surv = typeof selectedMode === 'function' && selectedMode() === 'survival';
  if (!surv) { el.style.display = 'none'; return; }
  const n = parseInt(document.getElementById('player-sel').value), d = parseInt(document.getElementById('diff-sel').value);
  const best = survivalLoadBest('pq-surv-best-' + n + 'p-d' + d);
  el.textContent = best ? '★ Best ' + best : '★ No best yet';
  el.style.display = '';
}

// ───────────────────────────── drawing ─────────────────────────────
export function survivalDrawBoard(ts) {
  if (!S) return;
  ctx.save();
  // spawn lane: darker "fog" band so players can see where they can't go
  ctx.globalAlpha = 0.45; ctx.fillStyle = '#000';
  BOARD.lane.forEach((k) => { const [q, r] = k.split(',').map(Number); const { x, y } = h2p(q, r); hexPath(x, y, HEX - 2); ctx.fill(); });
  // incoming packs: pulsing hexes one tick before they arrive
  const pulse = 0.5 + 0.5 * Math.sin(ts * 0.012);
  for (const t of S.telegraph) {
    const { x, y } = h2p(t.q, t.r);
    ctx.globalAlpha = 0.35 + 0.45 * pulse;
    hexPath(x, y, HEX - 3);
    ctx.fillStyle = t.boss ? '#ff3300' : '#c45a3c'; ctx.fill();
    ctx.globalAlpha = 0.9; ctx.lineWidth = 2; ctx.strokeStyle = t.boss ? '#ffcc66' : '#ff9966'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = 'bold ' + Math.round(HEX * 0.6) + 'px Rajdhani,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t.boss ? '☠' : '!', x, y + 1);
  }
  // elites: colored ring under the unit (drawn before entities)
  for (const e of state.enemies) {
    if (!e.elite || e.hp <= 0) continue;
    const { x, y } = h2p(e.q, e.r);
    ctx.globalAlpha = 0.55 + 0.25 * pulse; ctx.strokeStyle = e.elite.color; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(x, y + HEX * 0.15, HEX * 0.55, HEX * 0.3, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
}

export function survivalDrawHud(ts) {
  if (!S || !state.running) return;
  const alive = state.enemies.filter((e) => e.hp > 0).length;
  let sub;
  if (S.phase === 'breather') sub = (window._upgradeState && !window._upgradeState.done ? 'Choose upgrades · ' : 'Breather · ') + 'next wave in ' + Math.max(0, SURV.breatherTicks - S.phaseTick);
  else if (S.phase === 'clear') sub = (S.phaseTick >= SURV.clearGrace ? 'Stragglers charging · ' : 'Finish them · ') + alive + ' left';
  else sub = 'Horde incoming · ' + alive + ' on the field';
  const line = 'WAVE ' + S.wave + '   ·   ' + survivalScore() + ' PTS   ·   BEST ' + Math.max(S.best, 0);
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.font = 'bold 18px Rajdhani,sans-serif';
  const w = Math.max(ctx.measureText(line).width, 220) + 40;
  const x = C.width / 2, y = 8;
  ctx.globalAlpha = 0.85; ctx.fillStyle = 'rgba(12,10,8,0.85)'; ctx.fillRect(x - w / 2, y, w, 44);
  ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(184,148,62,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2 + 0.5, y + 0.5, w - 1, 43);
  ctx.fillStyle = '#e8c878'; ctx.fillText(line, x, y + 5);
  ctx.font = '600 12px Rajdhani,sans-serif'; ctx.fillStyle = S.phase === 'breather' ? '#7ea879' : '#c49040';
  ctx.fillText(sub.toUpperCase(), x, y + 26);
  if (S.relics.length) { ctx.font = '16px sans-serif'; ctx.globalAlpha = 0.95; ctx.fillText(S.relics.map((r) => r.icon).join(' '), x, y + 48); }
  ctx.restore();
}

function survivalUpdateBar() {
  const el = document.getElementById('campaign-bar');
  if (el && S) el.textContent = 'SURVIVAL · WAVE ' + S.wave;
}

export function survivalResultsHeader() {
  const diffNames = ['Easy', 'Normal', 'Hard'];
  const score = survivalScore();
  const secs = Math.floor((Date.now() - S.startTime) / 1000);
  const time = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
  let html = `<h2 style="color:#c45a3c;text-shadow:0 0 20px rgba(196,90,60,0.3)">OVERRUN AT WAVE ${S.wave}</h2>`;
  html += `<p style="color:#8a7e6e;font-size:0.6875rem;margin-bottom:0.25rem;letter-spacing:0.0625rem;text-transform:uppercase">Survival · ${activeBiome.name} · ${diffNames[state.difficulty] || 'Normal'} · ${state.players.length} players</p>`;
  html += `<p style="margin-bottom:0.5rem;color:#888">${time} · ${S.cleared} wave${S.cleared === 1 ? '' : 's'} cleared · ${S.kills + S.summonKills} kills · ${S.bossKills} boss${S.bossKills === 1 ? '' : 'es'} · Lv${state.partyLevel}</p>`;
  html += `<div style="margin:0.5rem auto;font-size:3.25rem;font-weight:900;color:#e8c878;text-shadow:0 0 30px rgba(232,200,120,0.3);letter-spacing:0.125rem;line-height:1">${score}</div>`;
  html += `<div style="font-size:0.625rem;color:#555;letter-spacing:0.0625rem;text-transform:uppercase;margin-bottom:0.25rem">${S.newBest ? '<span style="color:#7ea879">★ New best!</span>' : 'Best ' + S.best} · ${state.players.length}p ${diffNames[state.difficulty] || 'Normal'}</div>`;
  return html;
}

// ───────────────────────────── housekeeping ─────────────────────────────
// Auto-pause if every phone player has dropped and nobody is playing on the host,
// so an unattended run doesn't grind on with bots forever.
setInterval(() => {
  if (window.PQ_VIEWER || typeof gameMode === 'undefined' || gameMode !== 'survival' || !S || !state.running || state.gameOver) return;
  const humanLeft = hostPlaying || state.players.some((p) => !p.isBot);
  const hadHumans = state.players.some((p) => p._dc);
  const ov = document.getElementById('pause-overlay');
  if (!humanLeft && hadHumans && !state.paused) { state.paused = true; S.autoPaused = true; ov.classList.add('show'); if (typeof updatePauseInfo === 'function') updatePauseInfo(); showWaveAnnounce('PAUSED', 'waiting for players to rejoin', 2500); }
  else if (humanLeft && S.autoPaused && state.paused) { state.paused = false; S.autoPaused = false; ov.classList.remove('show'); }
}, 1000);

window.addEventListener('DOMContentLoaded', () => {
  ['player-sel', 'diff-sel'].forEach((id) => { const el = document.getElementById(id); if (el) el.addEventListener('change', updateBestScoreLabel); });
});

// ───────────────────────────── upgrades (ranked, capped) ─────────────────────────────
// Survival has its own pool: every upgrade can be picked again until its max rank, numbers that
// would make a hero untouchable are capped, and maxed or useless upgrades leave the pool.
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];
const SURV_UPGRADES = [
  { id: 'steel', icon: '⚔️', name: 'Tempered Steel', max: 5, desc: () => '+1 attack damage', apply: (p) => { p.dmgBonus++; } },
  { id: 'skin', icon: '🛡', name: 'Thick Skin', max: 5, desc: () => '+2 max HP', apply: (p) => { p.maxHp += 2; p.hp = Math.min(p.maxHp, p.hp + 2); } },
  { id: 'hands', icon: '⚡', name: 'Swift Hands', max: 2, desc: () => '-1 skill cooldown', ok: (p) => p.cd - (p.cdBonus || 0) > 1, apply: (p) => { p.cdBonus = (p.cdBonus || 0) + 1; } },
  { id: 'crit', icon: '🎯', name: 'Sharpened', max: 4, desc: (p) => '+10% crit (now ' + Math.round((0.15 + (p.critBonus || 0)) * 100) + '%, max 55%)', apply: (p) => { p.critBonus = Math.min(0.4, (p.critBonus || 0) + 0.1); } },
  { id: 'dodge', icon: '💫', name: 'Evasion', max: 3, desc: (p) => '+10% dodge (now ' + Math.round((p.dodgeChance || 0) * 100) + '%, max 40%)', ok: (p) => (p.dodgeChance || 0) < 0.4, apply: (p) => { p.dodgeChance = Math.min(0.4, (p.dodgeChance || 0) + 0.1); } },
  { id: 'vamp', icon: '🩸', name: 'Vampiric', max: 2, desc: (p) => 'Kills heal you ' + (rk(p.vampiric) + 1) + ' HP', apply: (p) => { p.vampiric = rk(p.vampiric) + 1; } },
  { id: 'thorns', icon: '🌹', name: 'Thorns', max: 3, desc: (p) => 'Melee attackers take ' + (Math.max(p.classIdx === 0 ? 1 : 0, p.thorns || 0) + 1) + ' dmg', apply: (p) => { p.hasThorns = true; p.thorns = Math.max(p.classIdx === 0 ? 1 : 0, p.thorns || 0) + 1; } },
  { id: 'poison', icon: '🧪', name: 'Poison Blade', max: 3, desc: (p) => 'Attacks poison for ' + (rk(p.poisonBlade) + 1) + (rk(p.poisonBlade) ? ' ticks' : ' tick'), apply: (p) => { p.poisonBlade = rk(p.poisonBlade) + 1; } },
  { id: 'adren', icon: '💉', name: 'Adrenaline', max: 1, desc: () => 'Kills reset your skill cooldown', apply: (p) => { p.adrenaline = true; } },
  { id: 'berserk', icon: '🔥', name: 'Berserker', max: 2, desc: (p) => '+' + (rk(p.berserk) + 1) + ' dmg while below 50% HP', apply: (p) => { p.berserk = rk(p.berserk) + 1; } },
  { id: 'regen', icon: '🌿', name: 'Regeneration', max: 3, desc: (p) => 'Heal 1 HP every ' + Math.max(2, 5 - (p.regen || 0)) + ' ticks', apply: (p) => { p.regen = (p.regen || 0) + 1; } },
  { id: 'pierce', icon: '🏹', name: 'Pierce', max: 2, desc: (p) => 'Attacks also hit the enemy behind for ' + ((p.pierce || 0) + 1), apply: (p) => { p.pierce = (p.pierce || 0) + 1; } },
  { id: 'volatile', icon: '💥', name: 'Volatile', max: 2, desc: (p) => Math.round(((p.volatile || 0) + 1) * SURV.volatilePerRank * 100) + '% of your kills explode', apply: (p) => { p.volatile = (p.volatile || 0) + 1; } },
  { id: 'bulwark', icon: '🏰', name: 'Bulwark', max: 1, desc: () => 'Cover blocks 2 dmg (can block fully)', apply: (p) => { p.bulwark = true; } },
  { id: 'fleet', icon: '👟', name: 'Fleet Foot', max: 1, desc: () => 'Move 2 hexes per step', ok: (p) => p.classIdx !== 2, apply: (p) => { p.fleet = true; } },
  { id: 'medic', icon: '💚', name: 'Battle Medic', max: 99, desc: () => 'Whole party heals 3 HP now', apply: () => { state.players.forEach((pl) => { if (pl.hp > 0) pl.hp = Math.min(pl.maxHp, pl.hp + 3); }); } },
];

// Three offers for one hero, as objects the existing pick flow understands (name/icon/desc/apply).
function survivalOffers(p, n) {
  p.upg = p.upg || {};
  const avail = SURV_UPGRADES.filter((u) => (p.upg[u.id] || 0) < u.max && (!u.ok || u.ok(p)));
  const pool = avail.filter((u) => u.id !== 'medic');
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  if (out.length < n) out.push(SURV_UPGRADES.find((u) => u.id === 'medic'));
  return out.map((u) => {
    const rank = (p.upg[u.id] || 0) + 1;
    return {
      id: u.id, icon: u.icon,
      name: u.name + (u.max > 1 && u.max < 99 ? ' ' + ROMAN[rank] : ''),
      desc: u.desc(p),
      apply: (pl) => { pl.upg = pl.upg || {}; pl.upg[u.id] = (pl.upg[u.id] || 0) + 1; u.apply(pl); },
    };
  });
}

function survivalOpenPicks() {
  window._upgradeState = { picks: {}, choices: {}, done: false };
  state.players.forEach((p) => { window._upgradeState.choices[p.name] = survivalOffers(p, 3); window._upgradeState.picks[p.name] = null; });
  survivalRenderPicks(true);
}
function survivalBotPicks() {
  const us = window._upgradeState; if (!us || us.done) return;
  state.players.forEach((p) => {
    if (p.isBot && !us.picks[p.name]) {
      const ch = us.choices[p.name] || [];
      // bots like raw stats
      const pref = ch.find((u) => ['steel', 'skin', 'vamp', 'regen'].includes(u.id)) || ch[0];
      if (pref) applyUpgradePick(p, pref);
    }
  });
}
export function survivalAllPicked() {
  // everyone chose: short countdown instead of waiting out the whole breather
  if (S && S.phase === 'breather') S.phaseTick = Math.max(S.phaseTick, SURV.breatherTicks - SURV.breatherMin);
  survivalRenderPicks(true);
}
// Called when the next wave starts: anyone still undecided gets a random pick.
function survivalClosePicks() {
  const us = window._upgradeState;
  if (us && !us.done) {
    state.players.forEach((p) => { if (!us.picks[p.name]) { const ch = us.choices[p.name] || []; if (ch.length) applyUpgradePick(p, ch[Math.floor(Math.random() * ch.length)]); } });
  }
  window._upgradeState = null;
  survivalRenderPicks(true);
}

// Host-screen pick panel (for the host's own hero) + everyone's pick status. Keys 1/2/3 pick.
function survivalRenderPicks(force) {
  let el = document.getElementById('surv-picks');
  const us = window._upgradeState;
  if (!us || gameMode !== 'survival' || !S) { if (el) el.style.display = 'none'; return; }
  if (!el) {
    el = document.createElement('div'); el.id = 'surv-picks';
    el.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:40;background:rgba(18,15,11,0.94);border:1px solid rgba(184,148,62,0.4);border-radius:8px;padding:10px 14px;text-align:center;font-family:Rajdhani,sans-serif;color:#eee;max-width:min(760px,94vw);box-shadow:0 8px 30px rgba(0,0,0,0.5)';
    document.body.appendChild(el);
  }
  const host = hostPlaying ? state.players[0] : null;
  const hostPicking = !!host && !us.picks[host.name];
  const status = state.players.map((p) => { const pk = us.picks[p.name]; return '<span style="color:' + p.color + '">' + _esc(p.name) + '</span>: <span style="color:' + (pk ? '#7ea879' : '#c49040') + '">' + (pk ? pk.icon + ' ' + _esc(pk.name) : 'picking…') + '</span>'; }).join(' &nbsp;·&nbsp; ');
  const key = (hostPicking ? 'H' : '-') + status;
  if (!force && el.dataset.key === key && el.style.display === 'block') return;
  el.dataset.key = key;
  let html = '<div style="font-size:0.75rem;letter-spacing:0.0625rem;text-transform:uppercase;color:#b8943e;margin-bottom:0.375rem">Wave ' + S.cleared + ' cleared · choose an upgrade' + (hostPicking ? ' (keys 1 · 2 · 3)' : '') + '</div>';
  if (hostPicking) {
    html += '<div style="display:flex;gap:0.5rem;justify-content:center;flex-wrap:wrap;margin-bottom:0.375rem">';
    (us.choices[host.name] || []).forEach((u, i) => {
      html += '<button data-pick="' + i + '" style="background:linear-gradient(180deg,#2a2016,#1a140e);border:1px solid rgba(184,148,62,0.45);color:#eee;padding:0.5em 0.75em;border-radius:6px;cursor:pointer;font-family:inherit;min-width:9.375rem"><div style="font-size:1.125rem">' + u.icon + '</div><div style="font-weight:700;font-size:0.8125rem">' + (i + 1) + '. ' + _esc(u.name) + '</div><div style="font-size:0.6875rem;color:#a89c8a">' + _esc(u.desc) + '</div></button>';
    });
    html += '</div>';
  }
  html += '<div style="font-size:0.6875rem;color:#888">' + status + '</div>';
  el.innerHTML = html;
  el.querySelectorAll('[data-pick]').forEach((b) => { b.onclick = () => pickUpgrade(0, parseInt(b.dataset.pick)); });
  el.style.display = 'block';
}
setInterval(() => { if (typeof gameMode !== 'undefined' && gameMode === 'survival') survivalRenderPicks(false); }, 300);
window.addEventListener('keydown', (e) => {
  if (typeof gameMode === 'undefined' || gameMode !== 'survival' || !window._upgradeState || window._upgradeState.done || !hostPlaying) return;
  const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  const idx = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 }[e.code];
  if (idx == null || window._upgradeState.picks[state.players[0].name]) return;
  e.preventDefault(); e.stopImmediatePropagation(); // don't also trigger "use item"
  pickUpgrade(0, idx);
}, true);

// ───────────────────────────── relics (after each boss wave) ─────────────────────────────
const SURV_RELICS = [
  { id: 'banner', icon: '🚩', name: 'War Banner', desc: 'Everyone +1 damage', apply: () => state.players.forEach((p) => { p.dmgBonus++; }) },
  { id: 'aegis', icon: '🔰', name: 'Aegis', desc: 'Everyone +3 max HP', apply: () => state.players.forEach((p) => { p.maxHp += 3; if (p.hp > 0) p.hp += 3; }) },
  { id: 'phoenix', icon: '🪶', name: 'Phoenix Feather', desc: 'Breathers revive at full HP', apply: () => {} },
  { id: 'hourglass', icon: '⏳', name: 'Hourglass', desc: 'Everyone -1 skill cooldown', apply: () => state.players.forEach((p) => { if (p.cd - (p.cdBonus || 0) > 1) p.cdBonus = (p.cdBonus || 0) + 1; }) },
  { id: 'pact', icon: '🩸', name: 'Blood Pact', desc: 'Every ' + SURV.pactKills + ' kills heal the party 1 HP', apply: () => {} },
  { id: 'ember', icon: '🔥', name: 'Ember Heart', desc: Math.round(SURV.emberChance * 100) + '% of all kills explode', apply: () => {} },
];
function survivalHasRelic(id) { return !!S && S.relics.some((r) => r.id === id); }
function survivalGrantRelic() {
  const left = SURV_RELICS.filter((r) => !survivalHasRelic(r.id));
  if (!left.length) return;
  const r = left[Math.floor(Math.random() * left.length)];
  S.relics.push(r); r.apply();
  showWaveAnnounce('RELIC: ' + r.name.toUpperCase(), r.icon + ' ' + r.desc, 3000);
  combatLog('Relic found: ' + r.icon + ' ' + r.name + ' — ' + r.desc, '#e8c878');
  state.screenFlash = { color: '#b8943e', life: 600, maxLife: 600 };
  doShake(12); state.slowMoTimer = 500; state.slowMoFactor = 2;
  state.players.forEach(p => {
    if (p.hp <= 0 && !p.ghost) return;
    const { x, y } = h2p(p.q, p.r);
    for (let i = 0; i < 12; i++) state.statusParticles.push({ x, y, vx: (Math.random() - 0.5) * 3, vy: -1.5 - Math.random() * 2, color: i % 3 === 0 ? '#e8c878' : '#b8943e', life: 900, maxLife: 900, size: 2 + Math.random() * 2, star: true });
    spawnAoe(p.q, p.r, '#b8943e', HEX * 1.5);
  });
}

// ───────────────────────────── elites ─────────────────────────────
const SURV_ELITES = [
  { id: 'armored', label: 'Armored', color: '#9fb4c8', apply: (e) => { e.hp += 2; e.maxHp += 2; } },
  { id: 'swift', label: 'Swift', color: '#66ddff', apply: (e) => { e._swift = true; } },
  { id: 'explosive', label: 'Explosive', color: '#ff7744', apply: (e) => { e._explosive = true; } },
  { id: 'vampiric', label: 'Vampiric', color: '#ff4488', apply: (e) => { e._vamp = true; } },
];
function survivalMakeElite(e) {
  const pool = SURV_ELITES.slice().sort(() => Math.random() - 0.5);
  const n = S.wave >= SURV.doubleEliteFrom ? 2 : 1;
  pool.slice(0, n).forEach((t) => t.apply(e));
  e.elite = pool[0]; e.name = pool.slice(0, n).map((t) => t.label).join(' ') + ' ' + e.name;
}

// ───────────────────────────── testing helper ─────────────────────────────
// In the host's dev console: survJump(10) skips to wave 10 with matching upgrades and relics.
function survJump(n) {
  if (!S || gameMode !== 'survival') return 'start a Survival run first';
  state.enemies.forEach((e) => { e.hp = 0; }); state.enemies = []; state.entities = state.entities.filter((e) => !e.isEnemy);
  for (let w = S.wave; w < n; w++) {
    state.players.forEach((p) => { const o = survivalOffers(p, 3); if (o.length) { const u = o[0]; u.apply(p); p.upgrades.push(u.icon); } });
    if (w % SURV.bossEvery === 0) survivalGrantRelic();
  }
  S.cleared = n - 1; window._upgradeState = null;
  survivalStartWave(n);
  return 'jumped to wave ' + n;
}
