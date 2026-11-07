// === Stats screen ===

import { state } from './state.js';
import { spawnNode } from './campaign.js';
import { C, irisWipe } from './canvas.js';
import { activeBiome, BOSSES, CLASSES, ENEMIES, T_COVER, T_HAZARD, T_LAVA, T_WALL } from './data.js';
import { _occMap, gameMode, hDist, hNbrs, inGrid, isPassable, p2h, terrainAt } from './hex.js';
import { goToLobby, hostPlaying, playAgain, restartRun } from './lobby.js';
import { updatePauseInfo } from './render.js';
import { survivalResultsHeader } from './survival.js';

export function showStats() {
  state.gamePhase = 'results';
  const box = document.getElementById('stats-box');
  const won = gameMode !== 'survival' && state.campaignNode >= state.campaignTotal - 1 && state.enemies.every(e => e.hp <= 0);
  const diffNames = ['Easy', 'Normal', 'Hard'];
  if (gameMode === 'survival') { showStatsBody(box, survivalResultsHeader()); return; }

  let html = `<h2 style="color:${won ? '#7ea879' : '#c45a3c'};text-shadow:0 0 20px ${won ? 'rgba(126,168,121,0.3)' : 'rgba(196,90,60,0.3)'}">${won ? 'CAMPAIGN VICTORY' : 'CAMPAIGN FAILED'}</h2>`;
  html += `<p style="color:#8a7e6e;font-size:0.6875rem;margin-bottom:0.25rem;letter-spacing:0.0625rem;text-transform:uppercase">${activeBiome.name} · ${diffNames[state.difficulty] || 'Normal'} · ${state.players.length} players</p>`;

  const perfTxt = state.perfectClears > 0 ? ` · ${state.perfectClears} Perfect Clear${state.perfectClears > 1 ? 's' : ''}!` : '';
  const totalT = state.totalTicks + state.tickCount;
  const campSec = Math.floor(totalT * state.tickMs / 1000);
  const campMin = Math.floor(campSec / 60);
  const campSecR = campSec % 60;
  const campTime = campMin > 0 ? `${campMin}:${String(campSecR).padStart(2, '0')}` : `${campSecR}s`;
  const ratingSummary = state.waveRatings.length
    ? '  Waves: ' + state.waveRatings.map(r => `<span style="color:${{ S: '#b8943e', A: '#7ea879', B: '#c49040', C: '#888' }[r]}">${r}</span>`).join(' ')
    : '';

  html += `<p style="margin-bottom:0.5rem;color:#888">${campTime} · ${totalT} ticks · ${state.campaignNode + (won ? 1 : 0)}/${state.campaignTotal} cleared · Lv${state.partyLevel}${perfTxt}</p>`;
  if (ratingSummary) html += `<p style="font-size:0.6875rem">${ratingSummary}</p>`;

  const sCount = state.waveRatings.filter(r => r === 'S').length;
  const aCount = state.waveRatings.filter(r => r === 'A').length;
  const campGrade = won && sCount >= Math.ceil(state.campaignTotal * 0.7) ? 'S'
    : won && (sCount + aCount) >= Math.ceil(state.campaignTotal * 0.5) ? 'A'
    : won ? 'B'
    : state.campaignNode >= Math.ceil(state.campaignTotal * 0.5) ? 'C' : 'D';
  const gradeCol = { S: '#b8943e', A: '#7ea879', B: '#c49040', C: '#888', D: '#c45a3c' }[campGrade];

  html += `<div style="margin:0.5rem auto;font-size:3.25rem;font-weight:900;color:${gradeCol};text-shadow:0 0 30px ${gradeCol}44;letter-spacing:0.25rem;line-height:1">${campGrade}</div>`;
  html += `<div style="font-size:0.625rem;color:#555;letter-spacing:0.0625rem;text-transform:uppercase;margin-bottom:0.25rem">Campaign Rating</div>`;
  showStatsBody(box, html, { won, totalT, campTime });
}

