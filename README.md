# SOVA

When you're deep in focus, you don't notice your breathing speed up, your blinking slow down, or two hours pass without a break, until you're already drained.

SOVA watches your breathing, pulse and blinking through your webcam with Presage's [SmartSpectra SDK](https://smartspectra.presagetech.com/docs), and suggests a breathing reset, an eye rest or a break at the right moment.

**Stay in focus. Stay in tune.**

SOVA is a personal focus and recovery workstation. During a focus session it reads breathing rate, pulse, HRV, blinking, talking and face presence through your camera, then compares them with your own baseline to time its suggestions.

SOVA is not a medical application, diagnostic tool, stress detector or productivity surveillance system. It is a personal self-reflection and focus companion.

Built for the DEV Presage SmartSpectra SDK Challenge (#presagechallenge).

## SmartSpectra SDK integration (where to look)

SOVA uses the Presage SmartSpectra SDK (`@smartspectra/node-sdk` 3.4.0) for every live signal. Key files:

| File | What it does |
| --- | --- |
| [`src/main/nativeMeasurement.js`](src/main/nativeMeasurement.js) | Runs `SmartSpectraSDK` in the Electron main process: requests the breathing, cardio and face metric bundles, opens the camera with `useCamera` at 30 fps, decodes each `metrics` event with `decodeMetrics`, and forwards status, validation and errors |
| [`src/main/main.js`](src/main/main.js) | `bindSmartSpectraIpc`, the packaged runtime path (`SMARTSPECTRA_CAPI_PATH`), camera-only permission for SOVA's own page, and the IPC that starts, restarts and stops the SDK |
| [`src/renderer/measurement.js`](src/renderer/measurement.js) | Receives SDK events in the window, maps `ValidationCode` and `SmartSpectraErrorCode` values to user guidance; also contains the renderer-side SDK path (`useMediaStream`) as a fallback |
| [`shared/core/signals.js`](shared/core/signals.js) | Reads `breathing.rate`, `breathing.upperTrace`, `breathing.inhaleExhaleRatio`, `cardio.pulseRate`, `cardio.hrv`, `face.blinking`, `face.talking`, and applies the confidence, stability, warm-up and range rules |
| [`src/renderer/session.js`](src/renderer/session.js) | Uses the live signals: baseline, tension cues, meeting snooze, away pause, live breath line, before-and-after values, and opt-in Presage AI check-ins and reflections via `requestInsight` |
| [`shared/core/breathSound.js`](shared/core/breathSound.js) | Combines the SDK's breathing waveform with optional microphone breath sounds to label each heard breath as in or out |

**Live Presage signals used:** breathing rate, breathing waveform, inhale:exhale ratio, pulse rate, HRV (RMSSD), blink detection, talking detection, and the SDK's live validation status (face, lighting, motion, frame rate).

## What works in this build (desktop, Phases 1 and 2)

**Sessions and signals**
- First-run camera consent with a plain-language disclosure
- Signal check with a framing preview, then the SDK's live validation feedback (lighting, framing, motion)
- Direct camera capture in the main process at 30 fps, as Presage recommends, with an automatic 640x480 fallback and automatic reconnects for retryable SDK errors
- Personal baseline from the first 2 minutes of steady signal (breathing or pulse), restarted after any interruption, with a recalibrate option
- Calibration reminders when the signal needs attention for more than a minute

**Focus**
- Focus session presets: Deep Work, Studying, Reading, Creative Work, General Work
- Pomodoro timer with adaptive breaks (longer after tense blocks, shorter after calm ones)
- Floating focus widget: always on top, draggable, with the timer, live breath line, quick reset, pause and open
- Quick reset shortcut from any app: Ctrl + Shift + B (Cmd + Shift + B on macOS)
- Ambient sounds (rain, forest, soft noise, ambient), generated in the app so they work offline, optionally started by each preset

**Cues and smart pauses**
- Tension cues when breathing, pulse or HRV stays away from your baseline, shown at a pause in your typing
- Eye-rest reminders from blink detection, falling back to a time reminder
- Meeting snooze from talking detection, away pause when no face is seen for 1 minute, "I'm in flow" snooze, manual meeting pause, quiet hours
- Personal sensitivity settings: your own thresholds, detection window, time between cues, eye-rest rhythm, and an on/off switch per cue

**Recovery**
- Breathing sessions of 30 s, 60 s, 2 min or 5 min, with preset or custom patterns
- Live breath line against the target pace, inhale:exhale coaching, sound guide for eyes-closed breathing
- Before-and-after values for each reset, recorded only when the signal is reliable

**Breath sound analysis (optional, microphone)**
- During breathing resets, SOVA measures the room for 3 seconds, then times each audible breath
- The camera's breathing waveform (its direction learned from the guide you follow) says whether each sound was a breath in or out
- Results: average exhale length against the target, how it changed during the reset, breath-to-breath steadiness, and audible inhales. If too few breaths are heard, SOVA says so instead of guessing

**Presage AI (optional)**
- AI check-in during a session and an AI reflection at the end, generated by Presage LLM Insights from your measured pulse, HRV and breathing plus SOVA's session context
- Prompts follow Presage's guidance and forbid diagnosis, medical advice and emotional claims; replies are labelled as AI-generated

**Reflection and insights**
- End-of-session reflection (Calm, Productive, Distracted, Tired, Overwhelmed) and session notes
- Focus timeline replay: focus and break blocks, tense stretches, meeting, away and paused time, cues, resets and eye rests
- Before-and-after averages across resets (needs 3 reliable resets)
- Weekly reflection and consistency tracker without streaks
- Personal pattern discovery after 7 live sessions, reporting only what the data shows consistently
- CSV and JSON export, delete all

**Everywhere**
- Offline: timers, recovery, sounds, history and insights work without internet; live readings need a connection
- Reduced-motion breathing guide, screen-reader announcements, keyboard access

Planned next: Android app with the same shared rules and config.

## Install on Windows (no setup needed)

1. Download **SOVA-Setup.exe** from the [latest release](https://github.com/Chima30/sova/releases/latest).
2. Run it. Windows SmartScreen may warn because the installer is not code-signed yet: click **More info**, then **Run anyway**.
3. Open SOVA, accept the camera consent, and paste your free [Presage API key](https://physiology.presagetech.com/auth/register) in **Settings**.
4. Make sure Windows lets desktop apps use the camera: Settings › Privacy & security › Camera › **Let desktop apps access your camera**.

Every push to `main` also builds the installer automatically with GitHub Actions ([workflow](.github/workflows/windows-installer.yml)).

## Run from source

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

No SOVA login is required. Live readings need your own free Presage API key (step 2). Without a key or a connection, SOVA runs as a plain focus timer and says so.

## Build installers

```bash
npm run dist:win     # Windows installer in release/ (also built by GitHub Actions)
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

SOVA calls the SDK's `requestInsight` only when the user has turned on AI reflections. The SDK also sends derived vitals to Presage's AI service automatically during sessions; see Consent and data handling.

## Consent and data handling

**Camera consent**
- On first launch SOVA shows a consent screen explaining what the camera is used for, what is stored and what goes to Presage. Live readings start only after the user ticks "I understand and agree" and chooses "Allow camera". Choosing "Not now" keeps SOVA as a plain focus timer with the camera off.
- Consent can be reviewed again at any time in Settings, and is asked again if the disclosure changes.
- The camera is on only during a focus session or a reset. An on-screen "Camera on" indicator (also shown in the floating widget) and a "Pause camera" button are always visible. SOVA never runs the camera in the background or without the user starting a session, and measures only the person who started it.
- During a session the SDK opens the camera directly in SOVA's main process. The framing preview shown before a session uses the window's camera permission, which is granted only to SOVA's own bundled pages, video only, never the microphone.

**Processing and sharing**
- The SmartSpectra SDK computes every signal on the user's computer. Video and images are never recorded, saved or uploaded.
- The SDK connects to Presage's service to authenticate each measurement session with the user's own API key (Presage counts usage on that key) and to fetch its processing models.
- **Presage vitals insights:** according to [Presage's LLM Insights documentation](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/llm-insights/index.md), while a measurement session runs the SDK automatically sends derived values (pulse rate, HRV and breathing rate, plus a session ID) to Presage, which forwards them to a large language model to produce short "vitals check-ins": once when each signal first becomes stable, then every 60 seconds. No video or facial images are sent. This is built into the SDK and cannot be switched off by SOVA. SOVA does not show these check-ins.
- SOVA itself sends nothing else anywhere. Nothing is shared with any other party. No accounts, no cloud sync, no analytics, no ads.

**Storage, retention and deletion**
- Stored on the user's computer only, as JSON in the app's data folder (on Windows `%APPDATA%\SOVA`): session summaries, personal baselines, session events (cues, resets, eye rests, pauses, 30-second tension samples), before-and-after values, breath-sound results, AI reflections, reflections, notes and settings.
- The Presage API key is encrypted with the operating system's secure storage (Electron `safeStorage`) and never written to the repository.
- Data is kept until the user deletes it. Settings › Delete all data removes every session, reflection, note, setting and the saved API key.
- Settings › Export CSV or JSON gives the user a full copy of their data.

**SDK telemetry**
- Off by default in SOVA (`enableTelemetry: false`). Users can opt in under Settings › Share anonymous SDK diagnostics.
- When on, the SDK sends one aggregate summary per session: SDK version, platform and device model, session outcome, frame-rate and performance counts, and counts of quality warnings. It never includes video, images, measured values, or user or device identifiers. See [Presage's telemetry doc](https://github.com/Presage-Security/SmartSpectra/blob/main/docs/telemetry-and-privacy.md) and [privacy policy](https://api.physiology.presagetech.com/privacypolicy).

**Microphone (optional, off by default)**
- Used only if the user turns on breath sound analysis, after a separate consent prompt, and only while a breathing reset is running.
- The audio is turned into one loudness number every 20 ms inside the app to time breaths. It is never recorded, saved or sent anywhere. Microphone permission is granted only to SOVA's own page and only while this setting is on.
- Only the results (for example average exhale length) are saved with the session.

**AI services**
- Presage's automatic vitals insights described above run inside the SDK; SOVA does not show them.
- **AI reflections (optional, off by default):** after a separate consent prompt, SOVA calls the SDK's `requestInsight` when the user presses AI check-in and at the end of a session of 2 minutes or more. The prompt contains the session summary (preset, focus minutes, counts of cues, resets and eye rests, baseline values, last breath-sound result) and is sent to Presage with the SDK's buffered pulse, HRV and breathing values; Presage forwards it to a large language model. No video, images or microphone audio are included. The reply is stored with the session on the user's computer and included in export and deletion. Replies are labelled as AI-generated and may be inaccurate.
- No other AI service is used.

**Not medical**
- SOVA is a focus and self-reflection tool. It makes no diagnosis or treatment claims, shows no stress score, and is not for medical decisions. Presage states its SDK metrics are for general wellness only and are not FDA-cleared.
- Readings can be wrong during large motion, chewing gum, flickering light, talking (breathing), dark or striped clothing (breathing), or with the face turned away. SOVA hides any value whose confidence is too low instead of showing it.

## Project layout

```
shared/config/sova-config.json   presets, thresholds, windows, cooldowns, breathing patterns
shared/core/                     platform-neutral engines (signals, baseline, cues, session, breathing,
                                 insights, personal overrides, export)
src/main/                        Electron main process, main-process SDK capture, local store
src/preload/                     Presage preload bridge plus SOVA's API
src/renderer/                    UI, SDK wrapper, session and reset screens
test/                            unit tests for the shared core (npm test)
test/smoke/                      Electron smoke test that clicks through the app (npm run smoke)
```

The shared core holds every rule (confidence gating, baseline, cue timing, adaptive breaks) so the Android app can follow the same behaviour and the same config file.

## License

All rights reserved by the author until a license is chosen. The Presage SDK is used under Presage's license.
