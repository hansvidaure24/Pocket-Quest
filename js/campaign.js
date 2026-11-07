// Pocket Quest — Campaign flow, transitions, terrain, and stats

import { state } from './state.js';
import { audio } from './audio.js';
import { C, irisWipe } from './canvas.js';
import { combatLog, healEntity, ITEMS, resetComboChain, showWaveAnnounce } from './combat.js';
import {
  activeBiome, BOSSES, buildCampaign, CLASSES, ENEMIES, T_COVER, T_HAZARD, T_LAVA, T_WALL
} from './data.js';
import {
  _occMap, _occRebuild, _terrainMapRebuild, gameMode, GRID_R, HEX, hNbrs, inGrid, isWall, setBoard,
  setGameMode, setGridRadius, SQRT3
} from './hex.js';
import { dedupeNames, hostCustomColor, hostPlaying, setTutorial } from './lobby.js';
import { _hpGhosts } from './render.js';
import { survivalAllPicked } from './survival.js';
import { doShake, initStats, spawnDmg } from './vfx.js';

// === Upgrades ===

const UPGRADES = [
  { name: 'Tempered Steel', icon: '⚔️', desc: '+1 attack damage', apply(p) { p.dmgBonus++; } },
  { name: 'Thick Skin', icon: '🛡', desc: '+2 max HP', apply(p) { p.maxHp += 2; p.hp = Math.min(p.hp + 2, p.maxHp); } },
  { name: 'Swift Hands', icon: '⚡', desc: '-1 skill cooldown', apply(p) { p.cdBonus++; } },
  { name: 'Battle Medic', icon: '💚', desc: 'All allies heal 3 HP', apply(p) { state.players.forEach(pl => { if (pl.hp > 0) pl.hp = Math.min(pl.maxHp, pl.hp + 3); }); } },
  { name: 'Fortify', icon: '🏰', desc: '+1 max HP to all', apply(p) { state.players.forEach(pl => { pl.maxHp++; if (pl.hp > 0) pl.hp++; }); } },
  { name: 'Second Wind', icon: '💨', desc: 'All ghosts revive at 25% HP', apply(p) { state.players.forEach(pl => { if (pl.ghost) { pl.ghost = false; pl.hp = Math.max(1, Math.floor(pl.maxHp * 0.25)); } }); } },
  { name: 'Sharpened', icon: '🗡', desc: '+10% crit chance', apply(p) { p.critBonus = (p.critBonus || 0) + 0.1; } },
  { name: 'Vampiric', icon: '🩸', desc: 'Heal 1 HP on kill', apply(p) { p.vampiric = true; } },
  { name: 'Thorns Aura', icon: '🌹', desc: 'Melee attackers take 1 dmg', apply(p) { p.hasThorns = true; } },
  { name: 'Poison Blade', icon: '🧪', desc: 'Attacks apply 1-tick poison', apply(p) { p.poisonBlade = true; } },
  { name: 'Adrenaline', icon: '💉', desc: 'Skill cooldown resets on kill', apply(p) { p.adrenaline = true; } },
  { name: 'Evasion', icon: '💫', desc: '10% dodge chance', apply(p) { p.dodgeChance = (p.dodgeChance || 0) + 0.1; } },
  { name: 'Berserker', icon: '🔥', desc: '+1 dmg when below 50% HP', apply(p) { p.berserk = true; } },
];

function pickUpgrades(n) {
  const pool = [...UPGRADES];
  const picks = [];
  while (picks.length < n && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    picks.push(pool.splice(i, 1)[0]);
  }
  return picks;
}

// === Narrative ===
export const NARR = {
  combat: [
    { text: 'The air turns cold. Steel scrapes against stone.', sub: 'enemies ahead', icon: '⚔' },
    { text: 'Shadows shift between the pillars. You are not alone.', sub: 'prepare for battle', icon: '⚔' },
    { text: 'A low growl echoes through the chamber.', sub: 'something stirs', icon: '⚔' },
    { text: 'The ground is scarred with old claw marks.', sub: 'this room remembers', icon: '⚔' },
    { text: 'Torchlight catches the gleam of hostile eyes.', sub: 'they see you', icon: '👁' },
    { text: 'The passage narrows. No room to retreat.', sub: 'push forward', icon: '⚔' },
    { text: 'Bones crunch underfoot. The last party wasn\'t lucky.', sub: 'don\'t join them', icon: '💀' },
    { text: 'A distant horn sounds. They know you\'re coming.', sub: 'so be it', icon: '📯' },
    { text: 'The walls hum with old magic. Something guards this place.', sub: 'stand ready', icon: '✦' },
    { text: 'Dried blood on the floor. Still warm.', sub: 'move fast', icon: '🩸' },
  ],
  event: [
    { text: 'A quiet alcove. The dungeon exhales.', sub: 'a moment\'s respite', icon: '✨' },
    { text: 'Firelight flickers from a side passage.', sub: 'something waits', icon: '🔥' },
    { text: 'The walls are carved with old trade runes.', sub: 'merchant territory', icon: '🪙' },
    { text: 'A strange calm settles over the corridor.', sub: 'stay alert', icon: '✨' },
    { text: 'You hear running water. A safe haven, maybe.', sub: 'catch your breath', icon: '💧' },
  ],
  boss: {
    Warlord: { text: '"You\'ll make fine trophies."\nThe ground shakes with each step.', sub: 'the warlord awaits', icon: '👑' },
    Lich: { text: '"Your bones will serve me well."\nThe dead begin to whisper.', sub: 'the lich stirs', icon: '💀' },
    Hydra: { text: '"One head falls. Two more rise."\nAcid drips from the ceiling.', sub: 'the hydra hungers', icon: '🐍' },
    Dragon: { text: '"The air ignites before you see it."\nScales glint in the dark like armored stars.', sub: 'the dragon descends', icon: '🐉' },
    Golem: { text: '"The stone itself has purpose."\nEach footfall cracks the floor.', sub: 'the golem wakes', icon: '🗿' },
  },
  victory: [
    { text: 'Silence falls. The dungeon is yours.', sub: 'victory', icon: '👑' },
    { text: 'Against all odds, you walked out.', sub: 'well fought', icon: '👑' },
    { text: 'The darkness retreats. For now.', sub: 'campaign complete', icon: '👑' },
    { text: 'They said it couldn\'t be done. You weren\'t listening.', sub: 'legends', icon: '👑' },
  ],
  defeat: [
    { text: 'The torches go out, one by one.', sub: 'defeated', icon: '💀' },
    { text: 'The dungeon claims another party.', sub: 'game over', icon: '💀' },
    { text: 'They fought well. It wasn\'t enough.', sub: 'fallen', icon: '💀' },
    { text: 'Silence. Then nothing.', sub: 'the end', icon: '💀' },
  ],
  cleared: [
    { text: 'A brief reprieve. Catch your breath.' },
    { text: 'The room falls still. But the dungeon goes deeper.' },
    { text: 'Wounds mend. Resolve hardens.' },
    { text: 'One step closer to the heart of this place.' },
    { text: 'The echo of battle fades. What lies ahead?' },
  ],
};

