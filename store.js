// store.js — localStorage state, profile namespaces, auth, demo seed.

const CACHE_HOURS = 8;

// SHA-256 of SALT + password. Change both: see README.
const SALT = 'gym-vlad-2026';
const PASSWORD_HASH = 'ca5625d57a7493d213da7ecd110308fb61aade09feb5839a699ce53c63a3cb60';
const USERNAME = 'vlad';

export const EMPTY = { slot_history: {}, last_used: {}, cached_workout: null };

let profile = 'vlad';
export const getProfile = () => profile;
export function setProfile(p) {
  profile = p;
  sessionStorage.setItem('gym.profile', p);
}
export function restoreProfile() {
  const p = sessionStorage.getItem('gym.profile');
  if (p) profile = p;
  return p;
}

const key = () => `gym.${profile}.state`;

export function load() {
  try {
    const raw = localStorage.getItem(key());
    if (raw) return { ...EMPTY, ...JSON.parse(raw) };
  } catch (err) {
    console.warn('State unreadable, starting fresh.', err);
  }
  return profile === 'demo' ? seedDemo() : structuredClone(EMPTY);
}

export function save(state) {
  try {
    localStorage.setItem(key(), JSON.stringify(state));
  } catch (err) {
    console.warn('Could not save state.', err);
  }
}

export function reset() {
  localStorage.removeItem(key());
}

// ---- auth ----------------------------------------------------------------

export async function checkLogin(username, password) {
  if (username.trim().toLowerCase() !== USERNAME) return false;
  const bytes = new TextEncoder().encode(SALT + password);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === PASSWORD_HASH;
}

// ---- workout cache -------------------------------------------------------

export function cachedSession(state, splitKey, day) {
  const c = state.cached_workout;
  if (!c || c.split !== splitKey || c.day !== day) return null;
  const age = Date.now() - new Date(c.generated_at).getTime();
  if (age > CACHE_HOURS * 3600 * 1000) return null;
  return c;
}

export function cacheSession(state, session, backSensitive) {
  state.cached_workout = {
    split: session.split,
    day: session.day,
    generated_at: new Date().toISOString(),
    back_sensitive: !!backSensitive,
    picks: session.picks.map((p) => ({ slot_id: p.slot.slot_id, exercise_id: p.exercise.id })),
  };
  // rotation is recorded at generation, never on swap
  for (const p of session.picks) {
    const h = state.slot_history[p.slot.slot_id] || [];
    state.slot_history[p.slot.slot_id] = [p.exercise.id, ...h.filter((x) => x !== p.exercise.id)].slice(0, 12);
  }
  save(state);
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function logSet(state, exerciseId, weight, reps) {
  state.last_used[exerciseId] = { weight, reps, date: today() };
  save(state);
}

// ---- demo ----------------------------------------------------------------

function daysAgo(n) {
  const d = new Date(Date.now() - n * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function seedDemo() {
  const s = structuredClone(EMPTY);
  const hist = [
    ['bench_press', 'bar + 20/side', '8, 8, 7, 6', 9],
    ['incline_db_press', '24 × 2', '11, 11, 10, 9', 9],
    ['machine_fly', '42', '16, 15, 14', 9],
    ['cable_crunch', '30', '18, 16, 15', 9],
    ['hanging_knee_raise', 'bodyweight', '13, 11, 10', 9],
    ['lat_pulldown', '91', '10, 10, 9, 8', 7],
    ['chest_supported_row', '55', '12, 11, 10, 10', 7],
    ['rear_delt_machine_fly', '36', '18, 17, 15', 7],
    ['shrug', '35', '14, 13, 12', 7],
    ['barbell_squat', 'bar + 20/side', '7, 7, 6, 5', 5],
    ['hip_thrust', '60', '12, 11, 10', 5],
    ['leg_curl', '75', '13, 12, 11, 10', 5],
    ['leg_extension', '91', '18, 16, 14', 5],
    ['machine_calf_raise', '60', '14, 13, 12, 11', 5],
    ['seated_calf_raise', '40', '18, 17, 15, 15', 5],
    ['machine_shoulder_press', '60', '10, 10, 9, 8', 3],
    ['lateral_raise', '10 × 2', '17, 15, 14, 12', 3],
    ['facepull', '51', '20, 18, 17', 3],
    ['barbell_curl', 'bar + 12.5/side', '10, 9, 8', 3],
    ['hammer_curl', '16 × 2', '13, 12, 11', 3],
    ['skull_crusher', '25', '11, 10, 9', 3],
    ['rope_pushdown', '67', '16, 15, 13', 3],
  ];
  for (const [id, weight, reps, ago] of hist) {
    s.last_used[id] = { weight, reps, date: daysAgo(ago) };
  }
  s.slot_history = {
    mid_chest: ['bench_press'],
    upper_chest: ['incline_db_press'],
    chest_adduction: ['machine_fly'],
    lats_vertical: ['lat_pulldown'],
    midback_row: ['chest_supported_row'],
    quad_compound: ['barbell_squat'],
    front_delt: ['machine_shoulder_press'],
  };
  return s;
}
