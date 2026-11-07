import { state } from './state.js';
import { audio } from './audio.js';
import { applyUpgradePick } from './campaign.js';
import { combatLog, showWaveAnnounce } from './combat.js';
import { activeBiome, CLASSES } from './data.js';
import { _enemyAt, gameMode, hDist, HEX, hNbrs } from './hex.js';
import {
  _esc, _kicked, _lobbyReady, hostPlaying, selectedMode, startFromLobby, updateHostLobby,
  updateLobbyDisplay
} from './lobby.js';
import { RV } from './remote-view.js';
import { updatePauseInfo } from './render.js';
import { survivalScore, survivalWave } from './survival.js';
import { spawnAoe, spawnDmg } from './vfx.js';

export function updateLoadoutSel() {
  const ci = parseInt(document.getElementById('class-sel').value);
  const ls = document.getElementById('loadout-sel');
  const cls = CLASSES[ci];
  ls.options[0].text = cls.loadouts[0].name + ' — ' + cls.loadouts[0].desc;
  ls.options[1].text = cls.loadouts[1].name + ' — ' + cls.loadouts[1].desc;
  const lo = cls.loadouts[parseInt(ls.value)];
  document.getElementById('lobby-loadout-desc').innerHTML = `<span style="color:#999">${cls.desc}</span> <span style="color:#555">·</span> <span style="color:#777">♥${cls.hp}  ·  ${cls.ability}  ·  ${cls.cd} tick cd</span> <span style="color:#555">·</span> <span style="color:#b8943e">${lo.name}:</span> <span style="color:#777">${lo.desc}</span>`;
  if (state.lobbyPlayers[0]) {
    state.lobbyPlayers[0].classIdx = ci;
    state.lobbyPlayers[0].loadout = parseInt(ls.value);
    updateHostLobby();
  }
}

function drawQR(code) {
  const url = new URL('controller.html?room=' + encodeURIComponent(code), window.location.href).href;
  try {
    const qr = qrcode(0, 'L');
    qr.addData(url);
    qr.make();
    const c = document.getElementById('qr-canvas'), ctx = c.getContext('2d');
    const count = qr.getModuleCount(), size = c.width - 16, cell = size / count;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#0f0d0a';
    for (let r = 0; r < count; r++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(r, col)) ctx.fillRect(8 + col * cell, 8 + r * cell, cell + 0.5, cell + 0.5);
      }
    }
  } catch (e) {
    document.getElementById('qr-canvas').style.display = 'none';
  }
}

// === Networking: see net.js (relay + PeerJS + same-browser) ===
let _shownCode = null;

function _updateRoomUI(st) {
  const el = document.getElementById('lobby-room');
  if (st.code && st.code !== _shownCode) {
    _shownCode = st.code;
    drawQR(st.code);
  }
  el.dataset.code = st.code || '';
  el.textContent = st.code || '…';
  const online = st.relay === 'up' || st.p2p === 'up';
  const parts = [];
  if (st.relay !== 'off') parts.push('relay ' + st.relay);
  if (st.p2p !== 'off') parts.push('p2p ' + st.p2p);
  const net = document.getElementById('lobby-net');
  if (net) {
    net.textContent = (online ? '● Online' : '○ Connecting…') + ' · ' + parts.join(' · ') + (st.clients ? ' · ' + st.clients + ' phone' + (st.clients > 1 ? 's' : '') : '');
    net.style.color = online ? '#7ea879' : '#c9973e';
  }
}

// watch-only pages (remote board view) never host a room
export const _net = window.PQ_VIEWER
  ? { send() { return false; }, broadcast() {}, clientIds() { return []; }, newCode() {}, close() {}, status: {} }
  : PQNet.createHost({ onMessage: d => _handleMsg(d), onStatus: _updateRoomUI });

const _msgRate = {};

