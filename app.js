// app.js — hash router + views.

import { generate, swap, setsAndReps } from './generator.js';
import * as store from './store.js';

const app = document.getElementById('app');
let library = null;
let state = store.EMPTY;
let session = null; // { split, day, name, finisher, picks, skipped }
let backSensitive = false;
let currentSplit = '4_day';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const go = (hash) => { location.hash = hash; };

// ---------- boot ----------------------------------------------------------

async function boot() {
  const steps = ['Loading exercise library', 'Restoring your log', 'Checking the week', 'Ready'];
  app.innerHTML = `
    <div class="loading">
      <div class="plate"></div>
      <div><strong id="lstep">${steps[0]}</strong></div>
      <div class="track"><i id="lbar"></i></div>
    </div>`;
  const bar = document.getElementById('lbar');
  const step = document.getElementById('lstep');
  const tick = (i) => {
    step.textContent = steps[i];
    bar.style.width = `${((i + 1) / steps.length) * 100}%`;
  };

  tick(0);
  try {
    const res = await fetch('./data/library.json');
    if (!res.ok) throw new Error(res.status);
    library = await res.json();
  } catch (err) {
    app.innerHTML = `<h1>Library didn't load</h1>
      <p class="muted">data/library.json is missing or the page is open over file://.
      Serve the folder over http and reload.</p>
      <p class="small muted">${esc(err.message)}</p>`;
    return;
  }
  await sleep(260); tick(1);
  if (store.restoreProfile()) state = store.load();
  await sleep(220); tick(2);
  await sleep(220); tick(3);
  await sleep(180);

  addEventListener('hashchange', route);
  route();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- router --------------------------------------------------------

function route() {
  const [, screen, a, b] = location.hash.split('/');
  const signedIn = !!sessionStorage.getItem('gym.profile');
  if (!signedIn && screen && screen !== 'login') return viewProfiles();
  if (screen === 'splits') return viewSplits();
  if (screen === 'workout') return viewWorkout(a, Number(b));
  if (screen === 'login') return viewLogin();
  if (screen === 'settings') return viewSettings();
  return viewProfiles();
}

function topbar(title, sub) {
  const p = store.getProfile();
  return `<div class="bar">
    <h1>${esc(title)}</h1>
    ${sub ? `<span class="muted small">${esc(sub)}</span>` : ''}
    <span class="spacer"></span>
    <button class="linkish" data-nav="#/settings">${p === 'demo' ? 'Demo' : 'Vlad'}</button>
  </div>`;
}

// ---------- screens -------------------------------------------------------

function viewProfiles() {
  app.innerHTML = `
    <div class="bar"><h1>Training log</h1></div>
    <div class="stack">
      <button class="btn" data-profile="vlad">Vlad<span class="sub">Your log. Asks for a password.</span></button>
      <button class="btn ghost" data-profile="demo">Demo<span class="sub">Sample history, nothing saved to your log.</span></button>
    </div>`;
}

function viewLogin() {
  app.innerHTML = `
    <div class="bar"><h1>Sign in</h1></div>
    <form id="lf" class="stack">
      <label class="field"><span>Username</span><input name="u" autocomplete="username" autocapitalize="off"></label>
      <label class="field"><span>Password</span><input name="p" type="password" autocomplete="current-password"></label>
      <p id="le" class="error" hidden>That didn't match. Try again.</p>
      <button class="btn primary" type="submit">Sign in</button>
      <button class="linkish" type="button" data-nav="#/">Back to profiles</button>
    </form>`;
  document.getElementById('lf').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    const ok = await store.checkLogin(f.u.value, f.p.value);
    if (!ok) { document.getElementById('le').hidden = false; return; }
    store.setProfile('vlad');
    state = store.load();
    go('#/splits');
  });
}

function viewSplits() {
  currentSplit = state.cached_workout?.split || currentSplit;
  app.innerHTML = topbar('Pick a day') + `<div id="body">${splitBody()}</div>`;
}

