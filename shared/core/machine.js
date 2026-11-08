'use strict';

// A tiny finite state machine. SOVA uses it wherever behaviour depends on
// "what stage are we in", so that the stage is one named value with a
// declared set of moves, instead of several booleans that can disagree.
//
//   const m = createMachine(DEFINITION);
//   m.send('START')   -> true if the move is allowed (state changes), else false
//   m.is('running', 'ending')
//   m.state, m.history, m.onChange(fn)
//
// An event the current state does not accept is ignored and reported (never
// thrown in the app, so a stray double-click cannot crash a session). Tests
// can pass { strict: true } to make illegal moves throw.

function createMachine(def, { strict = false, log = defaultLog } = {}) {
  if (!def || !def.states || !def.states[def.initial]) throw new Error(`machine ${def && def.id}: bad definition`);
  let state = def.initial;
  const listeners = new Set();
  const history = [];

  const m = {
    id: def.id,
    get state() { return state; },
    get final() { return !!(def.states[state].final); },
    get history() { return history.slice(); },

    is(...names) { return names.includes(state); },

    can(event) { return !!(def.states[state].on && def.states[state].on[event]); },

    // Where `event` would lead from here, or null.
    next(event) { return (def.states[state].on && def.states[state].on[event]) || null; },

    send(event, detail) {
      const target = m.next(event);
      if (!target) {
        const msg = `machine ${def.id}: "${event}" ignored in state "${state}"`;
        if (strict) throw new Error(msg);
        log('ignored', msg);
        return false;
      }
      const from = state;
      state = target;
      history.push({ from, to: target, event, at: Date.now() });
      if (history.length > 30) history.shift();
      log('transition', `machine ${def.id}: ${from} -> ${target} (${event})`);
      for (const fn of listeners) {
        try { fn(target, from, event, detail); } catch (e) { log('error', `machine ${def.id} listener: ${e.message}`); }
      }
      return true;
    },

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return m;
}

function defaultLog(kind, msg) {
  if (typeof console === 'undefined') return;
  if (kind === 'transition') console.info(`[SOVA] ${msg}`);
  else console.warn(`[SOVA] ${msg}`);
}

const quiet = () => {};

module.exports = { createMachine, quiet };
