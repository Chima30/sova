'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { createMachine, quiet } = require('../shared/core/machine');
const { SESSION, SIGNAL, CHECK_IN, MACHINES } = require('../shared/core/machines');
const { render, file } = require('../scripts/gen-state-docs');

const strict = (def) => createMachine(def, { strict: true, log: quiet });
const loose = (def) => createMachine(def, { log: quiet });

test('every machine definition is well formed', () => {
  for (const m of MACHINES) {
    assert.ok(m.states[m.initial], `${m.id}: initial state exists`);
    for (const [name, st] of Object.entries(m.states)) {
      assert.ok(st.sees, `${m.id}.${name}: says what the person sees`);
      for (const to of Object.values(st.on || {})) assert.ok(m.states[to], `${m.id}.${name}: target ${to} exists`);
      if (st.final) assert.ok(!st.on || !Object.keys(st.on).length, `${m.id}.${name}: final states have no moves`);
    }
    // Every state is reachable from the initial state.
    const seen = new Set([m.initial]);
    const queue = [m.initial];
    while (queue.length) {
      for (const to of Object.values(m.states[queue.shift()].on || {})) if (!seen.has(to)) { seen.add(to); queue.push(to); }
    }
    assert.deepEqual([...seen].sort(), Object.keys(m.states).sort(), `${m.id}: all states reachable`);
  }
});

test('illegal moves are ignored, not applied (double clicks are harmless)', () => {
  const s = loose(SESSION);
  assert.equal(s.send('START'), true);
  assert.equal(s.send('START'), false, 'second start ignored');
  assert.equal(s.state, 'running');
  assert.equal(s.send('END'), true);
  assert.equal(s.send('END'), false, 'second end ignored');
  assert.equal(s.send('DONE'), true);
  assert.ok(s.final);
  assert.throws(() => strict(SESSION).send('DONE'), /ignored in state "check"/);
});

test('session can be cancelled from the signal check', () => {
  const s = strict(SESSION);
  s.send('END');
  assert.equal(s.state, 'ending');
});

test('signal: restarts recover, timer is final', () => {
  const g = strict(SIGNAL);
  g.send('RESTART');
  g.send('RESTART');   // a second error while restarting stays restarting
  g.send('RECOVERED');
  assert.equal(g.state, 'live');
  g.send('FALLBACK');
  assert.equal(g.state, 'timer');
  assert.equal(loose(SIGNAL).send('RECOVERED'), false, 'nothing to recover from');
});

test('check-in: start once, extend only from measuring, cancel is final', () => {
  const c = strict(CHECK_IN);
  c.send('START');
  assert.equal(loose(CHECK_IN).send('RUNNING'), false, 'cannot run before starting');
  c.send('RUNNING');
  c.send('EXTEND');
  c.send('FINISH');
  c.send('DONE');
  assert.equal(c.state, 'results');
  const k = loose(CHECK_IN);
  k.send('START');
  k.send('CANCEL');
  assert.equal(k.send('RUNNING'), false, 'a cancelled check-in never starts measuring');
  assert.equal(k.state, 'cancelled');
});

test('listeners and history record transitions', () => {
  const s = loose(SESSION);
  const seen = [];
  s.onChange((to, from, ev) => seen.push(`${from}>${to}:${ev}`));
  s.send('START');
  s.send('END');
  assert.deepEqual(seen, ['check>running:START', 'running>ending:END']);
  assert.equal(s.history.length, 2);
});

test('docs/state-machines.md is up to date (run npm run docs:machines)', () => {
  assert.equal(fs.readFileSync(file, 'utf8'), render());
});
