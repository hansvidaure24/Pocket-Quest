// Pocket Quest — remote board view.
//
// A player on a computer can see the board on their own screen. controller.html embeds
// host.html?viewer=1 (watch-only mode) and forwards it "board" snapshots it receives from the
// host. The watch-only page reuses all of the host's drawing code; it never runs the game.
//
// Host side:   records visual/audio effects as small events, and after every tick sends each
//              subscribed controller one snapshot (units, HUD numbers, events; terrain on change).
// Viewer side: rebuilds the game globals from snapshots, replays the events, shows banners.
//
// Loaded before the main script. RV.installHost() / RV.startViewer() are called from host.html
// once the game's functions exist.

import { state } from './state.js';
import { audio } from './audio.js';
import { combatLog, showMsg, showWaveAnnounce } from './combat.js';
import { activeBiome, BIOMES, setBiome } from './data.js';
import { BOARD, gameMode, GRID_R, HEX, setBoard, setGameMode, setGridRadius } from './hex.js';
import { on } from './hooks.js';
import { setHostPlaying, setPhase } from './lobby.js';
import { _net } from './net-host.js';
import { triggerLunge } from './render.js';
import { makeBoardDims, S, setSurvivalRun, survivalScore } from './survival.js';
import { doShake, spawnAoe, spawnDeath, spawnDmg, spawnFlash, spawnProjectile, spawnTrail } from './vfx.js';

// window.PQ_VIEWER is set by viewer-flag.js, which loads first

