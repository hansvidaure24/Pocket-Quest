// === Hex math ===

import { state } from './state.js';
import { C } from './canvas.js';
import { T_WALL } from './data.js';

export let HEX = 34;
export const SQRT3 = Math.sqrt(3);
export let GRID_R = 4;
export let gameMode = 'campaign';
export let BOARD = null;

// Other modules can't assign an imported binding, so changes go through these
export function setHex(size) { HEX = size; }
export function setGridRadius(r) { GRID_R = r; }
export function setGameMode(mode) { gameMode = mode; }
export function setBoard(board) { BOARD = board; }
let _hexCache = { r: -1, list: [] };

export function boardHexes() {
  if (BOARD) return BOARD.list;
  if (_hexCache.r !== GRID_R) {
    const list = [];
    for (let q = -GRID_R; q <= GRID_R; q++) {
      for (let r = -GRID_R; r <= GRID_R; r++) {
        if (hDist({ q, r }, { q: 0, r: 0 }) <= GRID_R) list.push({ q, r });
      }
    }
    _hexCache = { r: GRID_R, list };
  }
  return _hexCache.list;
}

export function rk(v) {
  return v === true ? 1 : (v || 0);
}

export function inLane(q, r) {
  return !!BOARD && BOARD.lane.has(q + ',' + r);
}

export function h2p(q, r) {
  return {
    x: HEX * (SQRT3 * q + SQRT3 / 2 * r) + C.width / 2 + state.camOffX,
    y: HEX * 1.5 * r + C.height / 2 + state.camOffY
  };
}

export function p2h(px, py) {
  const x = px - C.width / 2 - state.camOffX;
  const y = py - C.height / 2 - state.camOffY;
  const q = (SQRT3 / 3 * x - 1 / 3 * y) / HEX;
  const r = (2 / 3 * y) / HEX;
  return hexRound(q, r);
}

export function hDist(a, b) {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

export function hNbrs(q, r) {
  return [
    { q: q + 1, r }, { q: q - 1, r },
    { q, r: r + 1 }, { q, r: r - 1 },
    { q: q + 1, r: r - 1 }, { q: q - 1, r: r + 1 }
  ];
}

export function inGrid(q, r) {
  return BOARD ? BOARD.cells.has(q + ',' + r) : hDist({ q, r }, { q: 0, r: 0 }) <= GRID_R;
}

// terrain lookups
const _terrainMap = new Map();

export function _terrainMapRebuild() {
  _terrainMap.clear();
  state.terrain.forEach(t => _terrainMap.set(t.q + ',' + t.r, t));
}

export function terrainAt(q, r) {
  return _terrainMap.get(q + ',' + r) || null;
}

export function isWall(q, r) {
  const t = terrainAt(q, r);
  return t && t.type === T_WALL;
}

// ponytail: occupancy map — rebuilt once per tick via _occRebuild(), O(1) lookups
export const _occMap = new Map();

export function _occRebuild() {
  _occMap.clear();
  state.entities.forEach(e => {
    if (e.hp > 0 || e.ghost) _occMap.set(e.q + ',' + e.r, e);
  });
}

export function _occupied(q, r, ex) {
  const e = _occMap.get(q + ',' + r);
  return e && e !== ex ? e : null;
}

export function _enemyAt(q, r) {
  const e = _occMap.get(q + ',' + r);
  return e && e.isEnemy && e.hp > 0 ? e : null;
}

export function isPassable(q, r, ex) {
  if (!inGrid(q, r) || isWall(q, r)) return false;
  if (ex && !ex.isEnemy && inLane(q, r)) return false;
  return !_occupied(q, r, ex);
}

export function hexRound(fq, fr) {
  const fs = -fq - fr;
  let rq = Math.round(fq);
  let rr = Math.round(fr);
  let rs = Math.round(fs);
  const dq = Math.abs(rq - fq);
  const dr = Math.abs(rr - fr);
  const ds = Math.abs(rs - fs);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

// reachable hexes for movement preview
export function getReachable(entity) {
  if (!entity || (entity.hp <= 0 && !entity.ghost)) return [];
  const steps = entity.classIdx === 2 ? 2 : 1;
  const reach = new Set();
  hNbrs(entity.q, entity.r).forEach(n => {
    if (isPassable(n.q, n.r, entity)) {
      reach.add(n.q + ',' + n.r);
      if (steps >= 2) {
        hNbrs(n.q, n.r).forEach(n2 => {
          if (isPassable(n2.q, n2.r, entity)) reach.add(n2.q + ',' + n2.r);
        });
      }
    }
  });
  return [...reach].map(s => {
    const [q, r] = s.split(',').map(Number);
    return { q, r };
  });
}
