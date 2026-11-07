// Pocket Quest — online play settings.
// See NETWORKING.md for how to set these up.
window.PQ_CONFIG = {
  // WebSocket relay (Cloudflare Worker in /relay). Most reliable way for phones
  // on any network (mobile data, school/office Wi-Fi) to reach the host.
  // Example: 'wss://pocket-hex-relay.<your-subdomain>.workers.dev'
  // Leave '' to skip the relay and use peer-to-peer (PeerJS) only.
  relayUrl: 'wss://pocket-hex-relay.pocket-hex-relay.workers.dev',

  // Peer-to-peer fallback (PeerJS / WebRTC). STUN works for most home networks;
  // add TURN servers so strict NATs (many mobile carriers) can still connect.
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],

  // Optional: URL returning a JSON array of iceServers (e.g. Metered.ca's
  // https://<app>.metered.live/api/v1/turn/credentials?apiKey=...).
  // Fetched once at startup and appended to iceServers.
  turnCredentialsUrl: '',
};