function showStatsBody(box, html, o) {
  o = o || {};
  const won = !!o.won, totalT = o.totalT || 0, campTime = o.campTime || '';
  const titles = [];

  let maxDmg = 0, maxDmgN = '', maxHeals = 0, maxHealsN = '';
  let maxKills = 0, maxKillsN = '', maxMoved = 0, maxMovedN = '';
  let firstDeath = Infinity, firstDeathN = '', maxGhost = 0, maxGhostN = '';
  let minTaken = Infinity, minTakenN = '';

  for (const [name, s] of Object.entries(state.stats)) {
    if (s.dmgDealt > maxDmg) { maxDmg = s.dmgDealt; maxDmgN = name; }
    if (s.heals > maxHeals) { maxHeals = s.heals; maxHealsN = name; }
    if (s.kills > maxKills) { maxKills = s.kills; maxKillsN = name; }
    if (s.moved > maxMoved) { maxMoved = s.moved; maxMovedN = name; }
    if (s.diedAt > 0 && s.diedAt < firstDeath) { firstDeath = s.diedAt; firstDeathN = name; }
    if (s.ghostTicks > maxGhost) { maxGhost = s.ghostTicks; maxGhostN = name; }
    if (s.dmgTaken < minTaken) { minTaken = s.dmgTaken; minTakenN = name; }
  }

  if (maxDmgN) titles.push(['🏆 MVP', maxDmgN, maxDmg + ' dmg']);
  if (firstDeathN) titles.push(['💀 Glass Jaw', firstDeathN, 'tick ' + firstDeath]);
  if (maxHealsN && maxHeals > 0) titles.push(['💚 Medic', maxHealsN, maxHeals + ' HP']);
  if (maxKillsN && maxKills > 0) titles.push(['⚔ Executioner', maxKillsN, maxKills + ' kills']);
  if (maxMovedN) titles.push(['🏃 Speedrunner', maxMovedN, maxMoved + ' hex']);
  if (maxGhostN && maxGhost > 0) titles.push(['👻 Ghost Carry', maxGhostN, maxGhost + ' ticks']);
  if (minTakenN) titles.push(['🛡 Untouchable', minTakenN, minTaken + ' taken']);

  let maxOverkill = 0, maxOverkillN = '';
  for (const [name, s] of Object.entries(state.stats)) {
    if (s.overkill > maxOverkill) { maxOverkill = s.overkill; maxOverkillN = name; }
  }
  if (maxOverkillN && maxOverkill > 2) titles.push(['💥 Overkill', maxOverkillN, maxOverkill + ' wasted dmg']);
  if (won && totalT <= 40) titles.push(['⚡ Speedrun', 'Party', campTime]);
  if (won && state.perfectClears >= 2) titles.push(['💎 Flawless', 'Party', state.perfectClears + ' perfect clears']);

  html += '<div style="display:flex;flex-wrap:wrap;gap:0.5rem;justify-content:center;margin:0.5rem 0">';
  titles.forEach(([title, who, detail]) => {
    html += `<div style="background:linear-gradient(180deg,#1e1a15,#16130f);border:1px solid rgba(140,120,80,0.3);border-radius:6px;padding:0.5rem 0.875rem;min-width:6.875rem;text-align:center"><div style="color:#b8943e;font-size:0.6875rem;letter-spacing:0.0625rem;text-transform:uppercase">${title}</div><div style="color:#eee;font-size:0.8125rem;font-weight:700">${who}</div><div style="color:#8a7e6e;font-size:0.625rem">${detail}</div></div>`;
  });
  html += '</div>';

  html += '<div style="width:100%;height:1px;background:linear-gradient(90deg,transparent,rgba(140,120,80,0.3),transparent);margin:0.75rem 0"></div>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0.5rem;width:100%">';

  for (const [name, s] of Object.entries(state.stats)) {
    const p = state.players.find(p => p.name === name);
    const c = p ? p.color : '#888';
    const upIcons = p && p.upgrades && p.upgrades.length ? p.upgrades.join(' ') : '—';
    const isMVP = name === maxDmgN;
    const cIcons = ['⚔', '🔥', '🗡', '✚'];
    const pTicks = s.diedAt > 0 ? s.diedAt : (state.totalTicks + state.tickCount);
    const dpt = pTicks > 0 ? (s.dmgDealt / pTicks).toFixed(1) : '0';

    html += `<div style="background:linear-gradient(180deg,rgba(20,18,46,0.9),rgba(12,10,26,0.9));border:1px solid ${isMVP ? 'rgba(184,148,62,0.35)' : 'rgba(140,120,80,0.2)'};border-radius:5px;padding:0.625rem;text-align:left${isMVP ? ';box-shadow:0 0 12px rgba(184,148,62,0.08)' : ''}">`;
    html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.375rem"><span style="color:${c};font-weight:700;font-size:0.9375rem;letter-spacing:0.031rem">${name}</span>${isMVP ? '<span style="font-size:0.5625rem;color:#b8943e;letter-spacing:0.0625rem">MVP</span>' : ''}</div>`;
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.125rem 0.5rem;font-size:0.6875rem">`;
    html += `<div style="color:#888">⚔ <span style="color:#ccc">${s.dmgDealt}</span> dmg</div>`;
    html += `<div style="color:#888">💀 <span style="color:#ccc">${s.kills}</span> kills</div>`;
    html += `<div style="color:#888">💚 <span style="color:#ccc">${s.heals}</span> healed</div>`;
    html += `<div style="color:#888">🩸 <span style="color:#ccc">${s.dmgTaken}</span> taken</div>`;
    html += `<div style="color:#666">📊 <span style="color:#aaa">${dpt}</span> dpt</div>`;
    html += `<div style="color:#666">🏃 <span style="color:#aaa">${s.moved}</span> moved</div>`;
    html += `</div>`;
    html += `<div style="margin-top:0.25rem;font-size:0.625rem;color:#555">${p ? cIcons[p.classIdx] + ' ' : ''}${upIcons}</div>`;
    html += `</div>`;
  }
  html += '</div>';

  html += '<div style="display:flex;gap:0.625rem;justify-content:center;flex-wrap:wrap">';
  html += '<button class="gbtn gbtn-primary" data-action="play-again">Play Again</button>';
  html += '<button class="gbtn" data-action="close-stats">Back to Lobby</button></div>';
  box.innerHTML = html;
  box.querySelector('[data-action="play-again"]').addEventListener('click', playAgain);
  box.querySelector('[data-action="close-stats"]').addEventListener('click', closeStats);
  document.getElementById('stats-overlay').classList.add('show');
}