function pickNarr(type, bossEntity) {
  if (type === 'boss' && bossEntity) {
    return NARR.boss[bossEntity.name] || NARR.boss.Warlord;
  }
  if (type === 'combat' && activeBiome.narr) {
    const mixed = [...NARR.combat, ...activeBiome.narr.map(t =>
      ({ text: t, sub: activeBiome.name.toLowerCase(), icon: '⚔' }))];
    return mixed[Math.floor(Math.random() * mixed.length)];
  }
  if (type === 'event' && activeBiome.eventNarr) {
    const mixed = [...NARR.event, ...activeBiome.eventNarr.map(t =>
      ({ text: t, sub: activeBiome.name.toLowerCase(), icon: '✨' }))];
    return mixed[Math.floor(Math.random() * mixed.length)];
  }
  const pool = NARR[type] || NARR.combat;
  return pool[Math.floor(Math.random() * pool.length)];
}

let _narrInterval = null, _narrTimeout = null;

export function showNarrative(narr, duration, onDone) {
  const el = document.getElementById('narrative-overlay');
  const textEl = el.querySelector('.narr-text');
  const subEl = el.querySelector('.narr-sub');
  const iconEl = el.querySelector('.narr-icon');
  const lines = el.querySelectorAll('.narr-line');

  if (_narrInterval) { clearInterval(_narrInterval); _narrInterval = null; }
  if (_narrTimeout) { clearTimeout(_narrTimeout); _narrTimeout = null; }

  textEl.innerHTML = '';
  subEl.textContent = '';
  subEl.classList.remove('visible');
  iconEl.textContent = '';
  iconEl.classList.remove('visible');
  lines.forEach(l => l.classList.remove('visible'));
  el.classList.remove('fadeout');
  el.classList.add('show', 'fadein');

  const text = narr.text || '';
  const sub = narr.sub || '';
  const icon = narr.icon || '';

  setTimeout(() => {
    if (icon) { iconEl.textContent = icon; iconEl.classList.add('visible'); }
    lines.forEach(l => l.classList.add('visible'));
  }, 200);

  // typewriter
  let ci = 0;
  const speed = 25;
  _narrInterval = setInterval(() => {
    if (ci < text.length) {
      if (text[ci] === '\n') textEl.innerHTML += '<br>';
      else textEl.innerHTML += text[ci] === '<' ? '&lt;' : text[ci];
      ci++;
      if (ci % 4 === 0) audio.tick(false);
    } else {
      clearInterval(_narrInterval);
      _narrInterval = null;
      setTimeout(() => { subEl.textContent = sub; subEl.classList.add('visible'); }, 150);
    }
  }, speed);

  const totalDur = duration || Math.max(text.length * speed + 1200, 2000);
  _narrTimeout = setTimeout(() => {
    el.classList.add('fadeout');
    setTimeout(() => {
      el.classList.remove('show', 'fadein', 'fadeout');
      if (onDone) onDone();
    }, 450);
  }, totalDur);
}

// === Campaign transitions ===

