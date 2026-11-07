'use strict';

// Prompts for Presage LLM Insights. Presage sends the prompt together with
// the SDK's buffered pulse, HRV and breathing values to a language model.
// Following Presage's prompt guidance, SOVA asks only about those three
// signals, adds its own session context, and forbids medical or emotional
// claims. Prompts must stay under 2048 bytes.

const MAX_BYTES = 2048;

const RULES = 'Rules: plain, calm, encouraging language; at most 3 short sentences; '
  + 'only talk about the measured pulse, HRV and breathing rate and the context given; '
  + 'compare with the personal baseline when it is given; '
  + 'do not diagnose, name any medical condition, mention stress, anxiety or emotions, or give medical advice; '
  + 'end with one gentle focus or recovery habit, such as a breathing reset, a longer exhale or a short break.';

function fmt(v, unit) { return v == null ? null : `${Math.round(v)} ${unit}`; }

function contextLines(ctx) {
  const lines = [];
  if (ctx.presetName) lines.push(`Session type: ${ctx.presetName}.`);
  if (ctx.focusMinutes != null) lines.push(`Focused so far: ${Math.round(ctx.focusMinutes)} minutes.`);
  if (ctx.baseline) {
    const b = [fmt(ctx.baseline.breathing, 'breaths/min'), fmt(ctx.baseline.pulse, 'bpm'), fmt(ctx.baseline.hrv, 'ms HRV')].filter(Boolean);
    if (b.length) lines.push(`Personal baseline from the start of this session: ${b.join(', ')}.`);
  }
  const counts = [];
  if (ctx.tensionCues != null) counts.push(`${ctx.tensionCues} breathing or pulse cues`);
  if (ctx.resets != null) counts.push(`${ctx.resets} breathing resets`);
  if (ctx.eyeRests != null) counts.push(`${ctx.eyeRests} eye rests`);
  if (counts.length) lines.push(`So far: ${counts.join(', ')}.`);
  if (ctx.breathSound && ctx.breathSound.avgExhale != null) {
    lines.push(`In the last reset, exhales heard by the microphone averaged ${ctx.breathSound.avgExhale} s against a ${ctx.breathSound.targetExhale} s target.`);
  }
  return lines;
}

function buildPrompt(kind, ctx) {
  const ask = kind === 'reflection'
    ? 'The focus session has just ended. Write a short reflection on how my pulse, HRV and breathing looked during it.'
    : 'Give me a short check-in on my pulse, HRV and breathing right now.';
  const context = contextLines(ctx || {});
  let prompt = `I use SOVA, a focus and recovery app. ${ask}\nContext: ${context.join(' ')}\n${RULES}`;
  // Trim context from the end if needed to stay under the byte limit.
  while (new TextEncoder().encode(prompt).length > MAX_BYTES && context.length) {
    context.pop();
    prompt = `I use SOVA, a focus and recovery app. ${ask}\nContext: ${context.join(' ')}\n${RULES}`;
  }
  return prompt;
}

module.exports = { buildPrompt, MAX_BYTES };