function closeStats() {
  irisWipe({
    speed: 0.005, color: '#000', hold: 80,
    onMid: () => {
      document.getElementById('stats-overlay').classList.remove('show');
      goToLobby();
    }
  });
}

// === Input: WASD with combos for diagonals ===
const _held = new Set();
const DIR_LABELS = { '0,-1': '↖', '0,1': '↘', '-1,0': '←', '1,0': '→', '1,-1': '↗', '-1,1': '↙' };

function _heldDir() {
  const w = _held.has('KeyW'), a = _held.has('KeyA');
  const s = _held.has('KeyS'), d = _held.has('KeyD');
  if (w && d) return { dq: 1, dr: -1 };
  if (s && a) return { dq: -1, dr: 1 };
  if (w && a) return { dq: -1, dr: 0 };
  if (s && d) return { dq: 1, dr: 0 };
  if (w) return { dq: 0, dr: -1 };
  if (s) return { dq: 0, dr: 1 };
  if (a) return { dq: -1, dr: 0 };
  if (d) return { dq: 1, dr: 0 };
  return null;
}

document.addEventListener('keydown', e => {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

  if (e.code === 'KeyH') {
    state.showHelp = !state.showHelp;
    document.getElementById('help-overlay').style.display = state.showHelp ? 'flex' : 'none';
    e.preventDefault();
    return;
  }
  if (e.code === 'KeyL') {
    const cl = document.getElementById('combat-log-wrap');
    cl.style.display = cl.style.display === 'none' ? '' : 'none';
    e.preventDefault();
    return;
  }
  if ((e.code === 'KeyP' || e.code === 'Escape') && state.running) {
    state.paused = !state.paused;
    const po = document.getElementById('pause-overlay');
    po.classList.toggle('show', state.paused);
    if (state.paused) updatePauseInfo();
    e.preventDefault();
    return;
  }
  if (e.code === 'KeyR' && state.running && !state.gameOver) {
    if (gameMode === 'survival') {
      if (state.paused) { restartRun(); e.preventDefault(); }
      return;
    }
    irisWipe({ speed: 0.006, color: '#000', hold: 60, onMid: () => spawnNode(state.campaignNode) });
    e.preventDefault();
    return;
  }

  if (!state.running || state.gameOver || state.paused) return;
  if (!hostPlaying) return;
  state.keyHintShown = true;
  const indEl = document.getElementById('input-indicator');

  if (e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD') {
    _held.add(e.code);
    const dir = _heldDir();
    if (dir) {
      state.pendingInput = dir;
      e.preventDefault();
      indEl.innerHTML = `<span style="color:#7ea879">↗ Move ${DIR_LABELS[dir.dq + ',' + dir.dr] || ''}</span>`;
    }
  }
  if (e.code === 'Space') {
    state.pendingInput = 'attack';
    e.preventDefault();
    indEl.innerHTML = '<span style="color:#c45a3c">⚔ Attack</span>';
  }
  if (e.code === 'KeyF') {
    state.pendingInput = 'skill';
    state.skillPreview = true;
    e.preventDefault();
    indEl.innerHTML = `<span style="color:#6b8cae">✦ ${state.players[0]?.ability || 'Skill'}</span>`;
  }
  if (e.code === 'KeyG') {
    state.pendingInput = 'defend';
    e.preventDefault();
    indEl.innerHTML = '<span style="color:#607a90">🛡 Defend</span>';
  }
  if (e.code === 'Digit1') {
    state.pendingInput = 'item';
    e.preventDefault();
    indEl.innerHTML = `<span style="color:#b8943e">📦 Item ${state.players[0]?.item ? state.players[0].item.icon : ''}</span>`;
  }
});

