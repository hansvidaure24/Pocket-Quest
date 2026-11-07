import './harness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { GRID_R, getReachable, h2p, hDist, hexRound, hNbrs, inGrid, p2h } from '../js/hex.js';

const O = { q: 0, r: 0 };
// -0 and 0 are the same hex
const at = (h, q, r) => assert.ok(h.q === q && h.r === r, `expected ${q},${r} got ${h.q},${h.r}`);

test('distance counts steps on the hex grid', () => {
  assert.equal(hDist(O, O), 0);
  assert.equal(hDist(O, { q: 1, r: 0 }), 1);
  assert.equal(hDist(O, { q: 2, r: -1 }), 2);
  assert.equal(hDist({ q: 3, r: -3 }, O), 3);
  assert.equal(hDist({ q: -2, r: 4 }, { q: 1, r: 1 }), 3);
});

test('every hex has six neighbours, all one step away', () => {
  const n = hNbrs(2, -1);
  assert.equal(n.length, 6);
  assert.equal(new Set(n.map(h => h.q + ',' + h.r)).size, 6);
  for (const h of n) assert.equal(hDist(h, { q: 2, r: -1 }), 1);
});

test('rounding snaps to the nearest hex', () => {
  at(hexRound(0.1, -0.2), 0, 0);
  at(hexRound(1.4, 0.1), 1, 0);
  at(hexRound(-0.6, 1.2), -1, 1);
});

test('pixel to hex undoes hex to pixel across the whole board', () => {
  for (let q = -GRID_R; q <= GRID_R; q++) {
    for (let r = -GRID_R; r <= GRID_R; r++) {
      if (!inGrid(q, r)) continue;
      const { x, y } = h2p(q, r);
      at(p2h(x, y), q, r);
    }
  }
});

test('the board is a hexagon of radius GRID_R', () => {
  assert.ok(inGrid(GRID_R, 0));
  assert.ok(inGrid(-GRID_R, GRID_R));
  assert.ok(!inGrid(GRID_R + 1, 0));
  assert.ok(!inGrid(GRID_R, 1));
});

test('rogues reach two steps, everyone else one', () => {
  const warrior = { q: 0, r: 0, hp: 6, classIdx: 0 };
  const rogue = { q: 0, r: 0, hp: 4, classIdx: 2 };
  assert.equal(getReachable(warrior).length, 6);
  // two steps out on a clear board: the 6 neighbours, the 12 hexes beyond, and back home
  assert.equal(getReachable(rogue).length, 19);
  assert.equal(getReachable({ ...warrior, hp: 0 }).length, 0);
});
