// Pocket Quest — Sprites

import { ctx } from './canvas.js';

const SPRITES = {};
const SPRITE_PATHS = {
  warrior: 'assets/classes/warrior.svg',
  mage: 'assets/classes/mage.svg',
  rogue: 'assets/classes/rogue.svg',
  cleric: 'assets/classes/cleric.svg',
  charger: 'assets/enemies/charger.svg',
  splasher: 'assets/enemies/splasher.svg',
  glasscannon: 'assets/enemies/glasscannon.svg',
  tank: 'assets/enemies/tank.svg',
  healer: 'assets/enemies/healer.svg',
  mimic: 'assets/enemies/mimic.svg',
  swarm: 'assets/enemies/swarmling.svg',
  warlord: 'assets/bosses/warlord.svg',
  lich: 'assets/bosses/lich.svg',
  hydra: 'assets/bosses/hydra.svg',
  'terrain-wall': 'assets/ui/terrain-wall.svg',
  'terrain-hazard': 'assets/ui/terrain-hazard.svg',
  'terrain-cover': 'assets/ui/terrain-cover.svg',
  'terrain-lava': 'assets/ui/terrain-lava.svg',
  bomb: 'assets/items/bomb.svg',
  potion: 'assets/items/potion.svg',
  smoke: 'assets/items/smoke.svg',
  scroll: 'assets/items/scroll.svg',
  'frost-bomb': 'assets/items/frost-bomb.svg',
  'war-horn': 'assets/items/war-horn.svg',
  'poison-vial': 'assets/items/poison-vial.svg',
  'stun-trap': 'assets/items/stun-trap.svg',
  'shield-bash-item': 'assets/items/shield-bash.svg',
  heart: 'assets/ui/heart.svg',
  shield: 'assets/ui/shield.svg',
  skull: 'assets/ui/skull.svg',
  ghost: 'assets/ui/ghost.svg',
  crown: 'assets/ui/crown.svg',
  sword: 'assets/ui/sword.svg',
  'xp-star': 'assets/ui/xp-star.svg',
};

for (const [k, p] of Object.entries(SPRITE_PATHS)) {
  const img = new Image();
  img.src = p;
  SPRITES[k] = img;
}

function spr(k) {
  const s = SPRITES[k];
  return s && s.complete && s.naturalWidth ? s : null;
}

export const CLASS_SPR = ['warrior', 'mage', 'rogue', 'cleric'];
export const BOSS_SPR = { boss_warlord: 'warlord', boss_lich: 'lich', boss_hydra: 'hydra' };
export const TERRAIN_SPR = { [1]: 'terrain-wall', [2]: 'terrain-hazard', [3]: 'terrain-cover', [4]: 'terrain-lava' };

export function drawSpr(key, cx, cy, sz, flash) {
  const s = spr(key);
  if (!s) return false;
  ctx.save();
  if (flash) ctx.filter = 'brightness(3)';
  ctx.drawImage(s, cx - sz / 2, cy - sz / 2, sz, sz);
  if (flash) ctx.filter = 'none';
  ctx.restore();
  return true;
}
