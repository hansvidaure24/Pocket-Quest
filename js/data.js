import { state } from './state.js';
import { ITEMS } from './combat.js';

export function buildCampaign(length) {
  state.campaignTotal = length;
  state.CAMPAIGN_NODES = [];
  const biomeVal = document.getElementById('biome-sel').value;
  activeBiome = biomeVal === 'random'
    ? BIOMES[Math.floor(Math.random() * BIOMES.length)]
    : BIOMES[parseInt(biomeVal)];
  TCOL = activeBiome.tcol;
  TBORD = activeBiome.tbord;
  const eventSlots = new Set();
  eventSlots.add(Math.floor(length / 2));
  if (length >= 6) eventSlots.add(Math.floor(length / 4));
  for (let i = 0; i < length - 1; i++) {
    if (eventSlots.has(i)) {
      state.CAMPAIGN_NODES.push({ type: 'event', label: 'Event' });
    } else {
      state.CAMPAIGN_NODES.push({ type: 'combat', label: 'Fight ' + (state.CAMPAIGN_NODES.filter(n => n.type === 'combat').length + 1) });
    }
  }
  state.CAMPAIGN_NODES.push({ type: 'boss', label: 'BOSS' });
}

// === Terrain ===
export const T_WALL = 1;
export const T_HAZARD = 2;
export const T_COVER = 3;
export const T_LAVA = 4;
export let TCOL = { [T_WALL]: '#2d2d44', [T_HAZARD]: '#4a1a1a', [T_COVER]: '#1a3a2a', [T_LAVA]: '#4a1a00' };
export let TBORD = { [T_WALL]: '#444466', [T_HAZARD]: '#8b2020', [T_COVER]: '#2a6a4a', [T_LAVA]: '#a35530' };
export const TICON = { [T_WALL]: '▪', [T_HAZARD]: '☠', [T_COVER]: '🛡', [T_LAVA]: '🔥' };

// === Biomes ===
export const BIOMES = [
  {
    name: 'Crypt',
    hexA: '#1a1c3a', hexB: '#1e2042', gridLine: 'rgba(80,60,160,0.3)',
    tcol: { [T_WALL]: '#3a3a58', [T_HAZARD]: '#5a2222', [T_COVER]: '#224a34', [T_LAVA]: '#5a2200' },
    tbord: { [T_WALL]: '#5a5a7a', [T_HAZARD]: '#a03030', [T_COVER]: '#3a8a5a', [T_LAVA]: '#c06030' },
    enemyPool: [0, 1, 2, 3, 4, 5], bossPool: [0, 1],
    narr: ['The crypt exhales stale air. Something stirs below.', 'Coffins line the walls. Not all of them are closed.', 'The dead don\'t rest here. They wait.'],
    eventNarr: ['An offering table, undisturbed for centuries.', 'Candlelight flickers in a burial alcove.'],
  },
  {
    name: 'Swamp',
    hexA: '#122a1a', hexB: '#163220', gridLine: 'rgba(50,130,70,0.28)',
    tcol: { [T_WALL]: '#223a22', [T_HAZARD]: '#3a4a22', [T_COVER]: '#224a34', [T_LAVA]: '#2a4a08' },
    tbord: { [T_WALL]: '#3a6a3a', [T_HAZARD]: '#708a2a', [T_COVER]: '#3a8a5a', [T_LAVA]: '#5a8a3a' },
    enemyPool: [1, 2, 4, 5, 6, 7], bossPool: [2, 3],
    narr: ['The bog bubbles. Shapes move beneath the murk.', 'Vines coil around old bones. The swamp is hungry.', 'Mist clings to everything. Visibility: bad.'],
    eventNarr: ['A dry hillock rises from the mire. Shelter.', 'Strange mushrooms glow along the path.'],
  },
  {
    name: 'Volcano',
    hexA: '#2a1210', hexB: '#321614', gridLine: 'rgba(180,60,25,0.28)',
    tcol: { [T_WALL]: '#4a2218', [T_HAZARD]: '#5a2222', [T_COVER]: '#3a3a22', [T_LAVA]: '#5a2200' },
    tbord: { [T_WALL]: '#8a4030', [T_HAZARD]: '#a03030', [T_COVER]: '#6a6a3a', [T_LAVA]: '#c06030' },
    enemyPool: [0, 2, 3, 6, 7, 8], bossPool: [0, 3],
    narr: ['The heat is unbearable. The rock itself bleeds fire.', 'Ash falls like snow. Nothing grows here.', 'Lava rivers cut the ground. Choose your path.'],
    eventNarr: ['A cooled lava tube offers brief respite.', 'Obsidian crystals hum with trapped energy.'],
  },
  {
    name: 'Ruins',
    hexA: '#201e18', hexB: '#28241c', gridLine: 'rgba(150,120,70,0.25)',
    tcol: { [T_WALL]: '#3a3828', [T_HAZARD]: '#4a3a22', [T_COVER]: '#224a30', [T_LAVA]: '#4a3a08' },
    tbord: { [T_WALL]: '#5a5840', [T_HAZARD]: '#8a6030', [T_COVER]: '#4a7a4a', [T_LAVA]: '#9a6a3a' },
    enemyPool: [0, 1, 3, 4, 5, 8, 9], bossPool: [1, 4],
    narr: ['Crumbling pillars frame the hall. An empire\'s grave.', 'Inscriptions warn of guardians. The warnings were right.', 'Wind howls through broken arches. You are exposed.'],
    eventNarr: ['A collapsed library. Some tomes are still intact.', 'Daylight filters through a shattered dome.'],
  },
];
export let activeBiome = BIOMES[0];
export function setBiome(b) { activeBiome = b; TCOL = b.tcol || TCOL; TBORD = b.tbord || TBORD; }

