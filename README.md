# Lunch Vote

A small office lunch voting tool. Pulls weekly menus from four Vienna restaurants
(Da Ferdinando, Radatz Ekazent, Noodle King, Restaurant Odysseus) and lets people
vote on where to go today. Ships as a Microsoft Teams **Personal App** so it can
be pinned to the left rail next to Chat / Calls.

## Layout

```
workers/   Cloudflare Worker (API + weekly cron that fetches menus)
pages/     Static frontend for Cloudflare Pages
teams/     Teams Personal App manifest (sideloadable zip)
```

## Stack

- **Cloudflare Workers** for API + cron — free tier, built-in HTTPS, native cron.
- **Cloudflare D1** for menus & votes — free tier SQLite.
- **Cloudflare R2** for cached PDFs — free tier object store.
- **Cloudflare Pages** for the frontend.
- **unpdf** for Workers-compatible PDF text extraction.
- No framework on the frontend — plain HTML + vanilla JS.

## First-time setup

```bash
cd workers
npm install
npx wrangler login

# Create the D1 database — copy the printed database_id into wrangler.toml
npx wrangler d1 create lunch_vote

# Create the R2 bucket
npx wrangler r2 bucket create lunch-vote-pdf-cache

# Apply the schema
npm run migrate:remote

# Set the admin secret used by POST /api/refresh
npx wrangler secret put ADMIN_SECRET

# Deploy the Worker
npm run deploy
```

Deploy `pages/` to Cloudflare Pages (dashboard → Create a project → direct upload,
or connect a git repo). Note the Pages URL — you'll need it in two places:

1. `teams/manifest.json` — replace `lunch-vote.pages.dev` with your URL in
   `developer.websiteUrl`, `staticTabs[0].contentUrl`, `staticTabs[0].websiteUrl`,
   and `validDomains`. Also replace `id` with a fresh GUID (e.g., `uuidgen`).
2. If your Worker is on a different subdomain than Pages, append
   `?api=https://your-worker.workers.dev` to the Pages URL so the frontend hits
   the right API.

Route `/api/*` requests from Pages to the Worker by adding a Worker Route in the
dashboard (Pages → your project → Settings → Functions → Service bindings,
or use a Pages Function that forwards to the Worker). Easiest alternative: deploy
the Worker on a custom domain and set `API` on the Pages side via the `?api=` query param.

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

## Local development

```bash
cd workers
npm run migrate:local
npm run dev           # Worker at http://localhost:8787
```

Serve `pages/` with any static server (e.g. `npx http-server pages -p 5173`)
and open `http://localhost:5173/?api=http://localhost:8787`.

Trigger the cron manually:

```bash
curl -X POST http://localhost:8787/__scheduled
# Or a single source:
curl -X POST -H "x-admin-secret: dev" http://localhost:8787/api/refresh/ferdinando
```

## Tests

```bash
cd workers
npm test
```

Covers the Ferdinando parser against both a text fixture and the real PDF via
`unpdf`. Other sources (Radatz, Odysseus) use heuristic parsers that will need
tuning once we have real fetched data — see the "Tuning" section below.

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