document.addEventListener('keyup', e => {
  _held.delete(e.code);
  if (e.code === 'KeyF') state.skillPreview = false;
});

window.addEventListener('blur', () => { _held.clear(); });

// === Mouse hover ===
C.addEventListener('mousemove', e => {
  const rect = C.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  state.mouseHex = p2h(mx, my);
  if (!inGrid(state.mouseHex.q, state.mouseHex.r)) {
    state.mouseHex = null;
    state.hoverEntity = null;
    document.getElementById('tooltip').style.display = 'none';
    return;
  }

  state.hoverEntity = _occMap.get(state.mouseHex.q + ',' + state.mouseHex.r) || null;
  const t = terrainAt(state.mouseHex.q, state.mouseHex.r);
  const tip = document.getElementById('tooltip');
  let text = '';

  if (state.hoverEntity) {
    if (state.hoverEntity.isEnemy) {
      const def = [...ENEMIES, ...BOSSES].find(d => d.name === state.hoverEntity.name);
      const statTxt = (state.hoverEntity.statuses && state.hoverEntity.statuses.length)
        ? '<br>Status: ' + state.hoverEntity.statuses.map(s => s.type + '(' + s.ticks + ')').join(', ') : '';
      const covTxt = terrainAt(state.hoverEntity.q, state.hoverEntity.r)?.type === T_COVER ? ' 🛡 Cover (-1 dmg)' : '';

      let dmgPrev = '';
      const p0 = state.players[0];
      if (p0 && p0.hp > 0 && hDist(p0, state.hoverEntity) <= 1) {
        let d = 1 + (p0.dmgBonus || 0);
        if (state.players.find(a => a !== p0 && a.hp > 0 && hDist(a, state.hoverEntity) <= 1 && hDist(a, p0) >= 2)) d++;
        d += state.players.filter(a => a.ghost && hDist(a, p0) <= 1).length;
        if (p0.lastStand) d++;
        if (p0.berserk && p0.hp <= Math.ceil(p0.maxHp * 0.5)) d++;
        if (terrainAt(state.hoverEntity.q, state.hoverEntity.r)?.type === T_COVER) d = Math.max(1, d - 1);
        const cc = Math.round((0.15 + (p0.critBonus || 0)) * 100);
        dmgPrev = `<br><span style="color:#c45a3c">Attack: ~${d} dmg (${cc}% crit +1)</span>`;
      }
      if (p0 && p0.hp > 0 && p0.cdTimer <= 0) {
        const sd = hDist(p0, state.hoverEntity);
        if (p0.classIdx === 0 && sd <= 1) dmgPrev += `<br><span style="color:#6b8cae">Cleave: ~${1 + (p0.lastStand ? 1 : 0) + (p0.dmgBonus || 0)} dmg</span>`;
        if (p0.classIdx === 1 && sd <= 4) dmgPrev += `<br><span style="color:#6b8cae">Fireball: ~${2 + (p0.lastStand ? 1 : 0) + (p0.dmgBonus || 0)} dmg + burn (aimed)</span>`;
      }

      const aiHints = {
        charger: 'Charges in a line', tank: 'High HP, bodyblocks',
        glasscannon: 'Ranged sniper', healer: 'Heals allies',
        splasher: 'Explodes on death', mimic: 'Copies your moves',
        bomber: 'Drops hazard tiles, flees', assassin: 'Invisible, high first strike',
        shieldbearer: 'Immune from front', summoner: 'Spawns minions'
      };
      const aiTxt = aiHints[state.hoverEntity.ai] ? `<br><span style="color:#555;font-size:0.625rem">${aiHints[state.hoverEntity.ai]}</span>` : '';
      const eliteTxt = state.hoverEntity.isElite ? '<span style="color:#b8943e"> 👑 Elite</span>' : '';
      const bossPh = state.hoverEntity.isBoss
        ? (state.hoverEntity.bossPhase >= 3 ? ' <span style="color:#c44040">P3</span>' : state.hoverEntity.bossPhase >= 2 ? ' <span style="color:#c49040">P2</span>' : '')
        : '';
      text = `<b style="color:${state.hoverEntity.color}">${state.hoverEntity.name}</b>${eliteTxt}${bossPh} ${state.hoverEntity.hp}/${state.hoverEntity.maxHp} HP${covTxt}<br>${def ? def.desc : ''}${aiTxt}${statTxt}${dmgPrev}`;
    } else {
      const def = CLASSES[state.hoverEntity.classIdx];
      const itemTxt = state.hoverEntity.item ? `<br>Item: ${state.hoverEntity.item.icon} ${state.hoverEntity.item.name} — ${state.hoverEntity.item.desc}` : '';
      const pStatTxt = (state.hoverEntity.statuses && state.hoverEntity.statuses.length)
        ? '<br>Status: ' + state.hoverEntity.statuses.map(s => s.type + '(' + s.ticks + ')').join(', ') : '';
      const deathTxt = state.hoverEntity.ghost ? `<br><span style="color:#c45a3c">Killed by ${state.hoverEntity.killedBy || '?'} on tick ${state.hoverEntity.killedAtTick || '?'}</span>` : '';
      const upTxt = state.hoverEntity.upgrades && state.hoverEntity.upgrades.length ? `<br><span style="color:#b8943e">Upgrades: ${state.hoverEntity.upgrades.join(' ')}</span>` : '';
      const bonusTxt = (state.hoverEntity.dmgBonus || state.hoverEntity.cdBonus || state.hoverEntity.critBonus)
        ? `<br><span style="color:#aaa">${state.hoverEntity.dmgBonus ? '+' + state.hoverEntity.dmgBonus + ' dmg ' : ''} ${state.hoverEntity.cdBonus ? '-' + state.hoverEntity.cdBonus + ' cd ' : ''} ${state.hoverEntity.critBonus ? '+' + (state.hoverEntity.critBonus * 100 | 0) + '% crit' : ''}</span>` : '';
      const ldTxt = state.hoverEntity.loadout ? `<br><span style="color:#ddd">Loadout: ${state.hoverEntity.loadout}</span>` : '';
      text = `<b style="color:${state.hoverEntity.color}">${state.hoverEntity.name}</b>${state.hoverEntity._dc ? ' (DISCONNECTED)' : state.hoverEntity.isBot ? ' (AI)' : ' (YOU)'}<br>${state.hoverEntity.hp}/${state.hoverEntity.maxHp} HP · ${def.desc}${ldTxt}${itemTxt}${pStatTxt}${deathTxt}${upTxt}${bonusTxt}`;
    }
  } else if (t) {
    const labels = {
      [T_WALL]: '<b style="color:#666">Wall</b> — impassable',
      [T_HAZARD]: '<b style="color:#cc4444">Hazard</b> — 1 dmg when entered',
      [T_COVER]: '<b style="color:#2a6a4a">Cover</b> — -1 incoming dmg · regen 1 HP / 4 ticks',
      [T_LAVA]: '<b style="color:#ff4400">Lava</b> — 2 dmg + burn when entered'
    };
    text = labels[t.type];
  }

  if (state.running && !state.gameOver && !state.paused && state.players[0] && state.players[0].hp > 0 && state.mouseHex) {
    const p0 = state.players[0];
    if (state.hoverEntity && state.hoverEntity.isEnemy && state.hoverEntity.hp > 0 && hDist(p0, state.hoverEntity) <= 1) {
      C.style.cursor = 'pointer';
    } else if (hNbrs(p0.q, p0.r).find(n => n.q === state.mouseHex.q && n.r === state.mouseHex.r) && isPassable(state.mouseHex.q, state.mouseHex.r, p0)) {
      C.style.cursor = 'grab';
    } else {
      C.style.cursor = 'crosshair';
    }
  } else {
    C.style.cursor = 'crosshair';
  }

  if (text) {
    tip.innerHTML = text;
    tip.style.display = 'block';
    tip.style.left = (e.clientX + 12) + 'px';
    tip.style.top = (e.clientY + 12) + 'px';
  } else {
    tip.style.display = 'none';
  }
});