function _handleMsg(d) {
  try {
    if (d.type === 'board_sub') {
      if (!_kicked.has(d.id)) RV.onSub(d.id, d.on !== false, !!d.fresh);
      return;
    }
    if (d.id && _kicked.has(d.id)) {
      if (d.type === 'ping' || d.type === 'lobby_join') _net.send(d.id, { type: 'kicked' });
      return;
    }
    // rate limit: max 30 msgs/sec per controller
    if (d.id) {
      const now = Date.now();
      const r = _msgRate[d.id] || (_msgRate[d.id] = { t: now, c: 0 });
      if (now - r.t > 1000) { r.t = now; r.c = 0; }
      r.c++;
      if (r.c > 30) return;
    }
    if (d.id) _ctrlSeen[d.id] = Date.now();

    if (d.type === 'input' && state.running && !state.gameOver && !state.paused) {
      let inp;
      if (d.action === 'move') inp = { dq: d.dq, dr: d.dr };
      else if (d.action === 'attack') inp = 'attack';
      else if (d.action === 'skill') inp = 'skill';
      else if (d.action === 'defend') inp = 'defend';
      else if (d.action === 'item') inp = 'item';
      else if (d.action === 'flare') {
        const slot = d.id ? state.controllerSlots[d.id] : undefined;
        const fp = state.players[slot != null ? slot : 0];
        if (fp && fp.hp > 0 && !fp.ghost) {
          spawnAoe(fp.q, fp.r, fp.color, HEX * 2);
          spawnDmg(fp.q, fp.r, '📍', '#fff');
          audio.tick(true);
        }
      }
      if (inp) {
        const slot = d.id ? state.controllerSlots[d.id] : undefined;
        if (slot === 0) {
          state.pendingInput = inp;
          if (inp === 'skill') state.skillPreview = true;
        } else if (slot != null) {
          state.pendingInputs[slot] = inp;
        } else if (hostPlaying && !d.id) {
          state.pendingInput = inp;
          if (inp === 'skill') state.skillPreview = true;
        }
      }
      state.keyHintShown = true;
    }

    if (d.type === 'command') {
      if (d.cmd === 'start' && state.gamePhase === 'lobby' && _lobbyReady().ok) startFromLobby();
      if (d.cmd === 'pause' && state.running) {
        state.paused = !state.paused;
        document.getElementById('pause-overlay').classList.toggle('show', state.paused);
        if (state.paused) updatePauseInfo();
      }
      if (d.cmd === 'config') {
        if (d.classIdx != null) document.getElementById('class-sel').value = d.classIdx;
        if (d.loadout != null) document.getElementById('loadout-sel').value = d.loadout;
        updateLoadoutSel();
      }
    }

    if (d.type === 'lobby_join') {
      const safeName = _esc((d.name || '').slice(0, 8));
      const safeColor = /^#[0-9a-fA-F]{3,8}$/.test(d.customColor) ? d.customColor : null;
      const existing = state.lobbyPlayers.find(p => p.id === d.id);
      if (existing) {
        existing.classIdx = d.classIdx;
        existing.loadout = d.loadout;
        existing.ready = d.ready;
        existing.name = safeName || existing.autoName;
        if (safeColor) existing.customColor = safeColor;
        else delete existing.customColor;
      } else if (state.lobbyPlayers.length < parseInt(document.getElementById('player-sel').value)) {
        let n = 2;
        while (state.lobbyPlayers.some(p => p.name === 'P' + n || p.autoName === 'P' + n)) n++;
        state.lobbyPlayers.push({
          id: d.id, autoName: 'P' + n, name: safeName || 'P' + n,
          classIdx: d.classIdx || 0, loadout: d.loadout || 0,
          ready: d.ready || false, isLocal: false, customColor: safeColor
        });
      }
      updateLobbyDisplay();
    }

    if (d.type === 'claim_slot' && state.gamePhase !== 'lobby' && d.id && state.controllerSlots[d.id] == null) {
      const p = state.players[d.slot];
      if (p && p._dc) {
        const oldId = _slotOwner(d.slot);
        if (oldId) delete state.controllerSlots[oldId];
        state.controllerSlots[d.id] = d.slot;
        _ctrlSeen[d.id] = Date.now();
        _markReconnected(d.slot);
        _net.send(d.id, _buildState(d.id));
      }
    }

    if (d.type === 'upgrade_pick' && window._upgradeState && !window._upgradeState.done) {
      const slot = d.id ? state.controllerSlots[d.id] : 0;
      if (slot == null) return;
      const p = state.players[slot];
      if (p && !window._upgradeState.picks[p.name]) {
        const u = window._upgradeState.choices[p.name][d.idx];
        if (u) applyUpgradePick(p, u);
      }
    }

    if (d.type === 'ping' && d.id) _net.send(d.id, _buildState(d.id));
  } catch (err) {
    console.warn('[host] bad message ignored', err, d);
  }
}

// === Controller presence: notice drop-outs, let players rejoin ===
const DC_MS = 5000, LOBBY_DROP_MS = 15000;
const _ctrlSeen = {};

