# Working on SOVA

Guide for people and coding agents. `CLAUDE.md` points here.

SOVA is an Electron desktop app for the DEV Presage SmartSpectra SDK Challenge: a focus and recovery workstation that reads breathing, pulse and HRV from the webcam. It is not a medical device.

## Commands

| Task | Command |
| --- | --- |
| Run the app | `npm start` (builds first) |
| Run with demo timing (for recording) | `npm run demo`: 40 s baseline and tension window, after value 30 s after a reset; readings unchanged |
| Unit tests | `npm test` |
| Click-through test of every screen | `npm run smoke` (on Linux: `xvfb-run -a npm run smoke`) |
| Check-in start path | `npm run smoke:checkin` |
| Regenerate state docs | `npm run docs:machines` |
| Windows installer | `npm run dist:win` |

Smoke screenshots: set `SOVA_SMOKE_SHOTS=/some/folder`, and `SOVA_SMOKE_THEME=light` or `dark`.

## Map

- `src/main/` Electron main process: IPC, local JSON store, SDK capture (`nativeMeasurement.js`), floating widget
- `src/preload/` the only bridge to the page (`window.sova`)
- `src/renderer/` the UI. `app.js` (screens and navigation), `session.js` (focus session), `checkin.js` (60-second check-in), `reset.js` (breathing reset overlay), `breathLines.js` (the signature visual)
- `shared/core/` pure logic with tests: signal gating, baseline, cues, timer engine, breathing patterns, exports, AI prompt, check-in maths, state machines
- `shared/config/sova-config.json` presets, patterns, thresholds, copy for goals and quick resets

## State: machines, not flags

Every multi-step flow is a named state machine declared in `shared/core/machines.js` and documented in `docs/state-machines.md` (generated).

- Change state only with `machine.send('EVENT')`. Never add a boolean like `isStarting` or `done`; add a state or event to the definition instead.
- `send` returns `false` for a move the current state does not accept. Use that as the guard against double clicks and races, as `startFocus`, `end` and `CheckIn.start` do.
- Values that can be computed (baseline state, widget visibility, cue suppression) stay derived; do not store them.
- After editing `machines.js`, run `npm run docs:machines`. A test fails if the docs are out of date.
- `window.sovaState()` in DevTools (and in the smoke tests) returns the current view, session machines, check-in state and theme. Tests wait on it instead of sleeping.

## Rules that must hold

1. **Never invent a reading.** A value is shown only when `checkUsable` passes (warm-up done, confidence ≥ threshold, stable, in range). Otherwise show the reason (`HIDDEN_REASON_TEXT`). No population "normal" ranges, no scores, no health verdicts.
2. **Compare with the person, not the population.** Baselines and personal ranges come from their own history.
3. **Disclose data.** Anything new that is stored or sent must be added to the consent screen (`showConsent` in `app.js`), the Settings privacy panel and the README "Consent and data handling" section. Export and Delete all must cover it.
4. **No medical claims.** AI prompts forbid diagnosis and emotion words; results screens carry the not-medical note.
5. **Accessibility.** 44px targets, keyboard reachable, `announce()` for changes that matter, reduced motion respected (`body.reduced-motion` and `reducedMotion()`).

## UI system

Tokens live at the top of `src/renderer/styles.css` (light and dark). Use the variables, never raw colours. Orange (`--accent`) means a live measurement, lavender (`--lavender`) means guidance, grey means nothing measured. Frosted glass panels (`.panel`, `.tile`), black pill buttons for the main action. Sentence case, no exclamation marks, no gradient text.

The focus session's centrepiece is a 3D heart drawn in code (`breathHeart.js`). It follows the same rule as the breath lines: it swells with your breath only while breathing is usable, beats at the measured rate only while pulse is usable, and stays still and pale otherwise. Home and the splash use the breath orb (`breathOrb.js`) as a lavender guide preview. Nothing is drawn on top of the breath lines in resets, Recovery or the check-in.

Motion lives in `motion.js` and the CSS keyframes. `--ease` for movement, `--spring` only for small pops (chips, switches, the rail marker). Cards rise in turn when a section opens, counts that are not readings count up, charts draw in. Live readings never count up, because a tween shows values that were never measured; a changed reading slides in instead (`.roll`). All motion stops with reduced motion.

## Git

- Commits are authored by the repo owner only: `John Madubuike Chimaobi <johnchimz15@gmail.com>`. No co-author or session lines.
- Push only when John asks. Pushes build the installer as a workflow artifact; a GitHub Release is created only by a manual workflow run with "publish" ticked, after his approval.