export function showTransition() {
  const el = document.getElementById('transition-overlay');
  const next = state.CAMPAIGN_NODES[state.campaignNode + 1];
  const healAmt = 2;
  const nextIsEvent = next.type === 'event';
  const lastRating = state.waveRatings[state.waveRatings.length - 1] || '';
  const rCol = { S: '#b8943e', A: '#7ea879', B: '#c49040', C: '#888' }[lastRating] || '#888';
  const flavorLine = (NARR.cleared[Math.floor(Math.random() * NARR.cleared.length)] || {}).text || '';

  let html = `<p style="color:#555;font-size:0.8125rem;font-style:italic;letter-spacing:0.019rem;margin-bottom:0.25rem">"${flavorLine}"</p>`;
  html += `<h2 style="color:#7ea879;text-shadow:0 0 20px rgba(126,168,121,0.3)">ENCOUNTER ${state.campaignNode + 1} CLEARED <span style="color:${rCol};font-size:1.375rem;margin-left:0.625rem;text-shadow:0 0 15px ${rCol}44">${lastRating}</span></h2>`;
  html += `<p style="color:#8a8077">All party members heal ${healAmt} HP</p>`;

  // XP bar
  const xpPct = Math.round(state.partyXP / state.xpToNext * 100);
  html += `<div style="display:flex;align-items:center;gap:0.5rem;justify-content:center;margin:0.25rem 0">
    <span style="color:#b8943e;font-size:0.75rem;letter-spacing:0.0625rem">LV${state.partyLevel}</span>
    <div style="width:100px;height:6px;background:#0f0d0a;border-radius:3px;border:1px solid rgba(184,148,62,0.25);overflow:hidden"><div style="width:${xpPct}%;height:100%;background:linear-gradient(90deg,#b8943e,#b8860b);border-radius:3px"></div></div>
    <span style="color:#888;font-size:0.625rem">${state.partyXP}/${state.xpToNext}</span>
  </div>`;

  // party HP cards
  html += '<div style="display:flex;gap:0.5rem;justify-content:center;margin:0.375rem 0;flex-wrap:wrap">';
  state.players.forEach(p => {
    const hpPct = p.ghost ? 0 : Math.round(p.hp / p.maxHp * 100);
    const col = p.ghost ? '#888' : hpPct > 50 ? '#7ea879' : hpPct > 25 ? '#c49040' : '#c44040';
    const icons = ['⚔', '🔥', '🗡', '✚'];
    html += `<div style="background:linear-gradient(180deg,#1e1a15,#16130f);border:1px solid ${p.color}44;border-radius:4px;padding:0.375rem 0.75rem;min-width:5.625rem;text-align:center">
      <div style="font-size:0.875rem">${icons[p.classIdx] || '?'}</div>
      <div style="color:${p.color};font-weight:700;font-size:0.75rem;letter-spacing:0.031rem">${p.name}</div>
      <div style="color:${col};font-size:0.6875rem">${p.ghost ? 'Ghost' : p.hp + '/' + p.maxHp}</div>
      <div style="width:100%;height:3px;background:#0f0d0a;border-radius:2px;margin-top:0.1875rem"><div style="width:${hpPct}%;height:100%;background:${col};border-radius:2px"></div></div>
      ${p.upgrades.length ? '<div style="font-size:0.5625rem;margin-top:0.125rem">' + p.upgrades.join('') + '</div>' : ''}
    </div>`;
  });
  html += '</div>';

  // campaign map mini-viz
  html += '<div style="display:flex;gap:0.3125rem;justify-content:center;margin:0.5rem 0;align-items:center">';
  for (let i = 0; i < state.campaignTotal; i++) {
    const done = i <= state.campaignNode;
    const cur = i === state.campaignNode + 1;
    const ntype = state.CAMPAIGN_NODES[i].type;
    const icon = ntype === 'boss' ? '⭐' : ntype === 'event' ? '🎁' : '⚔';
    const bg = done ? 'rgba(126,168,121,0.15)' : cur ? 'rgba(196,90,60,0.15)' : 'rgba(20,20,40,0.5)';
    html += `<div style="width:24px;height:24px;clip-path:polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);display:flex;align-items:center;justify-content:center;font-size:0.625rem;background:${bg};filter:${cur ? 'drop-shadow(0 0 6px rgba(196,90,60,0.4))' : done ? 'drop-shadow(0 0 4px rgba(126,168,121,0.2))' : 'none'}">${icon}</div>`;
    if (i < state.campaignTotal - 1)
      html += `<div style="width:14px;height:1px;background:${done ? '#7ea87933' : '#222'}"></div>`;
  }
  html += '</div>';

  // next encounter preview panel
  html += '<div style="background:linear-gradient(180deg,rgba(20,15,35,0.8),rgba(12,10,22,0.8));border:1px solid rgba(140,120,80,0.2);border-radius:6px;padding:0.625rem 1.125rem;margin:0.25rem 0;min-width:16.25rem">';
  if (nextIsEvent) {
    html += `<div style="color:#b8943e;font-weight:700;letter-spacing:0.0625rem;text-transform:uppercase;font-size:0.8125rem">🎁 NEXT: EVENT</div>`;
    html += `<div style="color:#888;font-size:0.6875rem;margin-top:0.125rem">Special encounter — could be a merchant, shrine, chest, or armory</div>`;
  } else if (next.type === 'boss') {
    html += `<div style="color:#c45a3c;font-weight:700;letter-spacing:0.125rem;text-transform:uppercase;font-size:0.9375rem;text-shadow:0 0 12px rgba(196,90,60,0.3)">⚠️ NEXT: BOSS FIGHT</div>`;
    html += `<div style="color:#aaa;font-size:0.6875rem;margin-top:0.25rem">A powerful boss awaits in the ${activeBiome.name}</div>`;
    html += `<div style="color:#c45a3c;font-size:0.625rem;margin-top:0.25rem;letter-spacing:0.031rem">Prepare your upgrades!</div>`;
  } else {
    const numE = state.players.length + (state.campaignNode + 1) + state.difficulty;
    const typeHints = ENEMIES.slice(0, Math.min(3, numE)).map(e =>
      `<span style="color:${e.color}">${e.name}</span>`).join(', ');
    const estDiff = Math.min(100, Math.round(
      (numE / (state.players.length + 1)) * 30 + state.difficulty * 15 + (state.campaignNode + 1) * 8));
    const diffBarCol = estDiff > 70 ? '#c45a3c' : estDiff > 40 ? '#c49040' : '#7ea879';
    const diffLabel = estDiff > 70 ? 'DEADLY' : estDiff > 40 ? 'HARD' : 'FAIR';
    html += `<div style="color:#ccc;font-weight:700;letter-spacing:0.0625rem;text-transform:uppercase;font-size:0.8125rem">⚔ NEXT: ${next.label}</div>`;
    html += `<div style="display:flex;align-items:center;gap:0.375rem;margin:0.25rem 0"><span style="color:${diffBarCol};font-size:0.625rem;letter-spacing:0.031rem;font-weight:700">${diffLabel}</span><div style="flex:1;height:4px;background:#0f0d0a;border-radius:2px;border:1px solid ${diffBarCol}33"><div style="width:${estDiff}%;height:100%;background:${diffBarCol};border-radius:2px"></div></div><span style="color:#666;font-size:0.625rem">~${numE} foes</span></div>`;
    html += `<div style="color:#666;font-size:0.625rem">Types: ${typeHints}…</div>`;
  }
  html += '</div>';

  // per-player upgrade picks
  window._upgradeState = { picks: {}, choices: {}, done: false };
  state.players.forEach(p => {
    window._upgradeState.choices[p.name] = pickUpgrades(3);
    window._upgradeState.picks[p.name] = null;
  });

  const hostUps = window._upgradeState.choices[state.players[0].name];
  html += '<p style="color:#b8943e;margin-top:0.5rem;font-size:0.8125rem">Choose an upgrade:</p>';
  html += '<div style="display:flex;gap:0.625rem;justify-content:center;flex-wrap:wrap;margin:0.375rem 0">';
  hostUps.forEach((u, i) => {
    html += `<button class="upgrade-choice" data-pick="${i}"><div style="font-size:1.375rem">${u.icon}</div><b>${u.name}</b><br><span style="color:#8a8077;font-size:0.6875rem">${u.desc}</span></button>`;
  });
  html += '</div>';
  html += '<div id="upgrade-wait" style="margin-top:0.375rem;font-size:0.6875rem;color:#888"></div>';
  el.innerHTML = html;
  el.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => pickUpgrade(0, Number(b.dataset.pick))));
  el.classList.add('show');

  // heal players
  state.players.forEach(p => {
    if (p.hp > 0) p.hp = Math.min(p.maxHp, p.hp + healAmt);
    if (p.ghost && p.hp <= 0) { p.hp = 1; p.ghost = false; }
  });

  // bots auto-pick after 2s
  setTimeout(() => {
    state.players.forEach(p => {
      if (p.isBot && !window._upgradeState.picks[p.name]) {
        const choices = window._upgradeState.choices[p.name];
        const pick = choices[Math.floor(Math.random() * choices.length)];
        applyUpgradePick(p, pick);
      }
    });
  }, 2000);
  updateUpgradeWait();
}

