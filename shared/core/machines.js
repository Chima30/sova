'use strict';

// Every stateful flow in SOVA, declared in one place.
// docs/state-machines.md is generated from this file (npm run docs:machines),
// and a test fails if the two drift apart. Each state says what the person
// sees, so UI copy and behaviour come from the same definition.

const SESSION = {
  id: 'session',
  title: 'Focus session lifecycle',
  where: 'src/renderer/session.js (LiveSession.lifecycle)',
  initial: 'check',
  states: {
    check: { sees: 'Signal check with camera preview (live mode only)', on: { START: 'running', END: 'ending' } },
    running: { sees: 'Workstation: timer, breath lines, readings', on: { END: 'ending' } },
    ending: { sees: 'Wrapping up; waits up to 25 s for the AI reflection if it is on', on: { DONE: 'ended' } },
    ended: { sees: 'Reflection, then summary (session record saved)', final: true },
  },
};

const SIGNAL = {
  id: 'signal',
  title: 'Live signal source for a session',
  where: 'src/renderer/session.js (LiveSession.signal)',
  initial: 'live',
  states: {
    live: { sees: 'Readings from the SmartSpectra SDK', on: { RESTART: 'restarting', FALLBACK: 'timer' } },
    restarting: { sees: '"Reconnecting live readings" while the SDK restarts (error retry or lighter camera mode)', on: { RESTART: 'restarting', RECOVERED: 'live', FALLBACK: 'timer' } },
    timer: { sees: 'Plain timer, with the reason shown; no readings for the rest of the session', final: true },
  },
};

const CHECK_IN = {
  id: 'checkin',
  title: '60-second signal check-in',
  where: 'src/renderer/checkin.js (CheckIn.machine)',
  initial: 'prep',
  states: {
    prep: { sees: 'Camera preview and setup tips; Start enabled once the preview or a good signal is there', on: { START: 'starting', CANCEL: 'cancelled', FAIL: 'failed' } },
    starting: { sees: 'Measuring screen, "Starting the camera"', on: { RUNNING: 'measuring', CANCEL: 'cancelled', FAIL: 'failed' } },
    measuring: { sees: 'Countdown, breath lines, per-signal quality', on: { EXTEND: 'extending', FINISH: 'finishing', CANCEL: 'cancelled', FAIL: 'failed' } },
    extending: { sees: '"Waiting for HRV", up to 30 s more, with Show results now', on: { FINISH: 'finishing', CANCEL: 'cancelled', FAIL: 'failed' } },
    finishing: { sees: 'Camera released, record saved', on: { DONE: 'results' } },
    results: { sees: 'Results with personal range, feeling and next steps', final: true },
    failed: { sees: '"The check-in couldn\'t finish" with the reason', final: true },
    cancelled: { sees: 'Back where you were; camera off', final: true },
  },
};

const MACHINES = [SESSION, SIGNAL, CHECK_IN];

// Derived states: computed from data each render, never stored, so they
// cannot go stale. Documented next to the machines.
const DERIVED = [
  {
    id: 'baseline',
    title: 'Personal baseline during a session',
    where: 'src/renderer/session.js (LiveSession.baselineState())',
    states: {
      off: 'Timer mode: no baseline',
      waiting: 'No steady breathing or pulse yet; "Waiting for a steady signal"',
      learning: 'Window open, progress bar for 2 minutes; restarts after a reconnect',
      set: 'Reliable baseline; cues on',
      unreliable: 'Baseline could not be set; cues off; Recalibrate shown',
    },
  },
  {
    id: 'onboarding',
    title: 'First launch (a linear wizard: an ordered list of steps, not a machine)',
    where: 'src/renderer/app.js (startOnboarding, showStep, nextStep)',
    states: {
      name: '"What should SOVA call you?" (skipped once onboarded)',
      goals: '"What brings you here?" sets the starting preset and pattern',
      consent: 'Camera consent; only when the consent version is new',
      done: 'Home, or Settings when there is no API key yet; Change goals in Settings runs name and goals only',
    },
  },
  {
    id: 'timer',
    title: 'Focus timer phase',
    where: 'shared/core/sessionEngine.js (SessionEngine)',
    states: {
      focus: 'Focus block counting down',
      break: 'Break counting down (adaptive length)',
      paused: 'Any pause reason active: manual, away, or a reset/eye rest',
      done: 'All blocks finished',
    },
  },
  {
    id: 'widget',
    title: 'Floating widget visibility',
    where: 'src/main/main.js (syncWidget)',
    states: {
      none: 'No running session, or the person closed it (until the next session)',
      hidden: 'Session running and the SOVA window is in front',
      shown: 'Session running and you are in another app',
    },
  },
  {
    id: 'reset',
    title: 'Breathing reset overlay (time-driven: the phase is computed from elapsed time)',
    where: 'src/renderer/reset.js (openReset frame loop)',
    states: {
      'room-check': 'First 3 s with the microphone on: measuring room noise, guide waits',
      guiding: 'Phase word, seconds and lavender lines from guideAt(pattern, t); orange lines when breathing is steady',
      results: 'What SOVA heard (microphone) or straight back, once the time is up or End early',
    },
  },
  {
    id: 'mic',
    title: 'Breath sound detector',
    where: 'shared/core/breathSound.js (BreathSoundDetector)',
    states: {
      calibrating: 'Learning the room noise floor',
      quiet: 'Below the start threshold',
      breath: 'Above it (with hysteresis); a breath sound is being timed',
    },
  },
  {
    id: 'cue',
    title: 'Why a cue is held back',
    where: 'shared/core/cueEngine.js (suppression order)',
    states: {
      'not-focus': 'Breaks and pauses never cue',
      'quiet-hours': 'Inside quiet hours',
      snoozed: '"In flow" pressed',
      meeting: 'Talking detected or Meeting on',
      away: 'No face',
      cooldown: 'Too soon after the last cue',
      'no-baseline': 'Baseline not set or unreliable',
    },
  },
];

module.exports = { SESSION, SIGNAL, CHECK_IN, MACHINES, DERIVED };