export const RV = {
  // ───────────── shared ─────────────
  // entity fields copied as-is (when truthy) — everything drawEntity / the HUD reads
  FLAGS: ['ai', 'isBoss', 'charging', 'shootTimer', 'enraged', 'isElite', '_invisible', '_phase', 'bossTimer', 'spawnTick',
    'berserk', 'classIdx', 'cdTimer', 'defending', 'isBot', 'lastStand', '_dc', 'ability', 'cd', 'cdBonus', 'loadout', '_charge', '_phase2', 'dmgBonus'],
  ANIM: ['_sqT', '_lungeT', '_lungeAng'], // viewer-local animation state kept across snapshots

  // ───────────── host ─────────────
  subs: new Map(),      // controllerId -> { need: true (send terrain), seen }
  events: [],
  nextId: 1,
  lastSendAt: 0,
  terrSig: '',

  idOf(e) { if (!e) return 0; if (!e._id) e._id = RV.nextId++; return e._id; },
  rec(ev) { if (RV.subs.size && RV.events.length < 300) RV.events.push(ev); },

  installHost() {
    const toEv = {
      spawnDmg: (q, r, text, color) => ['d', q, r, String(text), color],
      spawnAoe: (q, r, color, radius) => ['a', q, r, color, radius != null ? +(radius / HEX).toFixed(2) : null],
      spawnProjectile: (f, t, color, big) => ['p', f.q, f.r, t.q, t.r, color, big ? 1 : 0],
      spawnDeath: (q, r, color, big) => ['x', q, r, color, big ? 1 : 0],
      spawnTrail: (q, r, color) => ['t', q, r, color],
      spawnFlash: (t) => ['f', RV.idOf(t)],
      triggerLunge: (e, t) => ['l', RV.idOf(e), RV.idOf(t)],
      doShake: (n) => ['s', n],
      showWaveAnnounce: (text, sub, dur) => ['w', text, sub || '', dur || 2500],
      showMsg: (text, dur) => ['m', text, dur || 2000],
      combatLog: (text, color) => ['c', text, color],
    };
    on('fx', (name, ...a) => {
      if (!RV.subs.size) return;
      try { RV.rec(toEv[name](...a)); } catch (e) { /* never break the game */ }
    });
    // sounds (the viewer's own render loop plays the metronome; drones are host-only)
    Object.keys(audio).forEach((k) => {
      if (typeof audio[k] !== 'function' || ['metronome', 'startDrone', 'stopDrone', 'setBossDrone', 'setVolume'].includes(k)) return;
      const orig = audio[k];
      audio[k] = function (...a) { if (RV.subs.size) RV.rec(['u', k].concat(a.filter((x) => typeof x !== 'object'))); return orig.apply(this, a); };
    });
    // one snapshot right after every tick, plus a 1s heartbeat when the game isn't ticking
    on('afterTick', () => RV.send());
    setInterval(() => {
      // forget controllers that left or turned the board off
      const ids = new Set(_net.clientIds());
      for (const [id, s] of RV.subs) if (!ids.has(id) || Date.now() - s.seen > 15000) RV.subs.delete(id);
      if (RV.subs.size && Date.now() - RV.lastSendAt > 900) RV.send();
    }, 500);
  },

  onSub(id, on, fresh) {
    if (!id) return;
    if (!on) { RV.subs.delete(id); return; }
    const s = RV.subs.get(id);
    if (s) { s.seen = Date.now(); if (fresh) { s.need = true; RV.send(); } }
    else { RV.subs.set(id, { need: true, seen: Date.now() }); RV.send(); }
  },

  entOut(e) {
    const o = { i: RV.idOf(e), n: e.name, c: e.color, q: e.q, r: e.r, pq: e.prevQ, pr: e.prevR, h: e.hp, m: e.maxHp };
    if (e.isEnemy) o.E = 1;
    if (e.ghost) o.g = 1;
    if (e.faceDQ != null) { o.fq = e.faceDQ; o.fr = e.faceDR; }
    if (e.statuses && e.statuses.length) o.st = e.statuses.map((s) => [s.type, s.ticks]);
    if (e.telegraph) o.tg = 1;
    if (e.telegraphTarget) o.tt = [e.telegraphTarget.q, e.telegraphTarget.r];
    if (e.healBeamTarget) o.hb = RV.idOf(e.healBeamTarget);
    if (e.mimicTarget) o.mt = RV.idOf(e.mimicTarget);
    if (e.item) o.it = [e.item.icon, e.item.name];
    if (e.elite) o.el = e.elite.color;
    if (e.upgrades && e.upgrades.length) o.up = e.upgrades;
    const f = {};
    RV.FLAGS.forEach((k) => { if (e[k]) f[k] = e[k]; });
    if (Object.keys(f).length) o.f = f;
    return o;
  },

  build() {
    const surv = gameMode === 'survival' && typeof S !== 'undefined' && S;
    const terrArr = state.terrain.map((t) => [t.q, t.r, t.type]);
    const sig = JSON.stringify(terrArr) + '|' + (BOARD ? BOARD.CW + 'x' + BOARD.RH : 'r' + GRID_R);
    const terrChanged = sig !== RV.terrSig; RV.terrSig = sig;
    const snap = {
      type: 'board', v: 1, mode: gameMode, ph: state.gamePhase, run: state.running ? 1 : 0, pa: state.paused ? 1 : 0, go: state.gameOver ? 1 : 0,
      tm: state.tickMs, tc: state.tickCount, tt: state.totalTicks, df: state.difficulty, bi: Math.max(0, BIOMES.indexOf(activeBiome)),
      lv: state.partyLevel, xp: state.partyXP, xn: state.xpToNext,
      bd: BOARD ? { cw: BOARD.CW, rh: BOARD.RH } : { gr: GRID_R },
      cmp: surv ? null : { n: state.campaignNode, t: Math.min(state.campaignTotal, 20), types: state.CAMPAIGN_NODES.slice(0, 20).map((n) => n.type) },
      sv: surv ? { w: S.wave, ph: S.phase, pt: S.phaseTick, sc: survivalScore(), b: S.best, nb: S.newBest ? 1 : 0, cl: S.cleared, kl: S.kills + S.summonKills, bk: S.bossKills, st: S.startTime, rl: S.relics.map((r) => [r.icon, r.name]), tel: S.telegraph.map((t) => [t.q, t.r, t.boss ? 1 : 0]) } : null,
      won: state.gamePhase === 'results' && gameMode !== 'survival' && state.campaignNode >= state.campaignTotal - 1 && state.enemies.every((e) => e.hp <= 0) ? 1 : 0,
      bn: activeBiome ? activeBiome.name : '',
      pl: state.players.map(RV.entOut),
      en: state.enemies.filter((e) => e.hp > 0 || e._deadAt == null || state.tickCount - e._deadAt < 2).map(RV.entOut),
      kf: state.killFeed.map((k) => ({ killer: k.killer, victim: k.victim, kColor: k.kColor, vColor: k.vColor, boss: k.boss, t: k.t })),
      sts: state.stats, // small: a handful of numbers per hero
      sf: state.screenFlash && state.screenFlash.life > 0 ? state.screenFlash : null,
      ev: RV.events,
    };
    RV.events = [];
    return { snap, terrArr, terrChanged };
  },

  send() {
    if (!RV.subs.size || PQ_VIEWER) return;
    RV.lastSendAt = Date.now();
    let built;
    try { built = RV.build(); } catch (e) { console.warn('board snapshot failed', e); RV.events = []; return; }
    const { snap, terrArr, terrChanged } = built;
    // keep messages comfortably under the relay limit: drop cosmetic events first
    let size = JSON.stringify(snap).length;
    if (size > 40000) { snap.ev = snap.ev.filter((e) => e[0] !== 't' && e[0] !== 'c'); size = JSON.stringify(snap).length; }
    if (size > 50000) snap.ev = [];
    for (const [id, s] of RV.subs) {
      const msg = Object.assign({}, snap, { you: state.controllerSlots[id] != null ? state.controllerSlots[id] : -1 });
      if (terrChanged || s.need) { msg.ter = terrArr; s.need = false; }
      _net.send(id, msg);
    }
  },

  // ───────────── viewer ─────────────
  map: new Map(),     // entity id -> object (kept so animation state survives snapshots)
  lastTc: -1,
  lastSnapAt: 0,
  boardKey: '',
  muted: true,
  lastPh: null,

  startViewer() {
    setPhase('game');
    state.gamePhase = 'game'; state.running = false; state.paused = false; state.gameOver = false; setHostPlaying(false);
    ['restart-btn', 'touch-btns'].forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    // the combat log covers too much of a small board
    const fitLog = () => { const el = document.getElementById('combat-log'); if (el) el.style.display = innerWidth < 760 ? 'none' : ''; };
    window.addEventListener('resize', fitLog); fitLog();
    // never simulate: tick() sees PQ_VIEWER and only keeps the tween at its end
    // mute until the player clicks the sound button inside this frame (browsers require a click here)
    Object.keys(audio).forEach((k) => { if (typeof audio[k] !== 'function') return; const o = audio[k]; audio[k] = function (...a) { if (RV.muted) return; return o.apply(this, a); }; });

    RV.banner = document.createElement('div');
    RV.banner.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:60;background:rgba(12,10,8,0.92);border:1px solid rgba(184,148,62,0.4);border-radius:8px;padding:14px 22px;color:#e8c878;font:700 18px Rajdhani,sans-serif;letter-spacing:1px;text-align:center;display:none;pointer-events:none;max-width:min(680px,92vw);max-height:85vh;overflow-y:auto';
    document.body.appendChild(RV.banner);
    const snd = document.createElement('button');
    snd.textContent = '🔇 Sound off';
    snd.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:61;background:rgba(18,15,11,0.9);color:#ccc;border:1px solid rgba(184,148,62,0.35);border-radius:4px;padding:4px 10px;font:600 12px Rajdhani,sans-serif;cursor:pointer';
    snd.onclick = () => { RV.muted = !RV.muted; snd.textContent = RV.muted ? '🔇 Sound off' : '🔊 Sound on'; if (!RV.muted) { try { audio.tick(false); } catch (e) {} } snd.blur(); };
    document.body.appendChild(snd);
    RV.setBanner('Waiting for the host…');

    window.addEventListener('message', (ev) => {
      if (ev.origin !== location.origin || !ev.data) return;
      if (ev.data.type === 'board') { try { RV.apply(ev.data); } catch (e) { console.warn('board apply failed', e); } }
      if (ev.data.type === 'pq-link') RV.linkUp = !!ev.data.up;
    });
    // keys pressed while this frame has focus still control your hero: hand them to the controller
    window.addEventListener('keydown', (e) => {
      if (window.parent !== window) window.parent.postMessage({ pqKey: e.code, key: e.key }, location.origin);
      e.stopImmediatePropagation();
    }, true);
    setInterval(() => {
      if (Date.now() - RV.lastSnapAt > 3500) RV.setBanner(RV.lastSnapAt ? 'Connection to the host paused…' : 'Waiting for the host…');
    }, 1000);
  },

  setBanner(text, html) {
    if (!RV.banner) return;
    if (html) { RV.banner.innerHTML = html; RV.banner.style.display = 'block'; RV.banner.style.pointerEvents = 'auto'; }
    else { RV.banner.textContent = text || ''; RV.banner.style.display = text ? 'block' : 'none'; RV.banner.style.pointerEvents = 'none'; }
  },

  boardFor(cw, rh) {
    const key = cw + 'x' + rh;
    if (RV.boardKey === key && BOARD) return BOARD;
    RV.boardKey = key;
    return makeBoardDims(cw, rh);
  },

  entIn(o) {
    let e = RV.map.get(o.i);
    if (!e) { e = {}; RV.map.set(o.i, e); }
    const anim = {}; RV.ANIM.forEach((k) => { if (e[k] != null) anim[k] = e[k]; });
    for (const k of Object.keys(e)) delete e[k];
    Object.assign(e, anim);
    e._id = o.i; e.name = o.n; e.color = o.c; e.q = o.q; e.r = o.r; e.prevQ = o.pq; e.prevR = o.pr; e.hp = o.h; e.maxHp = o.m;
    e.isEnemy = !!o.E; e.ghost = !!o.g;
    if (o.fq != null) { e.faceDQ = o.fq; e.faceDR = o.fr; }
    e.statuses = (o.st || []).map(([type, ticks]) => ({ type, ticks }));
    e.telegraph = !!o.tg;
    e.telegraphTarget = o.tt ? { q: o.tt[0], r: o.tt[1] } : null;
    e._hb = o.hb; e._mt = o.mt;
    e.item = o.it ? { icon: o.it[0], name: o.it[1] } : null;
    if (o.el) e.elite = { color: o.el };
    e.upgrades = o.up || [];
    if (o.f) Object.assign(e, o.f);
    return e;
  },

  apply(d) {
    RV.lastSnapAt = Date.now();
    // mode + board
    setGameMode(d.mode === 'survival' ? 'survival' : 'campaign');
    if (d.bd && d.bd.cw != null) setBoard(RV.boardFor(d.bd.cw, d.bd.rh));
    else { setBoard(null); RV.boardKey = ''; if (d.bd) setGridRadius(d.bd.gr); }
    if (d.ter) state.terrain = d.ter.map(([q, r, type]) => ({ q, r, type }));
    setBiome(BIOMES[d.bi] || BIOMES[0]);
    state.difficulty = d.df; state.partyLevel = d.lv; state.partyXP = d.xp; state.xpToNext = d.xn; state.tickMs = d.tm || state.tickMs; state.totalTicks = d.tt || 0;
    if (d.cmp) { state.campaignNode = d.cmp.n; state.campaignTotal = d.cmp.t; state.CAMPAIGN_NODES = d.cmp.types.map((type) => ({ type, label: type })); }
    if (d.sv) {
      if (!S) setSurvivalRun({});
      Object.assign(S, { wave: d.sv.w, phase: d.sv.ph, phaseTick: d.sv.pt, _score: d.sv.sc, best: d.sv.b, nb: d.sv.nb, cl: d.sv.cl, kl: d.sv.kl, bk: d.sv.bk, st: d.sv.st,
        relics: d.sv.rl.map(([icon, name]) => ({ icon, name })), telegraph: d.sv.tel.map(([q, r, b]) => ({ q, r, boss: !!b })) });
    }
    // units: your own hero first, so every "P1 = local player" highlight in the drawing code is yours
    const seen = new Set();
    const pl = d.pl.map((o) => { seen.add(o.i); return RV.entIn(o); });
    const en = d.en.map((o) => { seen.add(o.i); return RV.entIn(o); });
    for (const id of RV.map.keys()) if (!seen.has(id)) RV.map.delete(id);
    [...pl, ...en].forEach((e) => {
      if (e._hb) e.healBeamTarget = RV.map.get(e._hb) || null;
      if (e._mt) e.mimicTarget = RV.map.get(e._mt) || null;
    });
    if (d.you >= 0 && d.you < pl.length) { const me = pl.splice(d.you, 1)[0]; pl.unshift(me); setHostPlaying(true); }
    else setHostPlaying(false);
    state.players = pl; state.enemies = en; state.entities = [...pl, ...en];
    state.killFeed = d.kf || []; state.stats = d.sts || {};
    if (d.sf) state.screenFlash = Object.assign({}, d.sf);
    // a new tick restarts the move tween
    if (d.tc !== RV.lastTc) { RV.lastTc = d.tc; state.tickTimer = 0; state.tickCount = d.tc; }
    // state
    state.running = !!d.run && d.ph === 'game'; state.paused = !!d.pa; state.gameOver = !!d.go;
    // effects that happened since the last snapshot
    for (const ev of d.ev || []) RV.play(ev);
    // banner
    let b = '';
    if (d.ph === 'lobby' || d.ph === 'menu') b = 'Waiting for the host to start…';
    else if (d.ph === 'results') { RV.setBanner(null, RV.buildScoreboard(d)); b = null; }
    else if (state.paused) b = 'Paused by the host';
    else if (!d.run && gameMode !== 'survival') b = 'Between encounters…';
    if (b !== null) RV.setBanner(b);
    if (d.ph !== RV.lastPh) { RV.lastPh = d.ph; if (d.ph === 'game') { state.damageNumbers = []; state.aoeEffects = []; state.trailEffects = []; state.deathEffects = []; state.projectiles = []; } }
  },

  play(ev) {
    const t = ev[0];
    if (t === 'd') spawnDmg(ev[1], ev[2], ev[3], ev[4]);
    else if (t === 'a') spawnAoe(ev[1], ev[2], ev[3], ev[4] != null ? ev[4] * HEX : undefined);
    else if (t === 'p') spawnProjectile({ q: ev[1], r: ev[2] }, { q: ev[3], r: ev[4] }, ev[5], !!ev[6]);
    else if (t === 'x') spawnDeath(ev[1], ev[2], ev[3], !!ev[4]);
    else if (t === 't') spawnTrail(ev[1], ev[2], ev[3]);
    else if (t === 'f') { const e = RV.map.get(ev[1]); if (e) spawnFlash(e); }
    else if (t === 'l') { const a = RV.map.get(ev[1]), b = RV.map.get(ev[2]); if (a && b) triggerLunge(a, b); }
    else if (t === 's') doShake(ev[1]);
    else if (t === 'w') showWaveAnnounce(ev[1], ev[2], ev[3]);
    else if (t === 'm') showMsg(ev[1], ev[2]);
    else if (t === 'c') combatLog(ev[1], ev[2]);
    else if (t === 'u') { const fn = audio[ev[1]]; if (typeof fn === 'function') fn.apply(audio, ev.slice(2)); }
  },

  buildScoreboard(d) {
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const diffNames = ['Easy', 'Normal', 'Hard'];
    const cIcons = ['⚔', '🔥', '🗡', '✚'];
    const surv = gameMode === 'survival' && S;
    const won = !!d.won;
    let h = '';

    // header
    if (surv) {
      const sc = S._score || 0;
      const secs = S.st ? Math.floor((Date.now() - S.st) / 1000) : 0;
      const time = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
      h += `<div style="font-size:24px;font-weight:900;color:#c45a3c;letter-spacing:2px;text-transform:uppercase;text-shadow:0 0 20px rgba(196,90,60,0.3)">OVERRUN AT WAVE ${S.wave}</div>`;
      h += `<div style="font-size:10px;color:#8a7e6e;letter-spacing:1px;text-transform:uppercase;margin:4px 0">Survival · ${esc(d.bn)} · ${diffNames[state.difficulty] || 'Normal'} · ${state.players.length}p</div>`;
      h += `<div style="font-size:11px;color:#888;margin-bottom:6px">${time} · ${S.cl || 0} waves · ${S.kl || 0} kills · ${S.bk || 0} boss${(S.bk || 0) === 1 ? '' : 'es'} · Lv${state.partyLevel}</div>`;
      h += `<div style="font-size:44px;font-weight:900;color:#e8c878;text-shadow:0 0 30px rgba(232,200,120,0.3);letter-spacing:2px;line-height:1;margin:4px 0">${sc}</div>`;
      h += `<div style="font-size:9px;color:#555;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">${S.nb ? '<span style="color:#7ea879">★ New best!</span>' : 'Best ' + (S.best || 0)}</div>`;
    } else {
      h += `<div style="font-size:24px;font-weight:900;color:${won ? '#7ea879' : '#c45a3c'};letter-spacing:2px;text-transform:uppercase">${won ? 'VICTORY' : 'CAMPAIGN FAILED'}</div>`;
      h += `<div style="font-size:10px;color:#8a7e6e;letter-spacing:1px;text-transform:uppercase;margin:4px 0">${esc(d.bn)} · ${diffNames[state.difficulty] || 'Normal'} · ${state.players.length}p · Lv${state.partyLevel}</div>`;
    }

    // titles
    const st = state.stats || {};
    let maxDmg = 0, maxDmgN = '', maxKills = 0, maxKillsN = '', maxHeals = 0, maxHealsN = '';
    for (const [name, s] of Object.entries(st)) {
      if (s.dmgDealt > maxDmg) { maxDmg = s.dmgDealt; maxDmgN = name; }
      if (s.kills > maxKills) { maxKills = s.kills; maxKillsN = name; }
      if (s.heals > maxHeals) { maxHeals = s.heals; maxHealsN = name; }
    }
    const titles = [];
    if (maxDmgN) titles.push(['🏆 MVP', maxDmgN, maxDmg + ' dmg']);
    if (maxKillsN && maxKills > 0) titles.push(['⚔ Executioner', maxKillsN, maxKills + ' kills']);
    if (maxHealsN && maxHeals > 0) titles.push(['💚 Medic', maxHealsN, maxHeals + ' HP']);
    if (titles.length) {
      h += '<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin:8px 0">';
      titles.forEach(([title, who, detail]) => h += `<div style="background:linear-gradient(180deg,#1e1a15,#16130f);border:1px solid rgba(140,120,80,0.3);border-radius:5px;padding:6px 12px;min-width:100px"><div style="color:#b8943e;font-size:10px;letter-spacing:1px;text-transform:uppercase">${title}</div><div style="color:#eee;font-size:12px;font-weight:700">${esc(who)}</div><div style="color:#8a7e6e;font-size:9px">${detail}</div></div>`);
      h += '</div>';
    }

    // per-player cards
    h += '<div style="width:100%;height:1px;background:linear-gradient(90deg,transparent,rgba(140,120,80,0.3),transparent);margin:8px 0"></div>';
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px;width:100%">';
    for (const p of state.players) {
      const s = st[p.name] || { dmgDealt: 0, kills: 0, heals: 0, dmgTaken: 0, moved: 0 };
      const isMVP = p.name === maxDmgN;
      const upIcons = p.upgrades && p.upgrades.length ? p.upgrades.join(' ') : '';
      h += `<div style="background:linear-gradient(180deg,rgba(20,18,46,0.9),rgba(12,10,26,0.9));border:1px solid ${isMVP ? 'rgba(184,148,62,0.35)' : 'rgba(140,120,80,0.2)'};border-radius:5px;padding:8px;text-align:left${isMVP ? ';box-shadow:0 0 10px rgba(184,148,62,0.08)' : ''}">`;
      h += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span style="color:${p.color};font-weight:700;font-size:14px">${esc(p.name)}</span>${isMVP ? '<span style="font-size:8px;color:#b8943e;letter-spacing:1px">MVP</span>' : ''}</div>`;
      h += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:1px 6px;font-size:10px;font-weight:500">`;
      h += `<div style="color:#888">⚔ <span style="color:#ccc">${s.dmgDealt}</span></div>`;
      h += `<div style="color:#888">💀 <span style="color:#ccc">${s.kills}</span></div>`;
      h += `<div style="color:#888">💚 <span style="color:#ccc">${s.heals}</span></div>`;
      h += `<div style="color:#888">🩸 <span style="color:#ccc">${s.dmgTaken}</span></div>`;
      h += '</div>';
      if (upIcons) h += `<div style="margin-top:3px;font-size:9px;color:#555">${cIcons[p.classIdx] || ''} ${upIcons}</div>`;
      h += '</div>';
    }
    h += '</div>';

    // relics
    if (surv && S.relics && S.relics.length) {
      h += `<div style="margin-top:6px;font-size:12px;color:#888">${S.relics.map((r) => r.icon + ' ' + esc(r.name)).join(' · ')}</div>`;
    }

    return h;
  },
};
