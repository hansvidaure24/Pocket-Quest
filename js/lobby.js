// === Lobby ===

import { state } from './state.js';
import { audio } from './audio.js';
import { generateTerrain, startCampaign } from './campaign.js';
import { irisWipe } from './canvas.js';
import { CLASSES } from './data.js';
import { _occRebuild, gameMode, HEX, setBoard, setGameMode, SQRT3 } from './hex.js';
import { _net } from './net-host.js';
import { startSurvival, survivalWave, updateBestScoreLabel } from './survival.js';
import { initStats } from './vfx.js';

export function setPhase(phase) {
  state.gamePhase = phase;
  document.getElementById('lobby-screen').style.display = phase === 'lobby' ? 'flex' : 'none';
  document.getElementById('game-screen').style.display = phase === 'game' ? 'block' : 'none';
  document.getElementById('menu-bg').style.display = phase === 'lobby' ? 'block' : 'none';
}

export let hostCustomColor = null;
export let hostPlaying = true;
const HOST_COLORS = [
  '#c45a3c', '#6b8cae', '#7ea879', '#c9973e',
  '#d47a3c', '#5a9aa8', '#b87a8a', '#a38530'
];

function buildHostColors() {
  const el = document.getElementById('host-colors');
  el.innerHTML = HOST_COLORS.map((c, i) =>
    `<span class="host-swatch${hostCustomColor === c ? ' selected' : ''}" data-ci="${i}" style="--c:${c}"></span>`
  ).join('');
  el.querySelectorAll('span').forEach(s => {
    s.onclick = () => {
      const c = HOST_COLORS[parseInt(s.dataset.ci)];
      hostCustomColor = hostCustomColor === c ? null : c;
      buildHostColors();
      updateHostLobby();
    };
  });
}

export function updateHostLobby() {
  const nm = document.getElementById('host-name').value.trim().toUpperCase();
  if (state.lobbyPlayers[0]) {
    state.lobbyPlayers[0].name = nm || 'P1 (Host)';
    state.lobbyPlayers[0].customColor = hostCustomColor;
  }
  updateLobbyDisplay();
}

export function toggleHostPlay() {
  hostPlaying = document.getElementById('host-play').checked;
  document.getElementById('host-config').style.display = hostPlaying ? 'contents' : 'none';
  if (hostPlaying) {
    if (!state.lobbyPlayers[0] || state.lobbyPlayers[0].id !== 'host') {
      state.lobbyPlayers.unshift({
        id: 'host',
        name: document.getElementById('host-name').value.trim().toUpperCase() || 'P1 (Host)',
        classIdx: parseInt(document.getElementById('class-sel').value),
        loadout: parseInt(document.getElementById('loadout-sel').value),
        ready: true, isLocal: true, customColor: hostCustomColor
      });
    }
  } else {
    if (state.lobbyPlayers[0] && state.lobbyPlayers[0].id === 'host') state.lobbyPlayers.shift();
  }
  updateLobbyDisplay();
}

export function goToLobby() {
  setPhase('lobby');
  hostPlaying = true;
  document.getElementById('host-play').checked = true;
  document.getElementById('host-config').style.display = 'contents';
  state.lobbyPlayers = [{ id: 'host', name: 'P1 (Host)', classIdx: 0, loadout: 0, ready: true, isLocal: true, customColor: null }];
  buildHostColors();
  updateLobbyDisplay();
}

