'use strict';

// Writes docs/state-machines.md from shared/core/machines.js.
// Run: npm run docs:machines   (a test fails if the file is out of date)

const fs = require('fs');
const path = require('path');
const { MACHINES, DERIVED } = require('../shared/core/machines');

function render() {
  const out = [];
  out.push('# SOVA state machines', '');
  out.push('Generated from `shared/core/machines.js` by `npm run docs:machines`. Do not edit by hand.', '');
  out.push('SOVA keeps every multi-step flow as one named state with declared moves, instead of several booleans that can disagree.');
  out.push('Machines (below) are stored and changed only through `send(EVENT)`; an event the current state does not accept is ignored and logged as `[SOVA] machine <id>: "<EVENT>" ignored in state "<state>"`, so a double click can never start or end something twice.');
  out.push('Derived states (further down) are computed from data on every render and never stored, so they cannot go stale.', '');
  out.push('Inspect the live state at any time in DevTools with `window.sovaState()`.', '');
  out.push('## Machines', '');
  for (const m of MACHINES) {
    out.push(`### ${m.title} (\`${m.id}\`)`, '', `Code: \`${m.where}\`. Starts in \`${m.initial}\`.`, '');
    out.push('```mermaid', 'stateDiagram-v2', `  [*] --> ${m.initial}`);
    for (const [name, st] of Object.entries(m.states)) {
      for (const [ev, to] of Object.entries(st.on || {})) out.push(`  ${name} --> ${to}: ${ev}`);
      if (st.final) out.push(`  ${name} --> [*]`);
    }
    out.push('```', '');
    out.push('| State | What the person sees | Events → next state |', '| --- | --- | --- |');
    for (const [name, st] of Object.entries(m.states)) {
      const moves = Object.entries(st.on || {}).map(([ev, to]) => `\`${ev}\` → \`${to}\``).join(', ') || (st.final ? 'final' : '');
      out.push(`| \`${name}\` | ${st.sees} | ${moves} |`);
    }
    out.push('');
  }
  out.push('## Derived states', '');
  for (const d of DERIVED) {
    out.push(`### ${d.title} (\`${d.id}\`)`, '', `Code: \`${d.where}\`.`, '');
    out.push('| State | Meaning |', '| --- | --- |');
    for (const [name, text] of Object.entries(d.states)) out.push(`| \`${name}\` | ${text} |`);
    out.push('');
  }
  return out.join('\n');
}

const file = path.join(__dirname, '..', 'docs', 'state-machines.md');
if (require.main === module) {
  fs.writeFileSync(file, render());
  console.log('wrote', path.relative(process.cwd(), file));
}

module.exports = { render, file };
