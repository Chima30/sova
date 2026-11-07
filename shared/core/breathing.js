'use strict';

// Guided breathing: where the guide is at a given moment, and the target
// pace that the live breath line is compared against.

function cycleSeconds(p) {
  return p.inhale + (p.hold || 0) + p.exhale + (p.holdAfterExhale || 0);
}

function breathsPerMinute(p) {
  return 60 / cycleSeconds(p);
}

// Returns { phase: 'inhale'|'hold'|'exhale'|'rest', secondsLeft, scale }
// scale runs 0 (empty) to 1 (full) and drives the guide circle.
function guideAt(p, elapsed) {
  const c = cycleSeconds(p);
  let t = ((elapsed % c) + c) % c;
  if (t < p.inhale) return { phase: 'inhale', secondsLeft: p.inhale - t, scale: t / p.inhale };
  t -= p.inhale;
  if (p.hold && t < p.hold) return { phase: 'hold', secondsLeft: p.hold - t, scale: 1 };
  t -= p.hold || 0;
  if (t < p.exhale) return { phase: 'exhale', secondsLeft: p.exhale - t, scale: 1 - t / p.exhale };
  t -= p.exhale;
  return { phase: 'rest', secondsLeft: (p.holdAfterExhale || 0) - t, scale: 0 };
}

// Validate a user's custom pattern. Whole seconds, sensible limits.
function validatePattern(p) {
  const ok = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  return ok(p.inhale, 2, 10) && ok(p.exhale, 2, 12) && ok(p.hold || 0, 0, 10) && ok(p.holdAfterExhale || 0, 0, 10);
}

// Coaching line for the live inhale:exhale ratio from the SDK.
// SDK ratio = inhale / exhale duration. A longer exhale means a lower ratio.
function exhaleCoaching(ieRatio, targetExhaleRatio) {
  if (ieRatio == null || !Number.isFinite(ieRatio) || ieRatio <= 0) return null;
  const exhalePerInhale = 1 / ieRatio;
  const label = `1 : ${exhalePerInhale.toFixed(1)}`;
  const even = targetExhaleRatio <= 1.05;
  if (exhalePerInhale >= targetExhaleRatio * 0.95) return { label, tip: even ? 'Good, keep it even' : 'Good, keep the long exhale' };
  return { label, tip: even ? 'Try matching your exhale to your inhale' : 'Try a slightly longer exhale' };
}

const PHASE_TEXT = { inhale: 'Breathe in', hold: 'Hold', exhale: 'Breathe out', rest: 'Rest' };

module.exports = { cycleSeconds, breathsPerMinute, guideAt, validatePattern, exhaleCoaching, PHASE_TEXT };
