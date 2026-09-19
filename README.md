# Training log

Static workout generator. No build step, no dependencies, no server.

```
index.html
style.css
app.js          router + views
generator.js    pure session builder
store.js        localStorage, auth, demo seed
data/library.json
```

## Run it locally

ES modules and `fetch` don't work over `file://`, so serve the folder:

```bash
python3 -m http.server
# open http://localhost:8000
```

## Put it on GitHub Pages

Push to a repo, then Settings → Pages → deploy from `main`, folder `/ (root)`.
No Actions workflow needed — these are static files.

All paths are relative (`./data/library.json`), so it works at
`username.github.io/repo-name/` as well as at a domain root.

## Change the password

The login is a curtain, not a lock — the hash sits in client-side source and
anyone with devtools can walk past it. It's there so the demo feels real.

Pick a new salt and password, then:

```bash
python3 -c "import hashlib; print(hashlib.sha256(('MY-SALT'+'mypassword').encode()).hexdigest())"
```

Put both into `store.js`:

```js
const SALT = 'MY-SALT';
const PASSWORD_HASH = '<the hex it printed>';
const USERNAME = 'vlad';
```

Shipped default: `vlad` / `bench`.

## How a session gets built

`generate()` walks the day's slots from `library.json` and picks one exercise
per slot:

1. `per_week` slots fill only if none of their patterns ran in the last 7 days.
2. Candidates must match the slot's pattern **and** train one of its target
   muscles as a primary.
3. Constraints drop the rest: one exercise per movement pattern per session,
   at most one `spinal_load: high`, no `triceps_compound` after two presses,
   at most two hinge sessions per week, and low-spine only when "back is sore"
   is ticked.
4. Of what survives, the least recently used for that slot wins, breaking ties
   toward the best subgroup match.

The week lookback is derived from dates in `last_used` — there's no separate
session history to keep in sync.

## State

One key per profile: `gym.vlad.state`, `gym.demo.state`.

```jsonc
{
  "slot_history": { "mid_chest": ["bench_press", "chest_dip"] },  // newest first
  "last_used": { "bench_press": { "weight": "bar + 20/side", "reps": "8, 8, 7, 6", "date": "2026-09-21" } },
  "cached_workout": { "split": "4_day", "day": 1, "generated_at": "...", "picks": [...] }
}
```

`last_used` is a flat overwrite — no history. Weight is free text, so
`bar + 20/side` and `24 × 2` both work; nothing parses it.

A generated session is cached for 8 hours. Reopening the same day inside that
window shows the same workout. "Start over" forces a new one.

**Swapping an exercise updates the cached session but not `slot_history`** —
otherwise swapping away from something would mark it as recently used and push
it down the rotation.

## Editing the library

`data/library.json` is read-only to the app. Edit it by hand to add exercises
or reshape a day. To add one exercise, copy an existing entry and change the
fields; the generator needs `movement_pattern`, `primary_muscles`,
`spinal_load`, `default_sets` and `rep_range`.

Progression is deliberately manual. The app shows what you lifted last time and
gets out of the way.