C.addEventListener('mouseleave', () => {
  state.mouseHex = null;
  state.hoverEntity = null;
  document.getElementById('tooltip').style.display = 'none';
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.running && !state.gameOver && !state.paused) {
    state.paused = true;
    document.getElementById('pause-overlay').classList.add('show');
    updatePauseInfo();
  }
});

// === Click-to-move / click-to-attack ===
C.addEventListener('click', e => {
  if (!state.running || state.gameOver || state.paused || !state.mouseHex || !state.players[0] || !hostPlaying) return;
  const p0 = state.players[0];
  if (p0.hp <= 0 && !p0.ghost) return;

  if (state.hoverEntity && state.hoverEntity.isEnemy && state.hoverEntity.hp > 0 && hDist(p0, state.hoverEntity) <= 1) {
    state.pendingInput = 'attack';
    document.getElementById('input-indicator').textContent = 'Attack ⚔ (click)';
    return;
  }

  const dq = state.mouseHex.q - p0.q, dr = state.mouseHex.r - p0.r;
  const nbrs = hNbrs(p0.q, p0.r);
  if (nbrs.find(n => n.q === state.mouseHex.q && n.r === state.mouseHex.r)) {
    state.pendingInput = { dq, dr };
    document.getElementById('input-indicator').textContent = 'Move (click)';
  }
});

