# Online play (phones joining from anywhere)

The shared screen (`host.html`) hosts a room with a 4-letter code. Phones open
`controller.html?room=CODE` (the QR code) from any network: Wi-Fi, mobile data, a
friend's house. All networking lives in `net.js`. Settings are in `net-config.js`.

## How a phone connects

The host listens on all three transports at once under the same code. Each phone tries
them in this order and keeps the first one that works:

| Transport | What it is | When it works |
|-----------|------------|---------------|
| `local` | BroadcastChannel | Host and controller tabs in the **same browser** (testing on one PC) |
| `relay` | WebSocket via the Cloudflare Worker in `relay/` | **Always**: plain HTTPS/WSS on port 443, works through any NAT or firewall |
| `p2p` | PeerJS / WebRTC through the public PeerJS broker | Most home networks. Often fails on mobile data / strict NATs unless TURN is configured |

Without a relay the game still works on most home networks via p2p. **For reliable
"anyone, anywhere" play, deploy the relay.** It's free and takes about five minutes.

Other behaviour:
- **Reconnects automatically.** If a phone drops (tunnel, Wi-Fi to 4G switch, screen lock),
  it keeps retrying and gets **the same player slot back**. Refreshing the controller page
  also keeps your slot, because the id is stored per tab and per room.
- The host re-registers with the PeerJS broker or relay on its own after a network blip.
- Each phone only receives its own state, over the transport it joined on.
- A wrong code shows "Room not found" instead of pretending to connect.

## Deploying the relay (Cloudflare Workers, free plan)

You need a free Cloudflare account.

```bash
cd relay
npm install
npx wrangler login
npx wrangler deploy
```

`deploy` prints a URL like `https://pocket-hex-relay.<you>.workers.dev`. Then:

1. In `net-config.js`, set `relayUrl: 'wss://pocket-hex-relay.<you>.workers.dev'`.
2. In `relay/wrangler.toml`, lock the relay to your site:
   `ALLOWED_ORIGINS = "https://hansvidaure24.github.io"`, then run `npx wrangler deploy` again.
3. Commit and push. GitHub Pages redeploys the site.

**Whenever you change `net-config.js` or `net.js`, bump the `?v=` number on their `<script>`
tags in both `host.html` and `controller.html`.** GitHub Pages lets browsers cache files
for 10 minutes. Without the bump, a phone can mix a new page with an old config, for example
one with no relay URL. In that case it only tries peer-to-peer and the error says
"Relay not configured".

The page scripts `js/host.js` and `js/controller.js` carry a `?v=` too. Bump it when a change
has to reach hosts and phones right away.

Check it's up by opening `https://pocket-hex-relay.<you>.workers.dev/health`. It should
show `pocket-hex-relay ok`. In the host lobby, the line under the room code should read
`● Online · relay up · p2p up`.

**Cost:** one Durable Object per room, using WebSocket hibernation. The host sends about
5 small messages a second per phone during a game. Casual play should fit in the Workers
Free plan. See Cloudflare's current Durable Objects limits if it gets popular.

### Relay protocol (for reference)

`wss://<relay>/room/<CODE>?role=host&key=<secret>` or `?role=client&id=<controllerId>`

- host → relay: `{"to": "<id>" | null, "d": <msg>}`. `null` means every phone.
- relay → host: `{"from": "<id>", "d": <msg>}`, plus `{"_evt":"hosted"|"join"|"leave"}`
- phone ↔ relay: the raw game message
- Close codes: `4001` code already hosted, `4003` room full (12), `4004` no host
- The text `ping` is answered with `pong` without waking the room (keepalive).

A host that reconnects with the same `key` takes its room back. Phones keep their sockets
open while that happens.

## Optional: TURN for the p2p fallback

Only needed if you skip the relay. Add TURN servers in `net-config.js` under `iceServers`,
or point `turnCredentialsUrl` at a provider endpoint that returns an `iceServers` array
(for example Metered.ca's free tier). TURN credentials in a static site are public, so use
a provider with usage caps.

## Testing locally

```bash
cd relay
npx wrangler dev --port 8787
```

```bash
python -m http.server 8000
```

Open `http://localhost:8000/host.html`. To force a transport while testing in one
browser, run this in the dev-tools console, then reload both tabs:

```js
localStorage['pq-dev'] = JSON.stringify({ relayUrl: 'ws://127.0.0.1:8787', transports: ['relay'] })
// transports can be any of 'local', 'relay', 'p2p'. Remove with:
localStorage.removeItem('pq-dev')
```

On Windows, if `wrangler dev` fails with `SQLITE_CANTOPEN`, the project path is too long.
Add `--persist-to C:/tmp/wr`.

To test with a real phone on the same Wi-Fi, serve on your LAN IP
(`python -m http.server 8000 --bind 0.0.0.0`). Then open the host page via that IP, not
`localhost`, so the QR code points somewhere the phone can reach.