// === Classes & Enemies ===
export const CLASSES = [
  { name: 'Warrior', hp: 6, color: '#c45a3c', ability: 'Cleave', cd: 3, desc: 'Melee tank. Cleave hits and pushes all adjacent.',
    loadouts: [
      { name: 'Heavy Axe', desc: '+1 base dmg', apply(p) { p.dmgBonus++; } },
      { name: 'Shield Wall', desc: '+2 max HP, auto-defend every 4 ticks', apply(p) { p.maxHp += 2; p.hp += 2; p.autoDefend = 4; } },
    ] },
  { name: 'Mage', hp: 4, color: '#6b8cae', ability: 'Fireball', cd: 3, desc: 'Ranged caster. Aim fireball 3 hexes out, 1-hex blast + poison.',
    loadouts: [
      { name: 'Staff of Power', desc: '+1 fireball dmg', apply(p) { p.dmgBonus++; } },
      { name: 'Barrier Tome', desc: 'Shield Scroll + auto-barrier every 6 ticks', apply(p) { p.item = ITEMS.find(i => i.name === 'Shield Scroll'); p.autoBarrier = 6; } },
    ] },
  { name: 'Rogue', hp: 4, color: '#7ea879', ability: 'Dash', cd: 2, desc: 'Fast melee. Dash 3 hex, hit first enemy.',
    loadouts: [
      { name: 'Twin Daggers', desc: '10% double-strike chance', apply(p) { p.doubleStrike = 0.1; } },
      { name: 'Shadow Cloak', desc: '15% dodge chance + dodge first hit', apply(p) { p.dodgeNext = true; p.dodgeChance = 0.15; } },
    ] },
  { name: 'Cleric', hp: 5, color: '#c9973e', ability: 'Heal', cd: 2, desc: 'Support. Heals ally 2 HP or revives adjacent ghost.',
    loadouts: [
      { name: 'Battle Mace', desc: '+1 dmg, heal 1 on kill', apply(p) { p.dmgBonus++; p.vampiric = true; } },
      { name: 'Holy Symbol', desc: 'Aura heals faster (every 3 ticks)', apply(p) { p.auraSpeed = 3; } },
    ] },
];

export const ENEMIES = [
  { name: 'Charger', hp: 4, color: '#d47a3c', ai: 'charger', desc: 'Telegraphs 1 tick, charges 2 hex for 2 dmg.' },
  { name: 'Splasher', hp: 2, color: '#b87a8a', ai: 'splasher', desc: 'Runs to party center. Explodes on death (1 dmg adj).' },
  { name: 'GlassCannon', hp: 2, color: '#a38530', ai: 'glasscannon', desc: 'Kites at range 2. Shoots for 3 dmg every 2 ticks.' },
  { name: 'Tank', hp: 6, color: '#708090', ai: 'tank', desc: 'Slow, tanky. Bodyblocks. 1 dmg melee.' },
  { name: 'Healer', hp: 2, color: '#98fb98', ai: 'healer', desc: 'Heals nearest hurt enemy 1 HP/tick.' },
  { name: 'Mimic', hp: 3, color: '#cc88ff', ai: 'mimic', desc: 'Mirrors nearest player movement 1 tick delayed. 1 dmg melee.' },
  { name: 'Bomber', hp: 3, color: '#cc6644', ai: 'bomber', desc: 'Drops hazard tiles every 3 ticks. Flees when adjacent.' },
  { name: 'Assassin', hp: 2, color: '#554466', ai: 'assassin', desc: 'Invisible until adjacent. 3 dmg first strike, then 1 dmg.' },
  { name: 'ShieldBearer', hp: 5, color: '#6688aa', ai: 'shieldbearer', desc: 'Immune from front. Must be flanked or hit from behind.' },
  { name: 'Summoner', hp: 3, color: '#aa66aa', ai: 'summoner', desc: 'Summons 1HP minions every 3 ticks. Stays at range.' },
];

// Boss definitions
export const BOSSES = [
  { name: 'Warlord', hp: 12, color: '#c44030', ai: 'boss_warlord', desc: 'Charges every 3 ticks. Summons a Charger on tick 5,10,15.' },
  { name: 'Lich', hp: 8, color: '#9933ff', ai: 'boss_lich', desc: 'Ranged 2 dmg. Raises dead enemies as 1HP Splashers.' },
  { name: 'Hydra', hp: 10, color: '#22cc88', ai: 'boss_hydra', desc: 'Splits into 2 Hydra Heads at 50% HP. Poison spit.' },
  { name: 'Dragon', hp: 14, color: '#cc3300', ai: 'boss_dragon', desc: 'Breath weapon in a line every 4 ticks. Flies to new position.' },
  { name: 'Golem', hp: 18, color: '#8a8070', ai: 'boss_golem', desc: 'Slow, immune to status. Ground pound AoE every 3 ticks.' },
];
