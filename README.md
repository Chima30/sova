# SOVA

**Stay in focus. Stay in tune.**

SOVA is a personal focus and recovery workstation. During a focus session it reads breathing rate, pulse, HRV, blinking, talking and face presence through your camera with the [Presage SmartSpectra SDK](https://smartspectra.presagetech.com/docs), then suggests breathing resets, eye rests and recovery breaks at the right moments.

SOVA is not a medical application, diagnostic tool, stress detector or productivity surveillance system. It is a personal self-reflection and focus companion.

Built for the DEV Presage SmartSpectra SDK Challenge (#presagechallenge).

## What works in this build (Phase 1, desktop)

- First-run camera consent with a plain-language disclosure
- Signal check using the SDK's live validation feedback (lighting, framing, motion)
- Personal baseline from the first 2 minutes of each session, with a recalibrate option
- Focus session presets: Deep Work, Studying, Reading, Creative Work, General Work
- Pomodoro timer with adaptive breaks (longer after tense blocks, shorter after calm ones)
- Tension cues when breathing, pulse or HRV stays away from your baseline for 3 minutes, shown at a pause in your typing
- Breathing resets of 30 s, 60 s, 2 min or 5 min, with preset or custom patterns, live breath line against the target pace, and inhale:exhale coaching
- Before-and-after values for each reset, recorded only when the signal is reliable
- Eye-rest reminders from blink detection, falling back to a time reminder
- Smart pauses: meeting snooze from talking detection, away pause when no face is seen for 1 minute, "I'm in flow" snooze, manual meeting pause, quiet hours
- Quick reset shortcut from any app: Ctrl + Shift + B (Cmd + Shift + B on macOS)
- End-of-session reflection (Calm, Productive, Distracted, Tired, Overwhelmed) and a session note
- History with a weekly consistency summary (no streaks)
- CSV and JSON export, delete all
- Offline: timers, recovery exercises, history and settings work without internet; live readings need a connection
- Reduced-motion breathing guide and an audio sound guide for eyes-closed breathing

Planned for the next builds: floating desktop widget, focus timeline replay, pattern discovery, ambient sounds, Android app. See the roadmap in the project spec.

## Requirements

- Node.js 20 or later (24 LTS recommended)
- Windows x64, macOS on Apple Silicon, or Linux x64/arm64 with glibc 2.35+ (Ubuntu 22.04+, Debian 12+)
- A webcam
- A free Presage API key from the [developer portal](https://physiology.presagetech.com/auth/register)

## Setup

```bash
git clone <this repo>
cd sova
npm install
npm start
```

`npm install` downloads the SDK's native runtime for every supported platform (a few hundred MB). That is expected; only your platform's runtime is loaded.

On first launch, accept the camera consent, then paste your API key in **Settings**. The key is encrypted with your operating system's secure storage (Electron safeStorage) and is never written to the repo.

For development you can instead set an environment variable before `npm start`:

```bash
# macOS / Linux
export SOVA_PRESAGE_API_KEY=your-key
# Windows PowerShell
$env:SOVA_PRESAGE_API_KEY="your-key"
```

### Testing instructions for judges

1. `npm install`, then `npm start`.
2. Accept the consent screen and add your own Presage API key in Settings.
3. Open **Focus**, pick **Studying**, and press **Start**.
4. Follow the signal check tips until the dot turns blue, then start the session.
5. Sit naturally for 2 minutes while the baseline is set. Live values appear only when the signal is reliable.
6. Try **Breathing reset** to see your live breath against the target pace, and talk for 20 seconds to see the meeting snooze.

No login is required. Without a key or a connection, SOVA runs as a plain focus timer and says so.

## Build installers

```bash
npm run dist:win     # Windows NSIS installer
npm run dist:mac     # macOS (Apple Silicon)
npm run dist:linux   # Linux AppImage
```

Packaging follows Presage's guide: the platform runtime folder is copied to `resources/smartspectra/` and loaded from there. On macOS the camera usage description and the library-validation entitlement are set in `package.json` and `build/entitlements.mac.plist`. On Windows, sign the bundled DLLs with your app for distribution.

## How SOVA uses the SDK

| Signal | SDK field | SOVA use |
| --- | --- | --- |
| Breathing rate | `breathing.rate` (30 s window) | Baseline, tension cues, reset biofeedback |
| Breath waveform | `breathing.upperTrace` | Live breath line |
| Inhale:exhale ratio | `breathing.inhaleExhaleRatio` | Exhale coaching |
| Pulse | `cardio.pulseRate` (12 s window, 40 to 110 BPM) | Baseline, tension cues, before and after |
| HRV | `cardio.hrv` RMSSD (60 s window) | Baseline, tension cues, before and after |
| Blinking | `face.blinking` | Eye-rest reminders |
| Talking | `face.talking` | Automatic meeting snooze |
| Validation status | `validationStatus` event | Signal check tips, away detection |

**Confidence rule.** A value is shown or used only when its analysis window has filled, its confidence passes the threshold in `shared/config/sova-config.json` (45 by default, the documented breathing accuracy threshold), the SDK marks it stable, and it sits inside the documented valid range. Otherwise SOVA hides it and explains why. SOVA never estimates, smooths over or invents a reading, and never shows the SDK's stress index.

SOVA does not use the SDK's `requestInsight` AI feature.

## Consent and data handling

- **Camera consent:** asked before first use, with a plain description of what happens. Without consent SOVA runs as a plain timer.
- **Camera use:** on only during a session or reset, with an on-screen indicator and a pause button. Camera permission is granted to SOVA's own page only, video only, no microphone.
- **Processing:** the SmartSpectra SDK computes all signals on this device. Video never leaves the computer and is never recorded or saved.
- **Network:** each SDK measurement session authenticates with Presage's service, so live readings need internet.
- **SDK telemetry:** off by default in SOVA (`enableTelemetry: false`). If you opt in under Settings, the SDK sends one aggregate summary per session: SDK version, platform and device model, session outcome, frame-rate and performance counts, and counts of quality warnings. It never includes video, images, measured values, user or device identifiers. See [Presage's telemetry doc](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/telemetry-and-privacy.md) and [privacy policy](https://api.physiology.presagetech.com/privacypolicy).
- **Storage:** session summaries, baselines, events, reflections, notes and settings are saved as JSON in the app's user-data folder on this computer only. No accounts, no cloud sync.
- **Retention and deletion:** data stays until you delete it. Settings > Delete all data removes everything, including the saved API key.
- **Export:** Settings > Export CSV or JSON.
- **AI services:** none.
- **Limits:** the SDK metrics are for general wellness only, are not FDA-cleared, and must not be used for diagnosis or treatment. Readings can be wrong during large motion, chewing gum, flickering light, talking (breathing), dark or striped clothing (breathing), or with the face turned away.

## Project layout

```
shared/config/sova-config.json   presets, thresholds, windows, cooldowns, breathing patterns
shared/core/                     platform-neutral engines (signals, baseline, cues, session, breathing, export)
src/main/                        Electron main process and local store
src/preload/                     Presage preload bridge plus SOVA's API
src/renderer/                    UI, SDK wrapper, session and reset screens
test/                            unit tests for the shared core (npm test)
```

The shared core holds every rule (confidence gating, baseline, cue timing, adaptive breaks) so the Android app can follow the same behaviour and the same config file.

## License

All rights reserved by the author until a license is chosen. The Presage SDK is used under Presage's license.
