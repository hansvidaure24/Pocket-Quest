// Pocket Quest — hooks
// Lets the remote board view and tests watch what the game does without patching its
// functions: the game emits, they listen.

const listeners = {};

export function on(name, fn) {
  (listeners[name] ||= []).push(fn);
}

export function emit(name, ...args) {
  const fns = listeners[name];
  if (fns) for (const fn of fns) fn(...args);
}