export function updateLobbyDisplay() {
  const el = document.getElementById('lobby-players');
  const numP = parseInt(document.getElementById('player-sel').value);
  let html = '';
  for (let i = 0; i < numP; i++) {
    const lp = state.lobbyPlayers[i];
    if (lp) {
      const kick = lp.isLocal ? '' : `<button class="kick-btn" title="Kick ${_esc(lp.name)}" data-kick="${_esc(lp.id)}">✕</button>`;
      const cls = CLASSES[lp.classIdx];
      const pCol = lp.customColor || cls.color;
      const rdyCol = lp.ready ? '#7ea879' : '#c49040';
      const rdyTxt = lp.ready ? 'READY' : 'waiting...';
      const lo = cls.loadouts[lp.loadout];
      const classIcons = ['🛡️', '🔮', '🗡️', '✨'];
      html += `<div style="--pc:${pCol}33;position:relative;background:linear-gradient(180deg,${pCol}12 0%,#1e1a15 30%,#12100c);border:1px solid ${pCol}44;border-top:2px solid ${pCol}88;border-radius:8px;padding:1.125rem 1.375rem;min-width:10.625rem;max-width:12.5rem;text-align:center;box-shadow:0 0 24px ${pCol}15;animation:slotJoin 0.5s ease-out">${kick}
        <div style="font-size:2.25rem;margin-bottom:0.25rem;filter:drop-shadow(0 2px 6px ${pCol}44)">${classIcons[lp.classIdx] || '⚔'}</div>
        <div style="color:${pCol};font-weight:700;font-size:1.125rem;letter-spacing:0.0625rem">${_esc(lp.name)}</div>
        <div style="font-size:0.875rem;margin-top:0.125rem;color:#ccc;font-weight:600">${cls.name}</div>
        <div style="font-size:0.625rem;color:#888;margin-top:0.1875rem;line-height:1.4">${cls.desc}</div>
        <div style="width:40px;height:1px;background:rgba(140,120,80,0.2);margin:0.375rem auto"></div>
        <div style="font-size:0.6875rem;color:#b8943e">${lo.name}</div>
        <div style="font-size:0.5625rem;color:#888;margin-top:0.0625rem">${lo.desc}</div>
        <div style="font-size:0.5625rem;color:#666;margin-top:0.25rem">♥${cls.hp}  ·  ${cls.ability}  ·  ${cls.cd} tick cd</div>
        <div style="color:${rdyCol};font-size:0.8125rem;font-weight:700;margin-top:0.375rem;letter-spacing:0.125rem;text-transform:uppercase${lp.ready ? ';animation:readyPulse 2s ease-in-out infinite' : ''}">${rdyTxt}</div>
      </div>`;
    } else {
      html += `<div style="background:linear-gradient(180deg,rgba(20,18,28,0.6),rgba(12,10,18,0.6));border:1px dashed rgba(140,120,80,0.15);border-radius:8px;padding:1.125rem 1.375rem;min-width:10.625rem;max-width:12.5rem;text-align:center">
        <div style="font-size:2.25rem;margin-bottom:0.25rem;opacity:0.2">👤</div>
        <div style="font-size:0.9375rem;font-weight:700;color:#555;letter-spacing:0.0625rem">P${i + 1}</div>
        <div style="font-size:0.6875rem;margin-top:0.375rem;color:#7a7468;letter-spacing:0.031rem">Waiting for player...</div>
      </div>`;
    }
  }
  el.innerHTML = html;
  el.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => kickPlayer(b.dataset.kick));
  _updateStartBtn();
}

export function _esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function _lobbyReady() {
  const numP = parseInt(document.getElementById('player-sel').value);
  const seated = state.lobbyPlayers.slice(0, numP);
  const waiting = seated.filter(p => !p.isLocal && !p.ready);
  return { seated, numP, waiting, ok: waiting.length === 0 };
}

function _updateStartBtn() {
  const b = document.getElementById('start-btn');
  if (!b) return;
  const r = _lobbyReady();
  b.disabled = !r.ok;
  b.style.pointerEvents = '';
  b.style.fontSize = '';
  b.textContent = r.ok
    ? 'START ' + (selectedMode() === 'survival' ? 'SURVIVAL' : 'CAMPAIGN')
    : 'WAITING FOR ' + (r.waiting.length === 1 ? _esc(r.waiting[0].name).toUpperCase() : r.waiting.length + ' PLAYERS') + ' TO READY';
  b.title = r.ok ? '' : 'Every player who joined from a phone has to tap READY. Kick (✕) anyone who is AFK.';
}

export const _kicked = new Set();
function kickPlayer(id) {
  if (!id || id === 'host') return;
  _kicked.add(id);
  state.lobbyPlayers = state.lobbyPlayers.filter(p => p.id !== id);
  _net.send(id, { type: 'kicked' });
  updateLobbyDisplay();
}

