// === Audio ===

export const audio = (() => {
  let actx = null;
  let masterGain = null;

  function ensure() {
    if (!actx) {
      try {
        actx = new (window.AudioContext || window.webkitAudioContext)();
        masterGain = actx.createGain();
        masterGain.connect(actx.destination);
        masterGain.gain.value = 0.6;
      } catch (e) { return null; }
    }
    return actx;
  }

  function dest() {
    ensure();
    return masterGain;
  }

  function play(freq, dur, type, vol) {
    const c = ensure();
    if (!c) return;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'square';
    o.frequency.value = freq * (0.95 + Math.random() * 0.1);
    g.gain.setValueAtTime(vol || 0.08, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g);
    g.connect(dest());
    o.start();
    o.stop(c.currentTime + dur);
  }

  function noise(dur, vol) {
    const c = ensure();
    if (!c) return;
    const buf = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.setValueAtTime(vol || 0.06, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(g);
    g.connect(dest());
    src.start();
  }

  return {
    hit()    { play(200, 0.1, 'square', 0.1); noise(0.05, 0.08); },
    crit()   { play(300, 0.08, 'square', 0.12); play(450, 0.12, 'square', 0.1); noise(0.08, 0.1); },
    skill()  { play(500, 0.15, 'sine', 0.08); play(700, 0.1, 'sine', 0.06); },
    heal()   { play(600, 0.2, 'sine', 0.07); play(800, 0.15, 'sine', 0.05); },
    death()  { play(150, 0.3, 'sawtooth', 0.1); play(80, 0.4, 'sawtooth', 0.08); },
    explode() { noise(0.2, 0.15); play(100, 0.15, 'sawtooth', 0.1); },
    poison() { play(180, 0.15, 'sawtooth', 0.06); },
    stun()   { play(100, 0.2, 'square', 0.08); noise(0.08, 0.06); },
    combo()  { play(600, 0.1, 'sine', 0.1); play(900, 0.08, 'sine', 0.08); },
    loot()   { play(800, 0.1, 'sine', 0.06); play(1000, 0.08, 'sine', 0.05); },
    defend() { play(400, 0.08, 'sine', 0.06); play(300, 0.1, 'sine', 0.04); },
    useItem() { play(600, 0.08, 'sine', 0.07); play(800, 0.06, 'sine', 0.05); noise(0.04, 0.04); },
    dangerClose() { play(220, 0.12, 'sine', 0.04); play(180, 0.15, 'sine', 0.03); },
    bomberDrop()  { play(250, 0.12, 'square', 0.07); play(150, 0.15, 'sawtooth', 0.05); },
    ambush()  { noise(0.06, 0.12); play(400, 0.06, 'square', 0.1); play(250, 0.08, 'square', 0.08); },
    summon()  { play(200, 0.15, 'sawtooth', 0.07); play(300, 0.1, 'sawtooth', 0.05); noise(0.08, 0.05); },
    hiss()    { noise(0.15, 0.08); play(150, 0.2, 'sawtooth', 0.05); },

    tick(urgent) {
      noise(urgent ? 0.06 : 0.04, urgent ? 0.12 : 0.07);
      play(urgent ? 500 : 800, urgent ? 0.1 : 0.06, 'square', urgent ? 0.06 : 0.04);
    },
    metronome(intensity) {
      play(1800, 0.02 + intensity * 0.03, 'sine', 0.02 + intensity * 0.01);
    },
    victory() {
      [523, 659, 784].forEach((f, i) => setTimeout(() => play(f, 0.3, 'sine', 0.1), i * 120));
    },
    defeat() {
      [300, 250, 200].forEach((f, i) => setTimeout(() => play(f, 0.4, 'sawtooth', 0.08), i * 200));
    },
    levelup() {
      [400, 500, 600, 800].forEach((f, i) => setTimeout(() => play(f, 0.2, 'sine', 0.08), i * 80));
    },
    bossDeath() {
      noise(0.3, 0.18);
      play(80, 0.5, 'sawtooth', 0.12);
      play(60, 0.6, 'sawtooth', 0.1);
      setTimeout(() => { play(120, 0.3, 'sine', 0.1); play(200, 0.2, 'sine', 0.08); }, 200);
    },
    bossPhase() {
      noise(0.15, 0.12);
      play(80, 0.3, 'sawtooth', 0.12);
      play(120, 0.2, 'square', 0.08);
      setTimeout(() => play(200, 0.15, 'sine', 0.06), 150);
    },
    dragonBreath() {
      noise(0.25, 0.14);
      play(120, 0.3, 'sawtooth', 0.1);
      play(80, 0.35, 'sawtooth', 0.08);
    },
    golemPound() {
      noise(0.15, 0.16);
      play(60, 0.4, 'sine', 0.12);
      play(90, 0.3, 'sine', 0.08);
    },

    // ambient drone
    _drone: null,
    _droneGain: null,

    startDrone() {
      if (this._drone) return;
      const c = ensure();
      this._droneGain = c.createGain();
      this._droneGain.gain.value = 0;
      this._droneGain.connect(dest());
      const o1 = c.createOscillator();
      o1.type = 'sine';
      o1.frequency.value = 55;
      o1.connect(this._droneGain);
      o1.start();
      const o2 = c.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = 82.5;
      const g2 = c.createGain();
      g2.gain.value = 0.4;
      o2.connect(g2);
      g2.connect(this._droneGain);
      o2.start();
      this._drone = [o1, o2];
      this._droneGain.gain.linearRampToValueAtTime(0.025, c.currentTime + 1);
    },

    stopDrone() {
      if (!this._drone || !this._droneGain) return;
      const c = ensure();
      this._droneGain.gain.linearRampToValueAtTime(0, c.currentTime + 0.5);
      const refs = this._drone;
      setTimeout(() => refs.forEach(o => { try { o.stop(); } catch (e) {} }), 600);
      this._drone = null;
      this._droneGain = null;
    },

    setBossDrone(isBoss) {
      if (!this._droneGain) return;
      const c = ensure();
      this._droneGain.gain.linearRampToValueAtTime(isBoss ? 0.04 : 0.025, c.currentTime + 0.3);
    },

    setVolume(v) {
      if (masterGain) {
        const c = ensure();
        masterGain.gain.linearRampToValueAtTime(v, c.currentTime + 0.05);
      }
    },
  };
})();
