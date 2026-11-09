# Contributing

## Setup

No build step. Serve the project root with any static server:

```bash
python -m http.server 8000
```

Open `http://localhost:8000/playtest.html` to host a game. Controllers connect via QR code or `controller.html?room=CODE`.

## Tests

```bash
node --test tests/
```

## Relay (optional)

See [NETWORKING.md](NETWORKING.md) for deploying the Cloudflare Worker relay.

## Code style

- Vanilla JavaScript, no frameworks, no bundler
- Host-authoritative: all game logic in the host page, phones are thin clients
- ES modules with `<script type="module">`

## Pull requests

- One clear change per PR
- Test with at least one phone (or a second browser tab as controller)
- Describe what changed and why in the PR body
