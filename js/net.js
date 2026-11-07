// Pocket Quest networking layer — shared by host.html (host) and controller.html (phones).
//
// Transports, in the order a phone tries them:
//   local — BroadcastChannel, host and controller in the same browser (dev/testing)
//   relay — WebSocket relay (relay/ Cloudflare Worker). Works from any network.
//   p2p   — PeerJS / WebRTC. Free, but strict NATs need TURN servers.
//
// The host listens on every transport at once under one room code, and replies to
// each controller over whichever transport that controller used.
(function () {
  'use strict';

  const CFG = Object.assign(
    { relayUrl: '', iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], turnCredentialsUrl: '' },
    window.PQ_CONFIG || {}
  );
  // Dev override — only on localhost
  if(location.hostname==='localhost'||location.hostname==='127.0.0.1'){
    try { Object.assign(CFG, JSON.parse(localStorage.getItem('pq-dev') || '{}')); } catch (e) {}
  }
  const transportOn = (k) => !Array.isArray(CFG.transports) || CFG.transports.includes(k);
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  const PEER_PREFIX = 'pq-';
  const BC_NAME = 'pocket-quest';
  const ROUTE_STALE_MS = 6000; // host forgets a controller after this much silence
  const LINK_DEAD_MS = 10000; // controller reconnects after this much silence

  const relayBase = () => (CFG.relayUrl || '').replace(/\/+$/, '');
  const hasRelay = () => !!relayBase() && transportOn('relay');
  const hasPeer = () => typeof window.Peer === 'function' && transportOn('p2p');
  const hasLocal = () => transportOn('local');
  const backoff = (n) => Math.min(8000, 500 * Math.pow(2, n));

  function randomString(n, alphabet) {
    const a = new Uint32Array(n);
    crypto.getRandomValues(a);
    let s = '';
    for (const x of a) s += alphabet[x % alphabet.length];
    return s;
  }
  const makeCode = () => randomString(4, ALPHABET);

  function openBC() {
    try { return new BroadcastChannel(BC_NAME); } catch (e) { return null; }
  }

  let icePromise = null;
  function getIceServers() {
    if (!icePromise) {
      icePromise = (async () => {
        const list = (CFG.iceServers || []).slice();
        if (CFG.turnCredentialsUrl) {
          try {
            const r = await fetch(CFG.turnCredentialsUrl);
            if (r.ok) {
              const extra = await r.json();
              if (Array.isArray(extra)) list.push(...extra);
            }
          } catch (e) { /* STUN-only is still useful */ }
        }
        return list;
      })();
    }
    return icePromise;
  }

  // A per-tab controller id that survives page reloads, so a phone that refreshes
  // (or drops and reconnects) gets its old player slot back.
  function stableId(code) {
    const key = 'pq-id-' + String(code).toUpperCase();
    try {
      let id = sessionStorage.getItem(key);
      if (!id) { id = 'ctrl_' + randomString(8, 'abcdefghijkmnpqrstuvwxyz23456789'); sessionStorage.setItem(key, id); }
      return id;
    } catch (e) {
      return 'ctrl_' + randomString(8, 'abcdefghijkmnpqrstuvwxyz23456789');
    }
  }

  // ───────────────────────────── HOST ─────────────────────────────
  function createHost(opts) {
    const onMessage = opts.onMessage || (() => {});
    const onStatus = opts.onStatus || (() => {});
    const hostKey = randomString(24, 'abcdefghijklmnopqrstuvwxyz0123456789');
    const routes = new Map(); // controllerId -> { kind, conn, seen }
    const status = { code: null, relay: hasRelay() ? 'connecting' : 'off', p2p: hasPeer() ? 'connecting' : 'off' };
    const bc = openBC();
    let code = null, ws = null, wsFails = 0, peer = null, peerFails = 0, gen = 0, closed = false;

    const clientIds = () => Array.from(routes.keys());
    const emit = () => { try { onStatus(Object.assign({}, status, { clients: routes.size })); } catch (e) { console.error(e); } };

    function touch(id, kind, conn) {
      if (!id) return;
      const r = routes.get(id);
      if (r && r.kind === kind && r.conn === conn) { r.seen = Date.now(); return; }
      routes.set(id, { kind, conn, seen: Date.now() }); // newest transport wins
      emit();
    }
    function drop(id, kind, conn) {
      const r = routes.get(id);
      if (r && r.kind === kind && (!conn || r.conn === conn)) { routes.delete(id); emit(); }
    }
    function deliver(msg, id, kind, conn) {
      if (!msg || typeof msg !== 'object' || !id) return;
      msg.id = id; // trust the transport's identity, not the payload
      touch(id, kind, conn);
      try { onMessage(msg, id, kind); } catch (e) { console.error(e); }
    }

    function stopTransports() {
      gen++;
      if (ws) { const s = ws; ws = null; try { s.close(1000); } catch (e) {} }
      if (peer) { const p = peer; peer = null; try { p.destroy(); } catch (e) {} }
      routes.clear();
    }
    function start() {
      const g = ++gen;
      code = makeCode();
      status.code = code;
      wsFails = 0; peerFails = 0;
      if (hasRelay()) startRelay(g);
      if (hasPeer()) startPeer(g);
      emit();
    }
    function newCode() { stopTransports(); start(); }

    // relay
    function startRelay(g) {
      if (closed || g !== gen) return;
      status.relay = wsFails === 0 ? 'connecting' : wsFails < 3 ? 'reconnecting' : 'down';
      emit();
      let sock;
      try {
        sock = new WebSocket(`${relayBase()}/room/${code}?role=host&key=${encodeURIComponent(hostKey)}`);
      } catch (e) { status.relay = 'down'; emit(); return; }
      ws = sock;
      sock.onmessage = (ev) => {
        if (g !== gen || ev.data === 'pong') return;
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m._evt === 'hosted') { wsFails = 0; status.relay = 'up'; emit(); return; }
        if (m._evt === 'join') { touch(m.id, 'relay', null); return; }
        if (m._evt === 'leave') { drop(m.id, 'relay'); return; }
        if (m.from && m.d) deliver(m.d, m.from, 'relay', null);
      };
      sock.onclose = (ev) => {
        if (ws === sock) ws = null;
        if (closed || g !== gen) return;
        for (const [id, r] of routes) if (r.kind === 'relay') routes.delete(id);
        if (ev.code === 4001) { newCode(); return; } // code already hosted by someone else
        wsFails++;
        status.relay = wsFails < 3 ? 'reconnecting' : 'down';
        emit();
        setTimeout(() => startRelay(g), backoff(wsFails));
      };
    }

    // p2p
    async function startPeer(g) {
      const ice = await getIceServers();
      if (closed || g !== gen) return;
      const p = new window.Peer(PEER_PREFIX + code.toLowerCase(), { debug: 0, config: { iceServers: ice } });
      peer = p;
      p.on('open', () => { if (g === gen) { peerFails = 0; status.p2p = 'up'; emit(); } });
      p.on('connection', (conn) => {
        const metaId = conn.metadata && conn.metadata.id;
        conn.on('open', () => { if (metaId) touch(metaId, 'p2p', conn); });
        conn.on('data', (d) => deliver(d, metaId || (d && d.id), 'p2p', conn));
        const gone = () => { if (metaId) drop(metaId, 'p2p', conn); };
        conn.on('close', gone);
        conn.on('error', gone);
      });
      // Lost the PeerJS signalling server (wifi blip, laptop sleep): existing data
      // connections keep working, but new phones can't find us until we reconnect.
      p.on('disconnected', () => {
        if (closed || g !== gen || p.destroyed) return;
        status.p2p = 'reconnecting'; emit();
        setTimeout(() => { if (g === gen && !p.destroyed && p.disconnected) { try { p.reconnect(); } catch (e) {} } }, backoff(peerFails++));
      });
      p.on('error', (err) => {
        if (closed || g !== gen) return;
        if (err.type === 'unavailable-id') { newCode(); return; } // code collision on the public broker
        if (err.type === 'browser-incompatible') { status.p2p = 'off'; emit(); return; }
        if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
          status.p2p = peerFails < 3 ? 'reconnecting' : 'down'; emit();
        }
      });
    }

    // local (same browser)
    if (bc) {
      bc.onmessage = (ev) => {
        const m = ev.data;
        if (!m || m._room !== code) return;
        if (m._probe) { bc.postMessage({ _room: code, _probeAck: true, _to: m.id }); return; }
        if (m.d) deliver(m.d, m.d.id, 'local', null);
      };
    }

    function send(id, msg) {
      const r = routes.get(id);
      if (!r) return false;
      try {
        if (r.kind === 'relay') { if (!ws || ws.readyState !== 1) return false; ws.send(JSON.stringify({ to: id, d: msg })); }
        else if (r.kind === 'p2p') { if (!r.conn.open) return false; r.conn.send(msg); }
        else if (r.kind === 'local') { if (!bc) return false; bc.postMessage({ _room: code, _to: id, d: msg }); }
      } catch (e) { return false; }
      return true;
    }
    function broadcast(msg) { for (const id of routes.keys()) send(id, msg); }

    const sweep = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const [id, r] of routes) if (now - r.seen > ROUTE_STALE_MS) { routes.delete(id); changed = true; }
      if (changed) emit();
    }, 2000);
    // Keep the relay socket alive through NATs/proxies while no phones are connected.
    // The relay answers 'ping' itself without waking the room.
    const heartbeat = setInterval(() => { if (ws && ws.readyState === 1) try { ws.send('ping'); } catch (e) {} }, 25000);

    function close() {
      closed = true;
      clearInterval(sweep); clearInterval(heartbeat);
      stopTransports();
      if (bc) try { bc.close(); } catch (e) {}
    }

    start();
    return {
      get code() { return code; },
      get status() { return Object.assign({}, status, { clients: routes.size }); },
      send, broadcast, clientIds, newCode, close,
      debugRoutes() { return Array.from(routes, ([id, r]) => ({ id, kind: r.kind, open: r.conn ? r.conn.open : null, age: Date.now() - r.seen })); },
    };
  }

  // ─────────────────────────── CONTROLLER ───────────────────────────
  function join(rawCode, id, opts) {
    const code = String(rawCode).trim().toUpperCase();
    const onMessage = opts.onMessage || (() => {});
    const onStatus = opts.onStatus || (() => {});
    let active = null, closed = false, gen = 0, attempt = 0, everConnected = false, lastSeen = 0;

    const setStatus = (state, via, detail) => {
      try { onStatus({ state, via: via || null, detail: detail || '', code }); } catch (e) { console.error(e); }
    };
    const seen = () => { lastSeen = Date.now(); };
    const recv = (m) => { seen(); if (m && typeof m === 'object') try { onMessage(m); } catch (e) { console.error(e); } };

    function lost(t) {
      if (active !== t) return;
      active = null;
      try { t.close(); } catch (e) {}
      if (!closed) connect();
    }

    const transports = {
      local() {
        return new Promise((resolve, reject) => {
          const bc = openBC();
          if (!bc) return reject(new Error('No local channel'));
          const t = {
            kind: 'local',
            send(m) { try { bc.postMessage({ _room: code, d: m }); } catch (e) {} },
            close() { bc.onmessage = null; try { bc.close(); } catch (e) {} },
          };
          let acked = false;
          const timer = setTimeout(() => { if (!acked) { t.close(); reject(new Error('No host in this browser')); } }, 400);
          bc.onmessage = (ev) => {
            const m = ev.data;
            if (!m || m._room !== code || m._to !== id) return;
            if (m._probeAck) { if (!acked) { acked = true; clearTimeout(timer); resolve(t); } return; }
            if (m.d) recv(m.d);
          };
          bc.postMessage({ _room: code, _probe: true, id });
        });
      },

      relay() {
        return new Promise((resolve, reject) => {
          let s, opened = false;
          try { s = new WebSocket(`${relayBase()}/room/${code}?role=client&id=${encodeURIComponent(id)}`); }
          catch (e) { return reject(new Error('Relay unavailable')); }
          const t = {
            kind: 'relay',
            send(m) { if (s.readyState === 1) try { s.send(JSON.stringify(m)); } catch (e) {} },
            close() { s.onclose = null; try { s.close(1000); } catch (e) {} },
          };
          const timer = setTimeout(() => { if (!opened) { t.close(); reject(new Error('Relay timed out')); } }, 6000);
          s.onmessage = (ev) => {
            if (ev.data === 'pong') { seen(); return; }
            let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
            if (m._evt === 'joined') { opened = true; clearTimeout(timer); resolve(t); return; }
            if (m._evt) return;
            recv(m);
          };
          s.onclose = (ev) => {
            clearTimeout(timer);
            if (!opened) reject(new Error(ev.code === 4004 ? 'Room not found' : ev.code === 4003 ? 'Room is full' : 'Relay unavailable'));
            else lost(t);
          };
        });
      },

      async p2p() {
        const ice = await getIceServers();
        return new Promise((resolve, reject) => {
          const p = new window.Peer(undefined, { debug: 0, config: { iceServers: ice } });
          let settled = false, t = null;
          const fail = (msg) => {
            if (settled) return;
            settled = true; clearTimeout(timer);
            try { p.destroy(); } catch (e) {}
            reject(new Error(msg));
          };
          const timer = setTimeout(() => fail('Peer-to-peer timed out'), 10000);
          p.on('error', (err) => fail(err.type === 'peer-unavailable' ? 'Room not found' : 'Peer-to-peer failed (' + err.type + ')'));
          p.on('open', () => {
            const c = p.connect(PEER_PREFIX + code.toLowerCase(), { reliable: true, metadata: { id } });
            t = {
              kind: 'p2p',
              send(m) { if (c.open) try { c.send(m); } catch (e) {} },
              close() { settled = true; try { p.destroy(); } catch (e) {} },
            };
            c.on('open', () => { if (settled) return; settled = true; clearTimeout(timer); resolve(t); });
            c.on('data', recv);
            c.on('close', () => { if (active === t) lost(t); else fail('Connection closed'); });
            c.on('error', () => { if (active === t) lost(t); else fail('Connection error'); });
          });
        });
      },
    };

    async function connect() {
      const g = ++gen;
      setStatus(everConnected ? 'reconnecting' : 'connecting');
      const order = hasLocal() ? ['local'] : [];
      if (hasRelay()) order.push('relay');
      if (hasPeer()) order.push('p2p');
      const errors = [];
      for (const kind of order) {
        if (closed || g !== gen) return;
        try {
          const t = await transports[kind]();
          if (closed || g !== gen) { t.close(); return; }
          active = t; attempt = 0; everConnected = true; seen();
          setStatus('connected', kind);
          return;
        } catch (e) {
          // "No host in this browser" is expected on phones, so don't show it.
          if (kind !== 'local') errors.push((e && e.message) || String(e));
        }
      }
      if (closed || g !== gen) return;
      // A stale/cached net-config.js without a relay is the classic cause of p2p-only failures.
      if (!relayBase() && transportOn('relay')) errors.unshift('Relay not configured');
      // "Room not found" is the actionable one; otherwise show every attempt so failures are diagnosable.
      const detail = errors.find((e) => /not found|full/i.test(e)) || errors.join(' · ') || 'Could not connect';
      if (everConnected) {
        // Host blip or phone changed networks: keep trying quietly.
        setStatus('reconnecting', null, detail);
        setTimeout(() => { if (!closed && g === gen) connect(); }, backoff(attempt++));
      } else {
        setStatus('failed', null, detail);
      }
    }

    const watchdog = setInterval(() => {
      if (active && Date.now() - lastSeen > LINK_DEAD_MS) lost(active);
    }, 2000);

    connect();
    return {
      code,
      send(m) { if (active) active.send(m); },
      get connected() { return !!active; },
      get via() { return active ? active.kind : null; },
      close() { closed = true; gen++; clearInterval(watchdog); if (active) { try { active.close(); } catch (e) {} } active = null; },
    };
  }

  window.PQNet = { createHost, join, stableId, config: CFG, hasRelay };
})();
