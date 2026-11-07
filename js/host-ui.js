// Pocket Quest — the host page's static buttons and controls

import { state } from './state.js';
import { startCampaign } from './campaign.js';
import { irisWipe } from './canvas.js';
import {
  _lobbyReady, hostPlaying, onModeChange, startFromLobby, startPractice, toggleHostPlay
} from './lobby.js';

const $ = (id) => document.getElementById(id);

// room code: click to copy
const room = $('lobby-room');
room.addEventListener('click', () => {
  navigator.clipboard.writeText(room.dataset.code);
  room.style.letterSpacing = '4px';
  room.textContent = 'COPIED!';
  setTimeout(() => { room.style.letterSpacing = '8px'; room.textContent = room.dataset.code; }, 1200);
});

$('lobby-back').addEventListener('click', () => { window.location = 'index.html'; });
$('host-play').addEventListener('change', toggleHostPlay);
$('mode-sel').addEventListener('change', onModeChange);
$('adv-toggle').addEventListener('click', () => {
  const adv = $('adv-settings');
  adv.style.display = adv.style.display === 'flex' ? 'none' : 'flex';
});
$('start-btn').addEventListener('click', () => { if (_lobbyReady().ok) startFromLobby(); });
$('practice-btn').addEventListener('click', startPractice);
$('restart-btn').addEventListener('click', () => irisWipe({ speed: 0.005, color: '#000', hold: 80, onMid: startCampaign }));

// on-screen buttons for a host playing on a touch screen
document.querySelectorAll('#touch-btns [data-input]').forEach((btn) => {
  btn.addEventListener('click', () => { if (hostPlaying) state.pendingInput = btn.dataset.input; });
});
