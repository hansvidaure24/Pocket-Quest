// Pocket Quest — Game state
// Everything here is shared and changed from many modules, so it lives on one object.

export const state = {
  // timing
  tickMs: 1500,
  tickTimer: 0,
  lastTime: 0,
  originalTickMs: 1500,
  tempoTicks: 0,

  // game flags
  running: false,
  gameOver: false,
  paused: false,
  gamePhase: 'lobby', // 'lobby' | 'game' | 'results'

  // ui
  uiS: 1,
  showHelp: false,
  skillPreview: false,
  keyHintAlpha: 1,
  keyHintShown: false,

  // entities
  entities: [],
  players: [],
  enemies: [],
  terrain: [],

  // input
  pendingInput: null,
  pendingInputs: {},
  controllerSlots: {},
  tickCount: 0,
  totalTicks: 0,

  // HUD messages
  msg: '',
  msgTimer: 0,
  waveLabel: '',
  waveLabelTimer: 0,
  waveAnnounce: { text: '', sub: '', life: 0, maxLife: 0 },
  ratingFlash: { grade: '', color: '', life: 0, maxLife: 0 },

  // VFX arrays
  damageNumbers: [],
  flashEffects: [],
  projectiles: [],
  deathEffects: [],
  aoeEffects: [],
  trailEffects: [],
  statusParticles: [],
  ambientParticles: [],

  // screen effects
  screenShake: { x: 0, y: 0, life: 0, intensity: 0 },
  screenFlash: { color: null, life: 0, maxLife: 0 },
  slowMoTimer: 0,
  slowMoFactor: 1,
  countdownTimer: 0,
  countdownText: '',
  hitStopTimer: 0,

  // camera
  camOffX: 0,
  camOffY: 0,

  // stats & tracking
  stats: {},
  mouseHex: null,
  hoverEntity: null,
  difficulty: 1,
  combatLogLines: [],
  killStreak: 0,
  lastKillTick: 0,
  killFeed: [],

  // progression
  partyXP: 0,
  partyLevel: 1,
  xpToNext: 5,
  tickPulse: 0,
  dpsTicks: [],
  dpsDisplay: 0,
  encDmgTaken: 0,
  perfectClears: 0,
  waveRatings: [],

  // lobby
  lobbyPlayers: [],

  // campaign
  campaignNode: 0,
  campaignTotal: 4,
  campaignActive: false,
  CAMPAIGN_NODES: [],
};
