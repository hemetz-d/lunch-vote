# Lunch Vote

A small office lunch voting tool. Pulls weekly menus from four Vienna restaurants
(Da Ferdinando, Radatz Ekazent, Noodle King, Restaurant Odysseus) and lets people
vote on where to go today. Ships as a Microsoft Teams **Personal App** so it can
be pinned to the left rail next to Chat / Calls.

## Layout

```
workers/   Cloudflare Worker — API + weekly cron + serves pages/ as static assets
pages/     Static frontend (plain HTML/JS, no build step)
teams/     Teams Personal App manifest (sideloadable zip)
```

## Stack

- **Cloudflare Workers** for API + cron — free tier, built-in HTTPS, native cron.
- **Cloudflare D1** for menus & votes — free tier SQLite.
- **Cloudflare R2** for cached PDFs — free tier object store.
- **Worker `[assets]` binding** serves the static frontend on the same origin —
  no separate Pages project, no CORS.
- **unpdf** for Workers-compatible PDF text extraction.
- No framework on the frontend — plain HTML + vanilla JS.

## Run it locally in 30 seconds

No Cloudflare account needed. `wrangler dev` serves everything on one port via
Miniflare — the API, the D1 database (local SQLite file under `.wrangler/`),
the R2 bucket (local folder), **and** the static frontend.

```bash
cd workers
npm install
npm run migrate:local     # creates the SQLite file and seeds the restaurants table
npm run dev               # starts http://localhost:8787
```

Then, in another terminal, populate today's menus once:

```bash
curl -X POST -H "x-admin-secret: dev-secret" http://localhost:8787/api/refresh
```

Open <http://localhost:8787/> in a browser, enter a name, and vote. For a second
"user," open an incognito window — different `localStorage` → different identity.
The tally refreshes every 10s.

Iterating on a source parser? Rerun just that one:

```bash
curl -X POST -H "x-admin-secret: dev-secret" http://localhost:8787/api/refresh/ferdinando
```

Inspect the local DB directly:

```bash
npx wrangler d1 execute lunch_vote --local --command "SELECT * FROM source_status"
npx wrangler d1 execute lunch_vote --local --command "SELECT restaurant_id, date, substr(options_json,1,80) FROM menus"
```

Run the tests:

```bash
npm test
```

## Deploying to Cloudflare

```bash
cd workers
npx wrangler login

# Create the D1 database — copy the printed database_id into wrangler.toml,
# replacing the all-zeros placeholder.
npx wrangler d1 create lunch_vote

# Create the R2 bucket.
npx wrangler r2 bucket create lunch-vote-pdf-cache

# Apply the schema remotely.
npm run migrate:remote

# Set the admin secret used by POST /api/refresh.
npx wrangler secret put ADMIN_SECRET

# Deploy — the [assets] binding in wrangler.toml uploads pages/ alongside the Worker,
# so the whole app ships in one deploy on one origin. No separate Pages project needed.
npm run deploy
```

The deployed URL (e.g. `https://lunch-vote.<your-subdomain>.workers.dev`) is
what you put into [teams/manifest.json](teams/manifest.json): replace
`lunch-vote.pages.dev` in `developer.websiteUrl`, the `staticTabs[0]` URLs,
and `validDomains`. Also replace `id` with a fresh GUID (`uuidgen` or
<https://www.uuidgenerator.net/>).

## Teams sideload

1. Drop real icons into `teams/icons/color.png` (192×192) and `teams/icons/outline.png`
   (32×32 white silhouette on transparent).
2. Zip the contents of `teams/` (not the folder itself):
   ```bash
   cd teams && zip -r ../lunch-vote-teams.zip manifest.json icons/
   ```
3. Upload at <https://dev.teams.microsoft.com/apps> → **Import app** → pick the zip.
4. Click **Preview in Teams** → install as a personal app → right-click the app icon
   in the left rail → **Pin**.

If your tenant blocks custom app upload, the admin can add the app via the Teams
Admin Center, or you can fall back to distributing the Pages URL as a bookmark.

## V1 scope

In:
- 4 restaurants (Ferdinando, Radatz, Noodle King, Odysseus).
- Today-only voting page with live tally (10s polling).
- Cookie + localStorage identity (first-visit name prompt).
- Teams Personal App manifest.
- Monday 06:00 UTC cron + Tue–Fri retry; manual refresh endpoint.

Out (deferred):
- Teams SSO via AAD.
- Vote cutoff time.
- Vote history / reporting.
- Admin UI for adding restaurants.
- LLM fallback parsing.
- Notifications / daily channel post.

## Tuning sources

Only the Ferdinando parser is validated against a real sample. Once the Worker
runs a real fetch for Radatz and Odysseus, check `source_status` in D1 and the
stored `menus.options_json`. If the parsed output is off, iterate on:

- `workers/src/sources/radatz.ts` — `parseRadatzHtml` heuristics (the Radatz page
  HTML layout was unknown at implementation time).
- `workers/src/sources/odysseus.ts` — `parseDayBlock` in particular; the Odysseus
  PDF layout was likewise unknown.

Both expose their parsing functions for direct unit testing — drop a real fetch
into `workers/test/fixtures/` and add a test file mirroring `ferdinando.test.ts`.