function _slotOwner(slot) {
  return Object.keys(state.controllerSlots).find(id => state.controllerSlots[id] === slot);
}

function _markDisconnected(slot) {
  const p = state.players[slot];
  if (!p || p._dc) return;
  p._dc = true;
  p.isBot = true;
  delete state.pendingInputs[slot];
  combatLog(`${p.name} disconnected — AI is covering`, '#c49040');
  showWaveAnnounce(p.name + ' DISCONNECTED', 'Rejoin with room code ' + (_shownCode || ''), 2500);
  const us = window._upgradeState;
  if (us && !us.done && !us.picks[p.name]) {
    const ch = us.choices[p.name] || [];
    if (ch.length) applyUpgradePick(p, ch[Math.floor(Math.random() * ch.length)]);
  }
  _updateDcBanner();
}

function _markReconnected(slot) {
  const p = state.players[slot];
  if (!p || !p._dc) return;
  p._dc = false;
  p.isBot = false;
  combatLog(`${p.name} reconnected`, '#7ea879');
  showWaveAnnounce(p.name + ' IS BACK', '', 1500);
  _updateDcBanner();
}

function _updateDcBanner() {
  const el = document.getElementById('dc-banner');
  if (!el) return;
  const dc = state.gamePhase === 'lobby' ? [] : state.players.filter(p => p._dc);
  const key = dc.map(p => p.name).join(',') + '|' + _shownCode;
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  if (!dc.length) { el.style.display = 'none'; return; }
  const names = dc.map(p => `<b style="color:${p.color}">${p.name}</b>`).join(', ');
  el.innerHTML = `<canvas id="dc-qr" width="64" height="64" style="border-radius:4px;background:#fff;flex-shrink:0"></canvas>
    <div style="text-align:left;line-height:1.5">⚠ ${names} disconnected — AI is covering<br>
    <span style="color:#8a7e6e">Rejoin: scan, or open the controller and enter</span> <b style="color:#b8943e;letter-spacing:0.1875rem">${_shownCode || ''}</b></div>`;
  el.style.display = 'flex';
  try {
    const src = document.getElementById('qr-canvas');
    document.getElementById('dc-qr').getContext('2d').drawImage(src, 0, 0, 64, 64);
  } catch (e) {}
}

setInterval(() => {
  const now = Date.now();
  if (state.gamePhase === 'lobby') {
    const n = state.lobbyPlayers.length;
    state.lobbyPlayers = state.lobbyPlayers.filter(lp => lp.isLocal || now - (_ctrlSeen[lp.id] || now) < LOBBY_DROP_MS);
    if (state.lobbyPlayers.length !== n) updateLobbyDisplay();
  } else {
    Object.keys(state.controllerSlots).forEach(id => {
      if (_ctrlSeen[id] == null) { _ctrlSeen[id] = now; return; }
      if (now - _ctrlSeen[id] > DC_MS) _markDisconnected(state.controllerSlots[id]);
      else _markReconnected(state.controllerSlots[id]);
    });
  }
  _updateDcBanner();
}, 1000);

function _serializePlayer(p) {
  if (!p) return null;
  return {
    name: p.name, hp: p.hp, maxHp: p.maxHp, ghost: p.ghost, classIdx: p.classIdx,
    ability: p.ability, cd: p.cd, cdTimer: p.cdTimer, cdBonus: p.cdBonus || 0,
    item: p.item ? { name: p.item.name, icon: p.item.icon, desc: p.item.desc } : null,
    defending: p.defending, loadout: p.loadout, color: p.color,
    upgrades: p.upgrades || [], dmgBonus: p.dmgBonus || 0, lastStand: !!p.lastStand,
    berserk: !!p.berserk, dodgeChance: p.dodgeChance || 0,
    statuses: (p.statuses || []).map(s => ({ type: s.type, ticks: s.ticks }))
  };
}

