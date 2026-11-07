// === Init ===

import { state } from './state.js';
import { applyUpgradePick, pickUpgrade } from './campaign.js';
import { on } from './hooks.js';
import { _lobbyReady, goToLobby, setPhase, updateHostLobby, updateLobbyDisplay } from './lobby.js';
import { render } from './main.js';
import { updateLoadoutSel } from './net-host.js';
import { RV } from './remote-view.js';
import { survivalWave } from './survival.js';

document.getElementById('class-sel').addEventListener('change', updateLoadoutSel);
document.getElementById('loadout-sel').addEventListener('change', updateLoadoutSel);
document.getElementById('player-sel').addEventListener('change', updateLobbyDisplay);
document.getElementById('host-name').addEventListener('input', updateHostLobby);
updateLoadoutSel();

if (window.PQ_VIEWER) {
  RV.startViewer();
} else {
  setPhase('lobby');
  goToLobby();
  RV.installHost();
}

requestAnimationFrame(render);

// a handle for tests and the browser console
window.__pq = { state, on, lobbyReady: _lobbyReady, pickUpgrade, applyUpgradePick, survivalWave };