export function applyUpgradePick(p, u) {
  if (!u || window._upgradeState.picks[p.name]) return;
  window._upgradeState.picks[p.name] = u;
  u.apply(p);
  p.upgrades.push(u.icon);
  spawnDmg(p.q, p.r, u.icon + ' ' + u.name, '#b8943e');
  combatLog(p.name + ' chose: ' + u.name, '#b8943e');
  updateUpgradeWait();
  checkAllUpgradesPicked();
}

export function pickUpgrade(playerIdx, choiceIdx) {
  const p = state.players[playerIdx];
  if (!p) return;
  const us = window._upgradeState;
  if (!us || us.picks[p.name]) return;
  const u = us.choices[p.name][choiceIdx];
  applyUpgradePick(p, u);
}

function updateUpgradeWait() {
  const el = document.getElementById('upgrade-wait');
  if (!el) return;
  const us = window._upgradeState;
  if (!us) return;
  const lines = state.players.map(p => {
    const picked = us.picks[p.name];
    const col = picked ? '#7ea879' : '#c49040';
    const txt = picked ? picked.icon + ' ' + picked.name : 'picking...';
    return `<span style="color:${p.color}">${p.name}</span>: <span style="color:${col}">${txt}</span>`;
  });
  el.innerHTML = lines.join(' &nbsp;·&nbsp; ');
}

function checkAllUpgradesPicked() {
  const us = window._upgradeState;
  if (!us || us.done) return;
  const allPicked = state.players.every(p => us.picks[p.name]);
  if (allPicked && gameMode === 'survival') {
    us.done = true;
    survivalAllPicked();
    return;
  }
  if (allPicked) {
    us.done = true;
    audio.levelup();
    setTimeout(advanceCampaign, 600);
  }
}