function _buildState(forId) {
  const slot = forId ? state.controllerSlots[forId] : undefined;
  const pi = slot != null ? slot : 0;
  const pp = state.players[pi];
  const upState = window._upgradeState && !window._upgradeState.done;
  const spectator = !!forId && slot == null && state.gamePhase !== 'lobby';
  const boss = state.enemies.find(e => e.isBoss && e.hp > 0);
  return {
    type: 'state', gamePhase: state.gamePhase, forId: forId || null,
    spectator,
    claimable: spectator
      ? state.players.map((p, i) => p._dc ? { slot: i, name: p.name, color: p.color, loadout: p.loadout, hp: p.hp, maxHp: p.maxHp, ghost: !!p.ghost } : null).filter(Boolean)
      : null,
    inLobby: forId ? state.lobbyPlayers.some(p => p.id === forId) : null,
    lobby: state.gamePhase === 'lobby' ? (() => {
      const r = _lobbyReady();
      return {
        max: r.numP,
        full: !!forId && !r.seated.some(p => p.id === forId) && state.lobbyPlayers.length >= r.numP,
        players: r.seated.map(p => ({
          name: p.isLocal ? (p.name || 'HOST') : p.name,
          host: !!p.isLocal, ready: !!p.ready, you: p.id === forId,
          color: p.customColor || CLASSES[p.classIdx].color
        }))
      };
    })() : null,
    running: state.running, gameOver: state.gameOver, paused: state.paused, tickCount: state.tickCount,
    tickPct: Math.min(1, state.tickTimer / state.tickMs),
    won: state.gamePhase === 'results' && state.campaignNode >= state.campaignTotal - 1 && state.enemies.every(e => e.hp <= 0),
    player: _serializePlayer(pp),
    pendingInput: pi === 0 ? !!state.pendingInput : !!state.pendingInputs[pi],
    encounter: gameMode === 'survival' ? survivalWave() : state.campaignNode + 1,
    encounterTotal: gameMode === 'survival' ? null : state.campaignTotal,
    biome: activeBiome.name,
    mode: state.gamePhase === 'lobby' ? selectedMode() : gameMode,
    score: gameMode === 'survival' ? survivalScore() : null,
    partyLevel: state.partyLevel, partyXP: state.partyXP, xpToNext: state.xpToNext,
    enemyCount: state.enemies.filter(e => e.hp > 0).length,
    enemyTotal: state.enemies.length,
    inDanger: pp && pp.hp > 0 ? hNbrs(pp.q, pp.r).some(n => _enemyAt(n.q, n.r)) : false,
    telegraphed: pp && pp.hp > 0 && state.enemies.some(e => e.hp > 0 && e.telegraph && e.telegraphTarget && e.telegraphTarget.q === pp.q && e.telegraphTarget.r === pp.r),
    targetedBy: pp && pp.hp > 0
      ? state.enemies.filter(e => e.hp > 0 && ((e.telegraphTarget && hDist(e.telegraphTarget, pp) <= 1) || (e.ai === 'glass_cannon' && e.shootTimer >= 1 && hDist(e, pp) <= 3))).length
      : 0,
    nearestEnemyDir: (() => {
      if (!pp || pp.hp <= 0) return null;
      let best = null, bd = 99;
      state.enemies.forEach(e => {
        if (e.hp > 0) { const d = hDist(pp, e); if (d < bd) { bd = d; best = e; } }
      });
      if (!best) return null;
      return { dq: Math.sign(best.q - pp.q), dr: Math.sign(best.r - pp.r), dist: bd };
    })(),
    activeBoss: boss ? { name: boss.name, hp: boss.hp, maxHp: boss.maxHp } : null,
    msg: state.msg,
    playerStats: pp && state.stats[pp.name] ? {
      dmgDealt: state.stats[pp.name].dmgDealt, kills: state.stats[pp.name].kills,
      heals: state.stats[pp.name].heals, dmgTaken: state.stats[pp.name].dmgTaken,
      moved: state.stats[pp.name].moved
    } : null,
    classes: CLASSES.map(c => ({ name: c.name, loadouts: c.loadouts.map(l => ({ name: l.name, desc: l.desc })) })),
    upgradePhase: upState ? {
      choices: (window._upgradeState.choices[pp?.name] || []).map(u => ({ name: u.name, icon: u.icon, desc: u.desc })),
      picked: !!window._upgradeState.picks[pp?.name],
      allStatus: state.players.map(p => ({
        name: p.name, color: p.color,
        picked: !!window._upgradeState.picks[p.name],
        pickName: window._upgradeState.picks[p.name]?.name || null
      }))
    } : null,
  };
}

setInterval(() => {
  _net.clientIds().forEach(id => {
    if (!_kicked.has(id)) _net.send(id, _buildState(id));
  });
}, 200);

document.getElementById('player-sel').addEventListener('change', () => {
  if (state.gamePhase === 'lobby') updateLobbyDisplay();
});