export let isTutorial = false;
export let tutStep = 0;
export function setTutorial(on) { isTutorial = on; }
export function setTutStep(n) { tutStep = n; }
export function setHostPlaying(on) { hostPlaying = on; }
export let tutFlags = { moved: false, attacked: false, skilled: false, defended: false };
export const TUT_HINTS = [
  'WASD to MOVE toward the enemy (hold two for diagonals)',
  'Get ADJACENT, then SPACE to ATTACK',
  'Press F to use your SKILL',
  'Press G to DEFEND',
  'Nice! Starting real campaign...',
];

export function encLabel() {
  return gameMode === 'survival'
    ? 'Wave ' + survivalWave()
    : 'Enc ' + (state.campaignNode + 1) + '/' + state.campaignTotal;
}

export function selectedMode() {
  const m = document.getElementById('mode-sel');
  return m && m.value === 'survival' ? 'survival' : 'campaign';
}

export function onModeChange() {
  const surv = selectedMode() === 'survival';
  document.getElementById('length-wrap').style.display = surv ? 'none' : '';
  const sp = document.getElementById('speed-sel');
  if (surv && sp.value === '1500') sp.value = '1000';
  if (!surv && sp.value === '1000') sp.value = '1500';
  document.getElementById('start-btn').dataset.mode = selectedMode();
  updateBestScoreLabel();
  if (state.gamePhase === 'lobby') updateLobbyDisplay();
}

export function startFromLobby() {
  const btn = document.getElementById('start-btn');
  btn.disabled = true;
  btn.style.pointerEvents = 'none';
  let count = 3;
  btn.textContent = count;
  btn.style.fontSize = '32px';
  const iv = setInterval(() => {
    count--;
    if (count > 0) {
      btn.textContent = count;
    } else {
      clearInterval(iv);
      btn.textContent = 'GO!';
      setTimeout(() => {
        btn.style.fontSize = '';
        irisWipe({
          speed: 0.004, color: '#000', hold: 120,
          onMid: () => {
            setPhase('game');
            if (!hostPlaying) document.getElementById('touch-btns').style.display = 'none';
            if (selectedMode() === 'survival') startSurvival();
            else startCampaign();
          }
        });
      }, 400);
    }
  }, 700);
}

export function restartRun() {
  irisWipe({
    speed: 0.005, color: '#000', hold: 80,
    onMid: () => {
      document.getElementById('pause-overlay').classList.remove('show');
      state.paused = false;
      if (gameMode === 'survival') startSurvival();
      else startCampaign();
    }
  });
}

export function quitToLobby() {
  irisWipe({
    speed: 0.005, color: '#000', hold: 80,
    onMid: () => {
      ['pause-overlay', 'stats-overlay', 'transition-overlay'].forEach(id =>
        document.getElementById(id).classList.remove('show')
      );
      state.paused = false;
      state.running = false;
      state.gameOver = true;
      window._upgradeState = null;
      audio.stopDrone();
      goToLobby();
    }
  });
}

export function playAgain() {
  irisWipe({
    speed: 0.005, color: '#000', hold: 80,
    onMid: () => {
      document.getElementById('stats-overlay').classList.remove('show');
      setPhase('game');
      if (gameMode === 'survival') startSurvival();
      else startCampaign();
    }
  });
}

export function dedupeNames(list) {
  const seen = {};
  list.forEach(p => {
    const base = p.name;
    let n = base, k = 2;
    while (seen[n.toUpperCase()]) { n = base + k; k++; }
    seen[n.toUpperCase()] = 1;
    p.name = n;
  });
}

