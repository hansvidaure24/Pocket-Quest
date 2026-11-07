# Pocket Quest — Game Design Document

## Overview

Jackbox meets For The King meets Crypt of the Necrodancer. A shared screen (TV/PC) shows the world on a hex grid, each player's phone is their private controller. Players join a lobby, pick a class and loadout, then move their characters in real-time through a short campaign of encounters. Everyone moves simultaneously on a tick-based system — it feels real-time but syncs every beat. 2–4 players, 12 minutes per session.

---

## Game Flow

### 1. Lobby (~1 min)
Players scan a QR code / enter a room code on their phone browser to join. Each player picks a class and configures their loadout (2 choices). Host picks tick speed: **Chill** (2.0s), **Normal** (1.5s), or **Frantic** (1.0s). Host starts when everyone's ready.

### 2. Campaign
A short hex-grid map with 4 encounter zones connected by paths. Party moves through the map together. Each zone is a randomized encounter: combat (3 of 4 zones) or an event (1 of 4 zones). If the map forks, the party votes on phones which path to take. Majority wins, ties are random.

### 3. Combat (~2.5 min per encounter)
Tick-based simultaneous movement on a hex grid. Every tick (~1.5 sec), each player inputs a direction or action on their phone. All inputs resolve at once. Enemies move on the same tick via AI. Combat ends when all enemies are dead or all players are dead.

### 4. Results (~30 sec)
Win/lose screen with stats and titles. Immediate option to run again with a new campaign.

---

## Tick System

The core loop. Every ~1.5 seconds, one tick resolves:

1. **Input window** (~1.2 sec) — each player swipes a direction or taps an action on their phone
2. **Resolve** (~0.3 sec) — server processes all inputs simultaneously:
   - Movement: all characters move 1 hex in their chosen direction
   - Collisions: two units moving to the same hex = both bounce back to origin
   - Attacks: if a player faces an enemy in an adjacent hex and chose "attack", damage applies
   - Skills/items resolve after movement, before enemy actions
   - Enemy AI moves/attacks
