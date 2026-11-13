'use strict';

// npm run demo: starts SOVA with SOVA_DEMO_TIMING=1 (shorter baseline and cue
// timing for recording the demo). Works the same on Windows, macOS and Linux.

const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron');

const child = spawn(electron, [path.join(__dirname, '..')], {
  stdio: 'inherit',
  env: { ...process.env, SOVA_DEMO_TIMING: '1' },
});
child.on('exit', (code) => process.exit(code || 0));