function advanceCampaign() {
  irisWipe({ speed: 0.004, color: '#000', hold: 100, onMid: () => {
    document.getElementById('transition-overlay').classList.remove('show');
    state.campaignNode++;
    state.totalTicks += state.tickCount;
    spawnNode(state.campaignNode);
    const allLiving = state.entities.filter(e => e.hp > 0);
    if (allLiving.length > 0) {
      let avgQ = 0, avgR = 0;
      allLiving.forEach(e => { avgQ += e.q; avgR += e.r; });
      avgQ /= allLiving.length;
      avgR /= allLiving.length;
      state.camOffX = -HEX * (SQRT3 * avgQ + SQRT3 / 2 * avgR);
      state.camOffY = -HEX * 1.5 * avgR;
    }
    updateCampaignBar();
  }});
}

function updateCampaignBar() {
  let html = '';
  const icons = { combat: '⚔', boss: '⭐', event: '🎁' };
  const rCols = { S: '#b8943e', A: '#7ea879', B: '#c49040', C: '#888' };
  for (let i = 0; i < state.campaignTotal; i++) {
    const cls = i < state.campaignNode ? 'done' : i === state.campaignNode ? 'active' : '';
    const boss = state.CAMPAIGN_NODES[i].type === 'boss' ? 'boss' : '';
    const rating = state.waveRatings[i];
    const icon = i < state.campaignNode ? (rating || '✓') : icons[state.CAMPAIGN_NODES[i].type] || i + 1;
    const rStyle = rating ? `color:${rCols[rating] || '#888'}` : '';
    html += `<div class="enc-dot ${cls} ${boss}" ${rStyle ? `style="${rStyle}"` : ''} title="Enc ${i + 1}${rating ? ' — ' + rating + ' rank' : ''}">${icon}</div>`;
    if (i < state.campaignTotal - 1) {
      const connCol = i < state.campaignNode ? '#7ea87944' : '#222';
      html += `<div style="width:16px;height:2px;background:${connCol};border-radius:1px;flex-shrink:0"></div>`;
    }
  }
  document.getElementById('campaign-bar').innerHTML = html;
}

// === Spawn logic ===

export function generateTerrain(nodeType) {
  state.terrain = [];
  const cands = [];
  for (let q = -GRID_R; q <= GRID_R; q++) {
    for (let r = -GRID_R; r <= GRID_R; r++) {
      if (!inGrid(q, r) || Math.abs(r) >= GRID_R - 1 || (!q && !r)) continue;
      cands.push({ q, r });
    }
  }
  for (let i = cands.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cands[i], cands[j]] = [cands[j], cands[i]];
  }

  const enc = state.campaignNode || 0;
  let w, h, cv, lv;

  // terrain counts by node type (mutually exclusive)
  switch (nodeType) {
    case 'boss':
      w = 4 + Math.floor(Math.random() * 2);
      h = 1; cv = 1;
      lv = 2 + Math.floor(Math.random() * 2);
      break;
    case 'event':
      w = 1 + Math.floor(Math.random() * 2);
      h = 0;
      cv = 3 + Math.floor(Math.random() * 2);
      lv = 0;
      break;
    default:
      w = 2 + Math.floor(Math.random() * 3) + Math.floor(enc * 0.5);
      h = 1 + Math.floor(Math.random() * 2) + Math.floor(enc * 0.5);
      cv = 1 + Math.floor(Math.random() * 2) + Math.floor(enc * 0.3);
      lv = enc >= 2 ? Math.floor(Math.random() * 2) + 1 : 0;
  }

  // biome terrain modifiers
  switch (activeBiome.name) {
    case 'Volcano': lv += 2; h += 1; break;
    case 'Swamp':   h += 2; cv += 1; lv = 0; break;
    case 'Ruins':   w += 2; cv += 1; break;
    case 'Crypt':   w += 1; break;
  }

  let idx = 0;
  for (let i = 0; i < w && idx < cands.length; i++, idx++) state.terrain.push({ ...cands[idx], type: T_WALL });
  for (let i = 0; i < h && idx < cands.length; i++, idx++) state.terrain.push({ ...cands[idx], type: T_HAZARD });
  for (let i = 0; i < cv && idx < cands.length; i++, idx++) state.terrain.push({ ...cands[idx], type: T_COVER });
  for (let i = 0; i < lv && idx < cands.length; i++, idx++) state.terrain.push({ ...cands[idx], type: T_LAVA });
  _terrainMapRebuild();
}

function biomeEnemyIdx() {
  const pool = activeBiome.enemyPool || [];
  return pool.length
    ? pool[Math.floor(Math.random() * pool.length)]
    : Math.floor(Math.random() * ENEMIES.length);
}

export function biomeBossIdx(nodeIdx) {
  const pool = activeBiome.bossPool || [];
  return pool.length
    ? pool[Math.floor(Math.random() * pool.length)]
    : nodeIdx % BOSSES.length;
}

