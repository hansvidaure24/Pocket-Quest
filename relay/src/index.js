// Pocket Quest relay — a tiny WebSocket message relay on Cloudflare Workers.
//
// One Durable Object per room code. The shared screen connects as the host, phones
// connect as clients. The relay never looks at game data, it only forwards:
//
//   host   -> relay : {"to":"<clientId>"|null, "d":<msg>}   (null = every client)
//   relay  -> client: <msg>
//   client -> relay : <msg>
//   relay  -> host  : {"from":"<clientId>", "d":<msg>}
//
// Control events: host gets {"_evt":"hosted"}, {"_evt":"join","id"}, {"_evt":"leave","id"};
// clients get {"_evt":"joined"}. Close codes: 4001 room taken, 4003 room full,
// 4004 no host. Either side may send the text "ping" and gets "pong" back
// without waking the room.
import { DurableObject } from 'cloudflare:workers';

const CODE_RE = /^\/room\/([A-Z0-9]{4,8})$/i;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_CLIENTS = 12;
const MAX_MSG = 64 * 1024; // board-view snapshots for remote screens can reach ~20 KB

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response('pocket-hex relay ok\n', { headers: { 'content-type': 'text/plain' } });
    }
    const m = url.pathname.match(CODE_RE);
    if (!m) return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(request.headers.get('Origin') || '')) {
      return new Response('Origin not allowed', { status: 403 });
    }
    const code = m[1].toUpperCase();
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
  },
};

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Answered by the runtime itself, so keepalives don't wake a hibernated room.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // Sockets we just closed can linger in getWebSockets() until fully closed.
  open(tag) {
    return this.ctx.getWebSockets(tag).filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  host() {
    return this.open('host')[0] || null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept first, then close with a reason code the browser can read.
    const reject = (code, reason) => {
      server.accept();
      server.close(code, reason);
      return new Response(null, { status: 101, webSocket: client });
    };

    if (role === 'host') {
      const key = url.searchParams.get('key') || '';
      const current = this.host();
      if (current) {
        const stored = await this.ctx.storage.get('hostKey');
        if (stored !== key) return reject(4001, 'room taken');
        // Same host reconnecting (network blip): replace the stale socket.
        try { current.close(1000, 'replaced'); } catch (e) {}
      }
      await this.ctx.storage.put('hostKey', key);
      this.ctx.acceptWebSocket(server, ['host']);
      server.serializeAttachment({ role: 'host' });
      server.send(JSON.stringify({ _evt: 'hosted' }));
      for (const ws of this.open('client')) {
        const a = ws.deserializeAttachment();
        if (a) server.send(JSON.stringify({ _evt: 'join', id: a.id }));
      }
      return new Response(null, { status: 101, webSocket: client });
    }

    if (role === 'client') {
      const id = url.searchParams.get('id') || '';
      if (!ID_RE.test(id)) return reject(4000, 'bad id');
      const host = this.host();
      if (!host) return reject(4004, 'no host');
      // Same controller rejoining replaces its old socket.
      for (const ws of this.ctx.getWebSockets('c:' + id)) {
        try { ws.close(1000, 'replaced'); } catch (e) {}
      }
      const others = this.open('client').filter((ws) => {
        const a = ws.deserializeAttachment();
        return a && a.id !== id;
      });
      if (others.length >= MAX_CLIENTS) return reject(4003, 'room full');
      this.ctx.acceptWebSocket(server, ['client', 'c:' + id]);
      server.serializeAttachment({ role: 'client', id });
      server.send(JSON.stringify({ _evt: 'joined' }));
      host.send(JSON.stringify({ _evt: 'join', id }));
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Bad role', { status: 400 });
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > MAX_MSG) return;
    const a = ws.deserializeAttachment();
    if (!a) return;
    let data;
    try { data = JSON.parse(message); } catch (e) { return; }

    if (a.role === 'host') {
      if (!data || typeof data !== 'object' || data.d === undefined) return;
      const out = JSON.stringify(data.d);
      const targets = data.to ? this.open('c:' + data.to) : this.open('client');
      for (const t of targets) { try { t.send(out); } catch (e) {} }
      return;
    }

    const host = this.host();
    if (host) { try { host.send(JSON.stringify({ from: a.id, d: data })); } catch (e) {} }
  }

  async webSocketClose(ws, code, reason) {
    this.onGone(ws);
    try { ws.close(code === 1005 ? 1000 : code, reason); } catch (e) {}
  }

  async webSocketError(ws) {
    this.onGone(ws);
  }

  onGone(ws) {
    const a = ws.deserializeAttachment();
    if (!a || a.role !== 'client') return;
    // Only announce a leave if no newer socket for the same controller exists.
    const stillHere = this.open('c:' + a.id).some((s) => s !== ws);
    const host = this.host();
    if (!stillHere && host) { try { host.send(JSON.stringify({ _evt: 'leave', id: a.id })); } catch (e) {} }
  }
}