function splitBody() {
  const split = library.splits[currentSplit];
  const days = split.days
    .map((d) => {
      const core = d.slots.filter((s) => s.priority === 'core').length;
      const opt = d.slots.length - core;
      return `<button class="btn daybtn" data-nav="#/workout/${currentSplit}/${d.day}">
        <span class="daynum">${d.day}</span>
        <span>${esc(d.name)}<span class="sub">${core} exercises${opt ? ` + ${opt} optional` : ''}</span></span>
      </button>`;
    })
    .join('');
  return `
    <div class="seg">
      <button data-split="4_day" aria-pressed="${currentSplit === '4_day'}">4 days</button>
      <button data-split="3_day" aria-pressed="${currentSplit === '3_day'}">3 days</button>
    </div>
    <label class="check" style="margin:0.9rem 0 1.1rem">
      <input type="checkbox" id="bs" ${backSensitive ? 'checked' : ''}>
      Back is sore today, keep spinal load low
    </label>
    <div class="stack">${days}</div>`;
}

function viewWorkout(splitKey, day) {
  if (!library.splits[splitKey]) return go('#/splits');

  const cached = store.cachedSession(state, splitKey, day);
  if (cached) {
    const byId = Object.fromEntries(library.exercises.map((e) => [e.id, e]));
    const slots = library.splits[splitKey].days.find((d) => d.day === day).slots;
    session = {
      split: splitKey, day,
      name: library.splits[splitKey].days.find((d) => d.day === day).name,
      finisher: library.splits[splitKey].days.find((d) => d.day === day).finisher,
      picks: cached.picks
        .map((p) => ({ slot: slots.find((s) => s.slot_id === p.slot_id), exercise: byId[p.exercise_id] }))
        .filter((p) => p.slot && p.exercise),
      skipped: [],
      cachedAt: cached.generated_at,
    };
  } else {
    session = generate(library, state, splitKey, day, { backSensitive });
    store.cacheSession(state, session, backSensitive);
  }
  renderWorkout();
}

function renderWorkout() {
  const age = session.cachedAt
    ? `generated ${hoursAgo(session.cachedAt)}`
    : 'generated just now';

  const rows = session.picks.map(rowHtml).join('');
  const skipped = session.skipped.length
    ? session.skipped.map((s) => `<div class="skipped">${esc(s.slot.label)} — skipped, ${esc(s.reason)}</div>`).join('')
    : '';

  app.innerHTML =
    topbar(session.name) +
    `<p class="small muted" style="margin-top:-0.5rem">${esc(age)} · <button class="linkish" id="regen">start over</button></p>
     ${skipped}
     <div style="margin-top:0.75rem">${rows}</div>
     ${session.finisher ? `<p class="finisher">Finish with: ${esc(session.finisher)}</p>` : ''}
     <p style="margin-top:1.5rem"><button class="linkish" data-nav="#/splits">Back to days</button></p>`;

  document.getElementById('regen').addEventListener('click', () => {
    session = generate(library, state, session.split, session.day, { backSensitive });
    store.cacheSession(state, session, backSensitive);
    renderWorkout();
  });
}

function rowHtml({ slot, exercise: e }) {
  const last = state.last_used[e.id];
  const doneToday = last?.date === store.today();
  const cls = ['row', doneToday ? 'done' : '', e.spinal_load === 'high' ? 'heavy' : ''].filter(Boolean).join(' ');
  const tags =
    (e.source === 'new_option' ? ' <span class="tag new">new</span>' : '') +
    (e.spinal_load === 'high' ? ' <span class="tag spine">heavy on the spine</span>' : '');

  return `<div class="${cls}" data-slot="${esc(slot.slot_id)}">
    <div class="slot">${esc(slot.label)}${slot.priority === 'optional' ? ' (optional)' : ''}</div>
    <div class="name">${esc(e.name_en)}${tags}</div>
    ${e.name_ro && e.name_ro !== e.name_en ? `<div class="ro">${esc(e.name_ro)}</div>` : ''}
    <div class="meta">
      <span class="prescribe">${esc(setsAndReps(e))}</span>
      <span class="last">${last ? `last: ${esc(last.weight)} — ${esc(last.reps)}` : 'no history yet'}</span>
    </div>
    <div class="entry">
      <input class="w" placeholder="weight" value="${esc(last?.weight ?? '')}" aria-label="Weight for ${esc(e.name_en)}">
      <input class="r" placeholder="reps, e.g. 10, 10, 9" value="${doneToday ? esc(last.reps) : ''}" aria-label="Reps for ${esc(e.name_en)}">
      <button class="save" data-save="${esc(e.id)}">Save</button>
    </div>
    <div class="rowfoot">
      <button class="linkish" data-swap="${esc(slot.slot_id)}">Swap exercise</button>
      ${e.youtube ? `<a class="linkish" href="${esc(e.youtube)}" target="_blank" rel="noopener">Watch</a>` : ''}
    </div>
  </div>`;
}

function hoursAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min ago`;
}

function viewSettings() {
  const n = Object.keys(state.last_used || {}).length;
  app.innerHTML =
    topbar('Settings') +
    `<div class="stack">
      <p class="muted">Signed in as ${esc(store.getProfile())}. ${n} exercises have logged numbers.</p>
      ${store.getProfile() === 'demo' ? '<div class="banner">Demo profile. Nothing here touches your real log.</div>' : ''}
      <button class="btn" id="export">Copy my log<span class="sub">Puts the whole state on your clipboard as JSON.</span></button>
      <button class="btn" id="clearcache">Clear today's workout<span class="sub">Next visit generates a fresh one.</span></button>
      <button class="btn" id="wipe">Erase everything<span class="sub">Removes all logged weights for this profile.</span></button>
      <button class="btn ghost" data-nav="#/">Switch profile</button>
    </div>`;

  document.getElementById('export').addEventListener('click', async (ev) => {
    await navigator.clipboard.writeText(JSON.stringify(state, null, 2));
    ev.currentTarget.firstChild.textContent = 'Copied';
  });
  document.getElementById('clearcache').addEventListener('click', () => {
    state.cached_workout = null; store.save(state); go('#/splits');
  });
  document.getElementById('wipe').addEventListener('click', (ev) => {
    if (ev.currentTarget.dataset.armed) {
      store.reset(); state = store.load(); go('#/splits'); return;
    }
    ev.currentTarget.dataset.armed = '1';
    ev.currentTarget.firstChild.textContent = 'Tap again to erase';
  });
}

// ---------- delegated events ---------------------------------------------

app.addEventListener('change', (ev) => {
  if (ev.target.id === 'bs') backSensitive = ev.target.checked;
});

app.addEventListener('click', async (ev) => {
  const seg = ev.target.closest('[data-split]');
  if (seg) {
    currentSplit = seg.dataset.split;
    document.getElementById('body').innerHTML = splitBody();
    return;
  }

  const nav = ev.target.closest('[data-nav]');
  if (nav) return go(nav.dataset.nav);

  const prof = ev.target.closest('[data-profile]');
  if (prof) {
    if (prof.dataset.profile === 'demo') {
      store.setProfile('demo');
      state = store.load();
      return go('#/splits');
    }
    return go('#/login');
  }

  const saveBtn = ev.target.closest('[data-save]');
  if (saveBtn) {
    const row = saveBtn.closest('.row');
    const weight = row.querySelector('.w').value.trim();
    const reps = row.querySelector('.r').value.trim();
    if (!reps) { row.querySelector('.r').focus(); return; }
    store.logSet(state, saveBtn.dataset.save, weight || '—', reps);
    row.classList.add('done');
    row.querySelector('.last').textContent = `last: ${weight || '—'} — ${reps}`;
    saveBtn.textContent = 'Saved';
    setTimeout(() => { saveBtn.textContent = 'Save'; }, 1200);
    return;
  }

  const swapBtn = ev.target.closest('[data-swap]');
  if (swapBtn) {
    const next = swap(library, session, swapBtn.dataset.swap);
    if (!next) { swapBtn.textContent = 'No other option'; return; }
    const pick = session.picks.find((p) => p.slot.slot_id === swapBtn.dataset.swap);
    pick.exercise = next;
    // update the cache but deliberately NOT slot_history
    if (state.cached_workout) {
      const c = state.cached_workout.picks.find((p) => p.slot_id === swapBtn.dataset.swap);
      if (c) c.exercise_id = next.id;
      store.save(state);
    }
    swapBtn.closest('.row').outerHTML = rowHtml(pick);
  }
});

boot();