export function spawnNode(nodeIdx) {
  state.enemies = [];
  state.entities = state.entities.filter(e => !e.isEnemy);
  state.tickCount = 0;
  state.gameOver = false;
  state.damageNumbers = [];
  state.flashEffects = [];
  state.projectiles = [];
  state.deathEffects = [];
  state.aoeEffects = [];
  state.trailEffects = [];
  state.statusParticles = [];
  state.killStreak = 0;
  state.lastKillTick = 0;
  state.killFeed = [];
  state.dpsTicks = [];
  state.dpsDisplay = 0;
  state.encDmgTaken = 0;
  resetComboChain();
  _hpGhosts.clear();
  state.msg = '';
  state.msgTimer = 0;

  const nodeType = state.CAMPAIGN_NODES[nodeIdx].type;
  setGridRadius(nodeType === 'boss' ? 5 : 3 + Math.floor(Math.random() * 2));
  generateTerrain(nodeType);

  // reset player positions
  const sr = GRID_R - 1;
  const spawns = [{ q: -1, r: sr }, { q: 0, r: sr }, { q: 1, r: sr }, { q: -1, r: sr - 1 }];
  state.players.forEach((p, i) => {
    const sp = spawns[i % spawns.length];
    p.q = sp.q; p.r = sp.r;
    p.prevQ = sp.q; p.prevR = sp.r;
    p.cdTimer = 0;
  });

  const node = state.CAMPAIGN_NODES[nodeIdx];
  const numP = state.players.length;
  const er = -sr;
  const eSpawns = [
    { q: -1, r: er }, { q: 0, r: er }, { q: 1, r: er },
    { q: -1, r: er + 1 }, { q: 0, r: er + 1 }, { q: 1, r: er + 1 }
  ];

  // spawn enemies by node type (mutually exclusive)
  switch (node.type) {
    case 'boss': {
      const bdef = BOSSES[biomeBossIdx(nodeIdx)];
      const bossHp = bdef.hp + state.difficulty * 4;
      state.enemies.push({
        name: bdef.name, hp: bossHp, maxHp: bossHp, color: bdef.color,
        q: 0, r: er, prevQ: 0, prevR: er,
        isEnemy: true, ai: bdef.ai, isBoss: true,
        charging: false, shootTimer: 0,
        telegraph: false, telegraphTarget: null,
        bossTimer: 0, spawnTick: 0
      });
      const mCount = [1, 2, 3][state.difficulty] || 2;
      for (let i = 0; i < mCount; i++) {
        const di = biomeEnemyIdx();
        const def = ENEMIES[di];
        const sp = eSpawns.filter(s => !(s.q === 0 && s.r === er))[i];
        const hpScale = def.hp + Math.floor(nodeIdx * 0.5);
        state.enemies.push({
          name: def.name, hp: hpScale, maxHp: hpScale, color: def.color,
          q: sp.q, r: sp.r, prevQ: sp.q, prevR: sp.r,
          isEnemy: true, ai: def.ai,
          charging: false, shootTimer: 0,
          telegraph: false, telegraphTarget: null, spawnTick: 0
        });
      }
      break;
    }

    case 'event': {
      let shrineCursed = false;
      const eventRoll = Math.random();

      if (eventRoll < 0.45) {
        // Merchant
        state.players.forEach(p => {
          if (p.hp > 0) {
            healEntity(p, 3, null);
            if (!p.item) {
              p.item = ITEMS[Math.floor(Math.random() * ITEMS.length)];
              combatLog(p.name + ' received ' + p.item.icon + ' ' + p.item.name, '#b8943e');
            }
          }
        });
        showWaveAnnounce('MERCHANT', 'heal + free items', 2000);
      } else if (eventRoll < 0.75) {
        // Shrine
        const blessed = Math.random() < 0.5;
        if (blessed) {
          state.players.forEach(p => { if (p.hp > 0) healEntity(p, p.maxHp, null); });
          audio.heal();
          showWaveAnnounce('BLESSED', 'full heal', 2000);
        } else {
          audio.stun();
          showWaveAnnounce('CURSED', 'extra enemies incoming', 2000);
          shrineCursed = true;
        }
      } else if (eventRoll < 0.88) {
        // Chest
        const alive = state.players.filter(p => p.hp > 0);
        if (alive.length) {
          let lucky = alive.find(a => !a.item) || alive[Math.floor(Math.random() * alive.length)];
          lucky.item = ITEMS[Math.floor(Math.random() * ITEMS.length)];
          spawnDmg(lucky.q, lucky.r, lucky.item.icon + ' CHEST', '#b8943e');
          audio.loot();
          showWaveAnnounce('CHEST', lucky.name + ' — ' + lucky.item.icon + ' ' + lucky.item.name, 1800);
          combatLog(lucky.name + ' opened chest: ' + lucky.item.icon + ' ' + lucky.item.name, '#b8943e');
          state.players.forEach(p => { if (p.hp > 0) healEntity(p, 2, null); });
        }
      } else {
        // Armory
        state.players.forEach(p => {
          const u = pickUpgrades(1)[0];
          u.apply(p);
          p.upgrades.push(u.icon);
          spawnDmg(p.q, p.r, u.icon + ' ' + u.name, '#b8943e');
          combatLog(p.name + ' found ' + u.name + ' in the armory!', '#b8943e');
        });
        audio.loot();
        audio.levelup();
        showWaveAnnounce('ARMORY', 'free upgrades', 2000);
      }

      const numE = Math.max(2, numP) + state.difficulty + (shrineCursed ? 2 : 0);
      for (let i = 0; i < numE; i++) {
        const di = biomeEnemyIdx();
        const def = ENEMIES[di];
        let sp = eSpawns[i % eSpawns.length];
        if (_occMap.has(sp.q + ',' + sp.r)) {
          const alt = hNbrs(sp.q, sp.r).find(n =>
            inGrid(n.q, n.r) && !isWall(n.q, n.r) && !_occMap.has(n.q + ',' + n.r));
          if (alt) sp = alt;
        }
        state.enemies.push({
          name: def.name, hp: def.hp, maxHp: def.hp, color: def.color,
          q: sp.q, r: sp.r, prevQ: sp.q, prevR: sp.r,
          isEnemy: true, ai: def.ai,
          charging: false, shootTimer: 0,
          telegraph: false, telegraphTarget: null, spawnTick: 0
        });
      }
      break;
    }

    default: {
      // regular combat
      const numE = Math.max(2, numP + Math.ceil(Math.sqrt(nodeIdx + 1) * 1.5) + Math.floor(state.difficulty * 0.7));
      const typeCounts = {};
      for (let i = 0; i < numE; i++) {
        let di, attempts = 0;
        do { di = biomeEnemyIdx(); attempts++; }
        while ((typeCounts[di] || 0) >= 2 && attempts < 20);
        typeCounts[di] = (typeCounts[di] || 0) + 1;

        const def = ENEMIES[di];
        let sp = eSpawns[i % eSpawns.length];
        if (_occMap.has(sp.q + ',' + sp.r)) {
          const alt = hNbrs(sp.q, sp.r).find(n =>
            inGrid(n.q, n.r) && !isWall(n.q, n.r) && !_occMap.has(n.q + ',' + n.r));
          if (alt) sp = alt;
        }
        const isElite = state.difficulty >= 2 && Math.random() < 0.3;
        const hpScale = def.hp + Math.floor(nodeIdx * 0.7) + (isElite ? 3 : 0);
        const eName = isElite ? 'Elite ' + def.name : def.name;
        state.enemies.push({
          name: eName, hp: hpScale, maxHp: hpScale, color: def.color,
          q: sp.q, r: sp.r, prevQ: sp.q, prevR: sp.r,
          isEnemy: true, ai: def.ai,
          charging: false, shootTimer: 0,
          telegraph: false, telegraphTarget: null,
          spawnTick: state.tickCount, isElite
        });
      }
    }
  }

  state.entities = [...state.players, ...state.enemies];
  _occRebuild();
  state.tickMs = parseInt(document.getElementById('speed-sel').value);
  state.originalTickMs = state.tickMs;
  state.tempoTicks = 0;
  state.tickTimer = 0;
  state.running = true;
  state.paused = true;

  const node2 = state.CAMPAIGN_NODES[nodeIdx];
  const _startCountdown = () => {
    state.countdownTimer = 1800;
    state.countdownText = '3';
    audio.tick(false);
    setTimeout(() => { state.countdownText = '2'; audio.tick(false); }, 600);
    setTimeout(() => { state.countdownText = '1'; audio.tick(true); }, 1200);
    setTimeout(() => {
      state.countdownText = 'GO!';
      state.paused = false;
      audio.skill();
      state.screenFlash = { color: '#7ea879', life: 200, maxLife: 200 };
      doShake(4);
      for (let i = 0; i < 20; i++) {
        state.statusParticles.push({
          x: C.width / 2 + (Math.random() - 0.5) * C.width * 0.6,
          y: C.height / 2 + (Math.random() - 0.5) * C.height * 0.4,
          vx: (Math.random() - 0.5) * 3, vy: -1 - Math.random() * 2,
          color: ['#7ea879', '#b8943e', '#6b8cae'][i % 3],
          life: 500 + Math.random() * 300, maxLife: 800,
          size: 2 + Math.random() * 2
        });
      }
    }, 1800);
    setTimeout(() => { state.countdownText = ''; }, 2400);
  };

  const _narr = pickNarr(node2.type, state.enemies.find(e => e.isBoss));
  showNarrative(_narr, node2.type === 'boss' ? 3500 : null, _startCountdown);

  // wave announcement by type (mutually exclusive)
  switch (node2.type) {
    case 'boss': {
      const bname = state.enemies.find(e => e.isBoss)?.name || 'BOSS';
      audio.stun();
      audio.setBossDrone(true);
      state.waveLabel = bname;
      state.waveLabelTimer = 6000;
      showWaveAnnounce('BOSS FIGHT', bname, 3000);
      combatLog(`BOSS: ${bname} (${state.enemies.find(e => e.isBoss)?.maxHp} HP) + ${state.enemies.length - 1} minions`, '#c45a3c');
      break;
    }
    case 'combat': {
      const totalEHp = state.enemies.reduce((s, e) => s + e.maxHp, 0);
      const totalPHp = state.players.reduce((s, p) => s + p.maxHp, 0);
      const ratio = totalEHp / Math.max(1, totalPHp);
      const threat = ratio > 2 ? 'Deadly' : ratio > 1.2 ? 'Hard' : ratio > 0.7 ? 'Fair' : 'Easy';
      const types = state.enemies.map(e => e.ai);
      const waveName =
        types.filter(t => t === 'charger').length >= 2 ? 'Stampede' :
        types.filter(t => t === 'splasher').length >= 2 ? 'Volatile Pack' :
        types.filter(t => t === 'glasscannon').length >= 2 ? 'Firing Squad' :
        types.includes('healer') && types.includes('tank') ? 'Fortified' :
        types.filter(t => t === 'mimic').length >= 2 ? 'Mirror Match' :
        types.filter(t => t === 'bomber').length >= 2 ? 'Minefield' :
        types.includes('assassin') ? 'Ambush' :
        types.includes('summoner') ? 'Horde' :
        types.filter(t => t === 'shieldbearer').length >= 2 ? 'Phalanx' : 'Skirmish';
      const eliteCount = state.enemies.filter(e => e.isElite).length;
      const eliteTxt = eliteCount ? ` (${eliteCount} elite)` : '';
      state.waveLabel = waveName;
      state.waveLabelTimer = 6000;
      showWaveAnnounce(`WAVE ${nodeIdx + 1}`, `${waveName} — ${state.enemies.length} enemies${eliteTxt}`, 2500);
      const comp = {};
      state.enemies.forEach(e => { comp[e.name] = (comp[e.name] || 0) + 1; });
      combatLog(
        `Wave ${nodeIdx + 1}: ${Object.entries(comp).map(([n, c]) => c > 1 ? c + 'x ' + n : n).join(', ')} [${threat}]`,
        '#888'
      );
      break;
    }
    default:
      state.waveLabel = 'Event';
      state.waveLabelTimer = 3000;
      combatLog('Event encounter', '#b8943e');
  }
}