3. **Animate** — shared screen shows all movement and actions as a quick simultaneous beat
4. No input on a tick = your character stands still (no auto-defend needed, you just don't move)

**Pacing:** Feels like a heartbeat. Configurable in lobby — 2.0s (Chill), 1.5s (Normal), 1.0s (Frantic). Experienced players act every tick. New players can skip ticks and catch up — standing still is safe-ish, not a penalty.

**Why ticks, not true real-time:**
- Easy to network — one state sync per tick, not continuous
- Easy to read on shared screen — everything moves in beats, not chaos
- Tactical — you have a moment to think each tick
- Deterministic — no lag advantage, no desyncs

---

## Hex Grid Combat

**Grid size:** ~9x9 hexes per encounter arena. Small enough to force engagement within a few ticks.

**Spawn positions:** Party spawns together on one edge, enemies on the opposite side, 3–4 hexes apart. Combat starts within 2 ticks — no boring walk phase.

**Positioning matters:**
- **Flanking:** Attacking an enemy from the opposite side of an ally = +1 dmg
- **Blocking:** Standing in a hex blocks enemy movement through it — Warrior can bodyblock for Mage
- **Range:** Melee = adjacent hex. Ranged (Mage) = 2 hexes. You must face the target.
- **Terrain:** Some hexes are walls (impassable), some are hazards (1 dmg if you stand on them), some are cover (+1 defense)

**Phone controls:**
- Swipe in a direction = move 1 hex that way next tick
- Tap center = attack (hits adjacent hex you're facing)
- Tap skill button = use class ability (replaces attack for this tick)
- Tap item button = use consumable
- Direction of last swipe = facing direction

---

## Classes & Loadouts

| Class   | HP | Move | Range | Ability               | Loadout A (pick 1)          | Loadout B (pick 1)            |
|---------|----|------|-------|-----------------------|-----------------------------|-------------------------------|
| Warrior | 6  | 1    | Melee | Cleave (hit all adjacent enemies) | Heavy Axe (2 dmg, move every 2 ticks) | Shield Bash (1 dmg, push enemy 1 hex) |
| Mage    | 4  | 1    | 2 hex | Fireball (2 hex AoE, 1 dmg, 3 tick cooldown) | Staff of Power (+1 fireball dmg) | Barrier Tome (place a 1-hit shield on a hex) |
| Rogue   | 4  | 2    | Melee | Dash (move 3 hexes in a line, dmg first enemy hit) | Daggers (attack twice per tick) | Cloak (invisible for 2 ticks, 5 tick cooldown) |
| Cleric  | 5  | 1    | Melee | Heal (restore 2 HP to adjacent ally) | Mace (1 dmg, heal self 1 on kill) | Holy Symbol (heal pulses 1 HP to all allies within 2 hex) |

**Speed = hex movement per tick.** Rogue moves 2 hexes per tick, everyone else moves 1. This replaces the old "speed stat" — positioning IS your speed advantage now.

---

## Enemies

| Name         | HP | Move | Behavior                                                        |
|--------------|----|------|-----------------------------------------------------------------|
| Mimic        | 3  | 1    | Mirrors the nearest player's movement 1 tick delayed            |
| Charger      | 4  | 0/2  | Stands still 1 tick, then charges 2 hexes toward nearest player (2 dmg on hit) |
| Splasher     | 2  | 1    | Moves toward center of player group, explodes on death (1 dmg adjacent) |
| Healer       | 2  | 1    | Stays 2 hexes from nearest ally, heals nearest enemy 1 HP/tick  |
| Tank         | 6  | 1    | Moves toward nearest player, blocks hexes for other enemies to path around |
| Glass Cannon | 2  | 1    | Stays at 2 hex range, shoots for 3 dmg every 2 ticks. Runs if player gets adjacent |

**Enemy AI is simple and readable.** Each enemy has one behavior. Players should be able to predict what an enemy will do — the challenge is coordinating the party to exploit it.

**Visual telegraphing:** Every enemy must broadcast its next action 1 tick before it happens. Charger glows before charging. Glass Cannon shows a targeting line before shooting. Splasher pulses faster as HP drops. If a player can't predict what kills them, the enemy design failed — not the player.

Each encounter: 2–3 enemy types, 3–5 total enemies scaled to party size.

**Boss:** One unique enemy per campaign with a special mechanic (e.g., moves every tick and leaves hazard hexes behind, or has a shield that only breaks from flanking). Higher stats. Always the final zone.

---

## Events (non-combat zones)

Random draw, 1 per campaign:
- **Merchant:** Each player privately sees a trade offer on their phone — swap current loadout piece for a random one. Accept or decline.
- **Shrine:** Party votes to pray. 50/50 — heal all players 2 HP or trigger a bonus enemy wave.
- **Chest:** One random player gets a one-use consumable (bomb: 2 dmg AoE on a hex, potion: full heal, smoke: party invisible for 3 ticks next combat).

---

## Death & Ghosts

Dead players become ghosts: they can still move on the grid but can't attack or be hit. Ghosts grant +1 dmg to any living ally they're adjacent to. Ghost players are still playing — positioning your ghost to buff allies is the skill expression. No one sits out.

**Comeback scaling:** When a player dies, all remaining enemies lose 1 max HP (applied immediately). This prevents a snowball where one early death makes the encounter unwinnable. Combined with ghost buffs (+1 dmg per ghost adjacent), a 2-player wipe still leaves the survivors with a fighting chance.

**Ghosts can body-block.** Ghosts occupy hexes and enemies can't move through them. A dead Warrior can still tank by positioning their ghost in a chokepoint. This keeps ghost gameplay tactical, not just "stand next to an ally."

---

## End-of-Run Stats & Titles

| Title       | Condition                    |
|-------------|------------------------------|
| MVP         | Most total damage dealt       |
| Glass Jaw   | First player to die           |
| Wall        | Most damage blocked/bodyblocked |
| Medic       | Most healing done             |
| Untouchable | Least damage taken            |
| Ghost Carry | Most ticks spent buffing allies as ghost |
| Speedrunner | Most hexes moved              |

---

## Tech Plan

**Engine:** Vanilla JavaScript + HTML5 Canvas. No frameworks, no build step.

**Shared screen (host.html):**
- Lobby, Campaign, Combat, Survival, Results — all in one page
- Hex grid rendered on Canvas
- Tick engine: configurable loop (1.0–2.0s), collects inputs, resolves state, broadcasts, animates
- Enemy AI (one behavior function per enemy type)
- Camera: auto-zoom to fit all living units + padding, smooth lerp between ticks

**Phone controller (controller.html):**
- Lightweight HTML/JS page, no app install
- Players join via room code or QR code in phone browser
- Swipe-to-move with tuned hex dead zones, tap-to-attack, skill/item buttons
- Shows HP, cooldowns, nearby threats — optimized for small screens
- Haptic feedback on actions

**Networking (net.js):**
- Three transports tried in order: BroadcastChannel (same browser), WebSocket relay (Cloudflare Worker + Durable Objects), WebRTC (PeerJS)
- One message per player per tick. Tiny payload.
- Auto-reconnect preserves player slot across drops
- Missed input = stand still. No complex disconnect handling needed.

---

## Current scope

**Shipped:**
- 4 classes with 2 loadouts each
- 11 enemy types, 5 bosses, elite traits
- Campaign mode (4 encounter zones, events, boss fight)
- Survival mode (endless waves, per-wave upgrades, relics)
- Tick-based simultaneous movement on phones
- Swipe-to-move, tap-to-attack phone controls with haptic feedback
- End-of-run stats screen with titles
- Cross-network play via Cloudflare Worker relay + WebRTC fallback
- Interactive tutorial
- SVG art, screen shake, damage numbers, hit flash
- GitHub Pages deployment via GitHub Actions

**Not planned:**
- Persistent progression / unlocks
- Skill trees
- Loot drops mid-combat
- More than 4 classes
- Spectator mode
- Fog of war
- Matchmaking / accounts

---

## Paper Playtest Checklist

- [ ] Print a hex grid (~9x9), cut out tokens for players and enemies
- [ ] Write class abilities + loadouts on index cards
- [ ] Write enemy behaviors on sticky notes (one per type)
- [ ] Use a metronome or timer app at 1.5 sec beats for ticks
- [ ] Everyone points a direction simultaneously on each beat, you resolve movement
- [ ] Play 2 full campaigns (8 encounters total)
- [ ] After: does the tick pacing feel right? Is 1.5 sec too fast or slow? Can players read the board? Do phone controls (simulated as pointing) feel intuitive? Does positioning matter or do people just rush in?
