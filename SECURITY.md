# Security

## Reporting a vulnerability

If you find a security issue, please email **hansvidaure24@gmail.com** instead of opening a public issue. I'll acknowledge within 48 hours.

## Security model

- **No game server.** The host screen runs all game logic in the browser. There is no backend that stores game state.
- **Relay is minimal.** The optional Cloudflare Worker relay forwards messages between host and phones — it doesn't inspect or store them. It validates room codes and enforces origin restrictions.
- **No accounts, no cookies, no tracking.**
- **Phone controllers** are thin clients: they send inputs and display state, with no access to other players' data.
