# Lunch Vote — new UI port

A vanilla-JS port of the Slate Reels redesign, ready to A/B alongside the
current UI inside your existing Cloudflare Worker.

## What's in this bundle

Drop into `lunch-vote/pages/` (alongside the current `index.html` / `app.js`):

```
pages/
  index-new.html      ← Slate Reels Today view
  week-new.html       ← Weekly Overview
  lv-new-shared.js    ← identity / API client / prefs / DOM helpers
  lv-new-today.js     ← Today page logic (vanilla JS)
  lv-new-week.js      ← Weekly Overview page logic
  sr.css              ← shared slate-reels stylesheet
  wo.css              ← weekly-overview-only stylesheet
```

Both files use the existing `/api/today`, `/api/vote`, `/api/week`,
`/api/refresh` endpoints and the existing user-identity scheme
(`localStorage["lunch-vote-user"]`). Voting on the new UI shows up on the
old UI and vice versa — same backend, same user.

## Run

No build step needed.

```bash
cd workers
npm run dev
```

Open:
- `http://localhost:8787/` — **current** UI (untouched)
- `http://localhost:8787/index-new.html` — **new** Slate Reels Today view
- `http://localhost:8787/week-new.html` — **new** Weekly Overview

## How the A/B works

- **Backend**: shared. No changes to `workers/src/` needed. Both UIs hit the
  same endpoints; one user voting from either UI counts as the same vote.
- **User identity**: shared key `lunch-vote-user` so both UIs recognise the
  same person.
- **Cosmetic prefs** (theme / accent / brand toggle): namespaced under
  `lvn-*` keys so the new UI's preferences don't pollute the old UI's
  preferences. Switching between them is non-destructive.

## Optional: add a "Try new UI" link to the current page

Edit `pages/index.html`, find the `<header>` block, and inject this near
the top of `<div class="who">`:

```html
<a href="/index-new.html" style="font-size:13px;color:var(--accent);text-decoration:none;">
  ✨ Try new UI
</a>
```

(Or wire it into the existing `.tabs` nav if you'd rather make it more prominent.)

## Deploy

Once you've A/B'd locally:

```bash
cd workers
npm run deploy
```

Wrangler picks up the new files because they're under the `[assets]`
`directory` (`../pages`). Nothing else to configure.

## Files you can delete later

If you decide to fully cut over to the new UI:
1. Rename `index-new.html` → `index.html` (overwriting the current one).
2. Delete the old `app.js`.
3. Optionally rename `week-new.html` → `week.html`.

## Caveats / things to know

- **Beloved-dish alerts** are hardcoded in `lv-new-shared.js` (`ALERTS`),
  same patterns as the current `app.js`. Edit there to change them.
- **Brand metadata** (per-restaurant emoji + nick + brand colors) is also
  hardcoded in `lv-new-shared.js` under `BRAND_META`. If you add a new
  restaurant on the backend, add an entry there too.
- **Notes / leaderboard / hangry meter / confetti / shame modal**: not
  ported, per the redesign plan. The old `app.js` keeps them for the old
  UI.
- **Protest button** is the 🪧 icon on the action rail. Casts a vote with
  `restaurant_id: "protest"`, same as the existing app.
- **Weekly Overview** shows menus only — no winner badges, since the API
  doesn't expose past-day vote tallies. (Tally only lives in `/api/today`.)
  Easy add later if you expose it server-side.