export function startCampaign() {
  setGameMode('campaign');
  setBoard(null);
  state.entities = [];
  state.players = [];
  state.enemies = [];
  state.pendingInput = null;
  state.tickCount = 0;
  state.totalTicks = 0;
  state.gameOver = false;
  state.paused = false;
  state.damageNumbers = [];
  state.flashEffects = [];
  state.projectiles = [];
  state.deathEffects = [];
  state.aoeEffects = [];
  state.trailEffects = [];
  window._upgradeState = null;

  document.getElementById('transition-overlay').classList.remove('show');
  document.getElementById('stats-overlay').classList.remove('show');
  document.getElementById('pause-overlay').classList.remove('show');
  document.getElementById('narrative-overlay').classList.remove('show', 'fadein', 'fadeout');
  if (_narrInterval) { clearInterval(_narrInterval); _narrInterval = null; }
  if (_narrTimeout) { clearTimeout(_narrTimeout); _narrTimeout = null; }

  state.msg = '';
  state.msgTimer = 0;
  document.getElementById('input-indicator').textContent = '';
  state.campaignNode = 0;
  state.campaignActive = true;
  setTutorial(false);
  state.difficulty = parseInt(document.getElementById('diff-sel').value);
  buildCampaign(parseInt(document.getElementById('length-sel').value));
  state.combatLogLines = [];
  document.getElementById('combat-log').innerHTML = '';
  state.partyXP = 0;
  state.partyLevel = 1;
  state.xpToNext = 5;
  state.perfectClears = 0;
  state.waveRatings = [];

  const numP = parseInt(document.getElementById('player-sel').value);
  const hc = parseInt(document.getElementById('class-sel').value);
  const hl = parseInt(document.getElementById('loadout-sel').value);
  const spawns = [{ q: -1, r: 0 }, { q: 0, r: 0 }, { q: 1, r: 0 }, { q: -1, r: 1 }];

  const roster = [];
  const hostName = document.getElementById('host-name').value.trim().toUpperCase() || null;
  if (hostPlaying) {
    roster.push({
      classIdx: hc, loadout: hl, isBot: false,
      controllerId: null, name: hostName, customColor: hostCustomColor
    });
  }

  const startIdx = hostPlaying ? 1 : 0;
  for (let i = startIdx; i < numP; i++) {
    if (roster.length >= numP) break;
    const lp = state.lobbyPlayers.find(p => !p.isLocal && !roster.some(r => r.controllerId === p.id));
    if (lp) {
      roster.push({
        classIdx: lp.classIdx || 0, loadout: lp.loadout || 0,
        isBot: false, controllerId: lp.id,
        name: lp.name, customColor: lp.customColor || null
      });
    } else {
      const usedCi = roster.map(r => r.classIdx);
      let ci = 0;
      for (let j = 0; j < 4; j++) { if (!usedCi.includes(j)) { ci = j; break; } }
      roster.push({
        classIdx: ci, loadout: Math.floor(Math.random() * 2),
        isBot: true, controllerId: null, name: null, customColor: null
      });
    }
  }

  state.controllerSlots = {};
  for (let i = 0; i < roster.length; i++) {
    const r = roster[i];
    const cls = CLASSES[r.classIdx];
    const sp = spawns[i];
    const p = {
      name: r.name || cls.name,
      hp: cls.hp, maxHp: cls.hp,
      color: r.customColor || cls.color,
      q: sp.q, r: sp.r, prevQ: sp.q, prevR: sp.r,
      isEnemy: false, classIdx: r.classIdx,
      ability: cls.ability, cd: cls.cd, cdTimer: 0,
      ghost: false, isBot: r.isBot,
      dmgBonus: 0, cdBonus: 0, upgrades: []
    };
    cls.loadouts[r.loadout].apply(p);
    p.loadout = cls.loadouts[r.loadout].name;
    if (r.controllerId) state.controllerSlots[r.controllerId] = i;
    state.players.push(p);
  }

  dedupeNames(state.players);
  initStats();
  updateCampaignBar();
  spawnNode(0);

  // snap camera to player spawn positions
  const allLiving = state.entities.filter(e => e.hp > 0);
  if (allLiving.length > 0) {
    let avgQ = 0, avgR = 0;
    allLiving.forEach(e => { avgQ += e.q; avgR += e.r; });
    avgQ /= allLiving.length;
    avgR /= allLiving.length;
    state.camOffX = -HEX * (SQRT3 * avgQ + SQRT3 / 2 * avgR);
    state.camOffY = -HEX * 1.5 * avgR;
  }
  audio.startDrone();
  document.getElementById('restart-btn').style.display = '';
}
