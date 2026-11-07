// Lets the real game modules load in Node. Import this before any game module: it stubs
// the canvas, DOM, audio and networking, which the tests don't exercise.

// Anything you call or read off it is a no-op that returns itself
function stub() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get: (_, key) => (key === Symbol.toPrimitive ? () => '' : key === 'value' ? 'random' : proxy),
    set: () => true,
  });
  return proxy;
}

const canvas = () => ({ width: 1600, height: 900, style: {}, getContext: () => stub(), addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1600, height: 900 }) });
const elements = { c: canvas(), 'iris-canvas': canvas(), 'menu-bg': canvas() };

// the game starts timers while it loads; don't let them keep the test process alive
const unref = (make) => (...a) => { const t = make(...a); t?.unref?.(); return t; };

Object.assign(globalThis, {
  window: globalThis,
  document: {
    getElementById: (id) => elements[id] || stub(),
    querySelector: () => stub(),
    querySelectorAll: () => [],
    createElement: () => stub(),
    addEventListener() {},
    body: stub(),
  },
  location: { search: '', origin: 'http://localhost', hostname: 'localhost' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  innerWidth: 1600,
  innerHeight: 900,
  addEventListener() {},
  requestAnimationFrame: () => 0,
  setInterval: unref(setInterval),
  setTimeout: unref(setTimeout),
  Image: class { set src(_) {} },
  PQNet: { createHost: () => stub() },
});
