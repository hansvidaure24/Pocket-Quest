// Pocket Quest — is this page the watch-only board view (host.html?viewer=1)?
// Imported first, because some modules check it while they load.

window.PQ_VIEWER = new URLSearchParams(location.search).get('viewer') === '1';
