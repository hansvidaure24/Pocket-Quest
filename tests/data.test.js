import './harness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { state } from '../js/state.js';
import { BOSSES, buildCampaign, CLASSES, ENEMIES } from '../js/data.js';
import { SWARMLING } from '../js/survival.js';

test('four classes, each with two loadouts', () => {
  assert.equal(CLASSES.length, 4);
  for (const c of CLASSES) {
    assert.equal(c.loadouts.length, 2, c.name);
    assert.ok(c.hp > 0 && c.cd > 0 && c.ability, c.name);
  }
});

test('the README counts match the game data', () => {
  const readme = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const [, enemies, bosses] = readme.match(/(\d+) enemy types, (\d+) bosses/);
  // Survival adds the Swarmling on top of the campaign roster
  assert.equal(Number(enemies), ENEMIES.length + 1);
  assert.equal(Number(bosses), BOSSES.length);
  assert.equal(SWARMLING.name, 'Swarmling');
});

test('every enemy and boss has a unique name and an AI', () => {
  const all = [...ENEMIES, ...BOSSES, SWARMLING];
  assert.equal(new Set(all.map(e => e.name)).size, all.length);
  for (const e of all) assert.ok(e.ai && e.hp > 0, e.name);
  for (const b of BOSSES) assert.match(b.ai, /^boss_/, b.name);
});

for (const [length, events] of [[4, 1], [6, 2]]) {
  test(`a ${length}-stop campaign has ${events} event(s) and ends on the boss`, () => {
    buildCampaign(length);
    const nodes = state.CAMPAIGN_NODES;
    assert.equal(nodes.length, length);
    assert.equal(state.campaignTotal, length);
    assert.equal(nodes.at(-1).type, 'boss');
    assert.equal(nodes.filter(n => n.type === 'event').length, events);
    assert.equal(nodes.filter(n => n.type === 'boss').length, 1);
  });
}