export function startPractice() {
  irisWipe({
    speed: 0.004, color: '#000', hold: 120,
    onMid: () => {
      setPhase('game');
      if (!hostPlaying) document.getElementById('touch-btns').style.display = 'none';
      isTutorial = hostPlaying;
      tutStep = 0;
      tutFlags = { moved: false, attacked: false, skilled: false, defended: false };
      setGameMode('campaign');
      setBoard(null);

      state.entities = []; state.players = []; state.enemies = [];
      state.pendingInput = null; state.tickCount = 0; state.totalTicks = 0;
      state.gameOver = false; state.paused = false;
      state.damageNumbers = []; state.flashEffects = []; state.projectiles = [];
      state.deathEffects = []; state.aoeEffects = []; state.trailEffects = []; state.statusParticles = [];
      state.msg = ''; state.msgTimer = 0;
      state.campaignNode = 0; state.campaignActive = false; state.campaignTotal = 1;
      state.CAMPAIGN_NODES = [{ type: 'combat', label: 'Practice' }];
      state.difficulty = 0;
      state.combatLogLines = [];
      document.getElementById('combat-log').innerHTML = '';

      const numP = parseInt(document.getElementById('player-sel').value);
      const hc = parseInt(document.getElementById('class-sel').value);
      const hl = parseInt(document.getElementById('loadout-sel').value);
      const roster = [];
      if (hostPlaying) {
        roster.push({
          classIdx: hc, loadout: hl, isBot: false, controllerId: null,
          name: document.getElementById('host-name').value.trim().toUpperCase() || null,
          customColor: hostCustomColor
        });
      }
      const startIdx = hostPlaying ? 1 : 0;
      for (let i = startIdx; i < numP; i++) {
        if (roster.length >= numP) break;
        const lp = state.lobbyPlayers.find(p => !p.isLocal && !roster.some(r => r.controllerId === p.id));
        if (lp) {
          roster.push({
            classIdx: lp.classIdx || 0, loadout: lp.loadout || 0,
            isBot: false, controllerId: lp.id, name: lp.name,
            customColor: lp.customColor || null
          });
        } else {
          const usedCi = roster.map(r => r.classIdx);
          let ci = 0;
          for (let j = 0; j < 4; j++) if (!usedCi.includes(j)) { ci = j; break; }
          roster.push({
            classIdx: ci, loadout: Math.floor(Math.random() * 2),
            isBot: true, controllerId: null, name: null, customColor: null
          });
        }
      }

      state.controllerSlots = {};
      const spawns = [{ q: -1, r: 2 }, { q: 0, r: 2 }, { q: 1, r: 2 }, { q: -1, r: 1 }];
      for (let i = 0; i < roster.length; i++) {
        const r = roster[i], cls = CLASSES[r.classIdx], sp = spawns[i];
        const p = {
          name: r.name || cls.name, hp: cls.hp, maxHp: cls.hp,
          color: r.customColor || cls.color, q: sp.q, r: sp.r,
          prevQ: sp.q, prevR: sp.r, isEnemy: false, classIdx: r.classIdx,
          ability: cls.ability, cd: cls.cd, cdTimer: 0,
          ghost: false, isBot: r.isBot, dmgBonus: 0, cdBonus: 0, upgrades: []
        };
        cls.loadouts[r.loadout].apply(p);
        p.loadout = cls.loadouts[r.loadout].name;
        if (r.controllerId) state.controllerSlots[r.controllerId] = i;
        state.players.push(p);
      }

      const dummySpawns = [{ q: 0, r: -2 }, { q: -1, r: -2 }, { q: 1, r: -2 }];
      for (let i = 0; i < Math.min(numP, 3); i++) {
        const sp = dummySpawns[i];
        state.enemies.push({
          name: 'Training Dummy', hp: 8, maxHp: 8, color: '#6a8a6a',
          q: sp.q, r: sp.r, prevQ: sp.q, prevR: sp.r,
          isEnemy: true, ai: 'tank', charging: false,
          shootTimer: 0, telegraph: false, telegraphTarget: null, spawnTick: 0
        });
      }

      state.entities = [...state.players, ...state.enemies];
      _occRebuild();
      generateTerrain('combat');
      state.tickMs = 2000; state.tickTimer = 0; state.running = true; state.paused = false;
      dedupeNames(state.players);
      initStats();

      const lead = state.players[0];
      state.camOffX = -HEX * (SQRT3 * lead.q + SQRT3 / 2 * lead.r);
      state.camOffY = -HEX * 1.5 * lead.r;
      audio.startDrone();
      state.countdownTimer = 1800;
      state.countdownText = '3';
      audio.tick(false);
      setTimeout(() => { state.countdownText = '2'; audio.tick(false); }, 600);
      setTimeout(() => { state.countdownText = '1'; audio.tick(true); }, 1200);
      setTimeout(() => { state.countdownText = 'GO!'; state.screenFlash = { color: '#7ea879', life: 200, maxLife: 200 }; }, 1800);
      setTimeout(() => { state.countdownText = ''; }, 2400);
    }
  });
}