// === Touch input ===
if ('ontouchstart' in window) document.getElementById('touch-btns').style.display = 'flex';

let _touchStart = null;

C.addEventListener('touchstart', e => {
  e.preventDefault();
  const t = e.touches[0];
  _touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
}, { passive: false });

C.addEventListener('touchend', e => {
  e.preventDefault();
  if (!_touchStart || !state.running || state.gameOver || state.paused || !state.players[0] || !hostPlaying) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - _touchStart.x, dy = t.clientY - _touchStart.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const p0 = state.players[0];
  if (p0.hp <= 0 && !p0.ghost) { _touchStart = null; return; }

  if (dist < 20) {
    const rect = C.getBoundingClientRect();
    const th = p2h(t.clientX - rect.left, t.clientY - rect.top);
    if (th && inGrid(th.q, th.r)) {
      const ent = _occMap.get(th.q + ',' + th.r);
      if (ent && ent.isEnemy && ent.hp > 0 && hDist(p0, ent) <= 1) {
        state.pendingInput = 'attack';
      } else {
        const dq2 = th.q - p0.q, dr2 = th.r - p0.r;
        if (hNbrs(p0.q, p0.r).find(n => n.q === th.q && n.r === th.r)) {
          state.pendingInput = { dq: dq2, dr: dr2 };
        }
      }
    }
  } else {
    const ang = Math.atan2(dy, dx);
    const dirs = [
      { dq: 1, dr: 0, a: 0 },
      { dq: 1, dr: -1, a: -Math.PI / 3 },
      { dq: 0, dr: -1, a: -2 * Math.PI / 3 },
      { dq: -1, dr: 0, a: Math.PI },
      { dq: -1, dr: 1, a: 2 * Math.PI / 3 },
      { dq: 0, dr: 1, a: Math.PI / 3 }
    ];
    let best = dirs[0], bd = 99;
    dirs.forEach(d => {
      let diff = Math.abs(ang - d.a);
      if (diff > Math.PI) diff = 2 * Math.PI - diff;
      if (diff < bd) { bd = diff; best = d; }
    });
    state.pendingInput = { dq: best.dq, dr: best.dr };
  }
  _touchStart = null;
  state.keyHintShown = true;
}, { passive: false });
