// generator.js — pure functions. No DOM, no storage.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Patterns trained in the trailing 7 days, derived from last_used dates. */
export function recentPatterns(library, lastUsed, now = Date.now()) {
  const byId = Object.fromEntries(library.exercises.map((e) => [e.id, e]));
  const out = new Map(); // pattern -> count of distinct days
  for (const [id, rec] of Object.entries(lastUsed || {})) {
    const ex = byId[id];
    if (!ex || !rec?.date) continue;
    if (now - new Date(rec.date + 'T12:00:00').getTime() > WEEK_MS) continue;
    const days = out.get(ex.movement_pattern) || new Set();
    days.add(rec.date);
    out.set(ex.movement_pattern, days);
  }
  return out;
}

/** How many of the slot's target muscles this exercise trains as a primary. */
export function subgroupMatch(exercise, slot) {
  const targets = (slot.target_subgroup || '').split('|').filter(Boolean);
  if (!targets.length) return 1;
  return exercise.primary_muscles.filter((m) => targets.includes(m)).length;
}

/**
 * Least-recently-used pick. Exercises never chosen for this slot come first;
 * within the same recency, the one matching the slot's target muscles best
 * wins — otherwise a back extension can win the hip-extension slot over an RDL.
 */
function leastRecentlyUsed(candidates, history = [], slot) {
  const rank = (e) => {
    const i = history.indexOf(e.id);
    return i === -1 ? -1 : history.length - i; // never used = -1, sorts first
  };
  return [...candidates].sort(
    (a, b) => rank(a) - rank(b) || subgroupMatch(b, slot) - subgroupMatch(a, slot)
  )[0];
}

export function candidatesFor(library, slot, ctx) {
  const {
    usedPatterns = new Set(),
    highSpinalUsed = false,
    horizontalPressCount = 0,
    hingeSessionsThisWeek = 0,
    backSensitive = false,
  } = ctx;

  return library.exercises.filter((e) => {
    if (!slot.eligible_patterns.includes(e.movement_pattern)) return false;
    // must train one of the slot's target muscles as a primary
    if (subgroupMatch(e, slot) === 0) return false;
    // one exercise per movement pattern per session
    if (usedPatterns.has(e.movement_pattern)) return false;
    // at most one high spinal load per session
    if (highSpinalUsed && e.spinal_load === 'high') return false;
    // back-sensitive day: low spinal load only
    if (backSensitive && e.spinal_load !== 'low') return false;
    // triceps compound is really chest volume — not after two presses
    if (horizontalPressCount >= 2 && e.movement_pattern === 'triceps_compound') return false;
    // cap hinge exposure while reintroducing it
    if (hingeSessionsThisWeek >= 2 && e.movement_pattern === 'hinge') return false;
    return true;
  });
}

/**
 * Build a session. Returns { split, day, name, finisher, picks: [...], skipped: [...] }
 * Each pick: { slot, exercise }.
 */
export function generate(library, state, splitKey, dayNumber, opts = {}) {
  const split = library.splits[splitKey];
  const day = split.days.find((d) => d.day === dayNumber);
  if (!day) throw new Error(`No day ${dayNumber} in ${splitKey}`);

  const recent = recentPatterns(library, state.last_used, opts.now);
  const hingeSessionsThisWeek = (recent.get('hinge') || new Set()).size;

  const ctx = {
    usedPatterns: new Set(),
    highSpinalUsed: false,
    horizontalPressCount: 0,
    hingeSessionsThisWeek,
    backSensitive: !!opts.backSensitive,
  };

  const picks = [];
  const skipped = [];

  for (const slot of day.slots) {
    // per_week slots fill only if none of their patterns ran in the last 7 days
    if (slot.frequency === 'per_week') {
      const done = slot.eligible_patterns.some((p) => recent.has(p));
      if (done) {
        skipped.push({ slot, reason: 'already trained this week' });
        continue;
      }
    }

    const cands = candidatesFor(library, slot, ctx);
    if (!cands.length) {
      skipped.push({ slot, reason: ctx.backSensitive ? 'no low-spine option' : 'no option left' });
      continue;
    }

    const exercise = leastRecentlyUsed(cands, state.slot_history?.[slot.slot_id], slot);
    picks.push({ slot, exercise });

    ctx.usedPatterns.add(exercise.movement_pattern);
    if (exercise.spinal_load === 'high') ctx.highSpinalUsed = true;
    if (exercise.movement_pattern === 'horizontal_press') ctx.horizontalPressCount++;
    if (exercise.movement_pattern === 'hinge') ctx.hingeSessionsThisWeek++;
  }

  return { split: splitKey, day: dayNumber, name: day.name, finisher: day.finisher, picks, skipped };
}

/**
 * Next option for a slot, skipping the current pick and anything already in
 * the session. Used by the swap button — does NOT touch slot_history.
 */
export function swap(library, session, slotId) {
  const idx = session.picks.findIndex((p) => p.slot.slot_id === slotId);
  if (idx === -1) return null;
  const current = session.picks[idx].exercise;

  const otherPatterns = new Set(
    session.picks.filter((_, i) => i !== idx).map((p) => p.exercise.movement_pattern)
  );
  const highElsewhere = session.picks.some(
    (p, i) => i !== idx && p.exercise.spinal_load === 'high'
  );

  const slot = session.picks[idx].slot;
  const pool = library.exercises.filter(
    (e) =>
      slot.eligible_patterns.includes(e.movement_pattern) &&
      subgroupMatch(e, slot) > 0 &&
      !(otherPatterns.has(e.movement_pattern) && e.movement_pattern !== current.movement_pattern) &&
      !(highElsewhere && e.spinal_load === 'high')
  );
  if (pool.length < 2) return null;

  const at = pool.findIndex((e) => e.id === current.id);
  return pool[(at + 1) % pool.length];
}

export function setsAndReps(exercise) {
  const r = exercise.rep_range;
  const unit = r.unit === 'seconds' ? 's' : '';
  const per = r.unit === 'reps_per_leg' ? ' per leg' : r.unit === 'reps_per_side' ? ' per side' : '';
  return `${exercise.default_sets} × ${r.min}–${r.max}${unit}${per}`;
}
