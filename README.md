# Lunch Vote

Office lunch voting for four restaurants in Vienna — Da Ferdinando, Radatz,
Noodle King, Odysseus. Weekly menus scraped automatically, one vote per person
per day, live tally. Embeds as a Teams Personal App pinned to the left rail.

## Architecture

```
          Browser  ──────────────┐
  (localhost:8787 · *.workers.dev · Teams tab iframe)
                                  │
                      same origin · HTTPS
                                  ▼
  ┌──────────────────────────────────────────────────────────┐
  │  Cloudflare Worker  (workers/src/index.ts)               │
  │                                                          │
  │    GET  /              → pages/ (static assets)          │
  │    GET  /api/today     → menus + tally for today         │
  │    POST /api/vote      → one vote / user / day (upsert)  │
  │    POST /api/refresh   → fetch all four sources now      │
  │    scheduled()         → Mon 06:00 UTC + Tue–Fri retry   │
  │                                                          │
  └───┬──────────────────────────────────────────┬─────────┘
      │                                          │
      ▼                                          ▼
  ┌──────────────┐                 ┌────────────────────────────┐
  │  D1 (SQLite) │                 │   MenuSource fetchers      │
  │              │                 │                            │
  │  menus       │                 │   ferdinando  ──▶ PDF      │
  │  votes       │                 │   radatz      ──▶ HTML     │
  │  restaurants │                 │   odysseus    ──▶ HTML+PDF │
  │  status      │                 │   noodle-king ──▶ static   │
  └──────────────┘                 └────────────┬───────────────┘
                                                │
                                                ▼
                                    daferdinando.at · radatz.at
                                    restaurant-odysseus.at
```

## Layout

```
workers/   Worker — API + cron + serves pages/ as static assets
pages/     Frontend — plain HTML + vanilla JS, no build step
teams/     Teams Personal App manifest (sideloadable zip)
```

## Run locally

No Cloudflare account needed — `wrangler dev` simulates D1, cron, and
static-asset serving on one port via Miniflare.

```bash
cd workers
npm install
npm run migrate:local   # creates the local SQLite file
npm run dev             # http://localhost:8787
```

Open <http://localhost:8787>, enter a name, and click **Refresh menus** to
populate today's options. Open a second browser (or incognito) to simulate a
second voter — different `localStorage` means a different identity.

## Deploy

```bash
cd workers
npx wrangler login

npx wrangler d1 create lunch_vote
# paste the printed database_id into wrangler.toml

npm run migrate:remote
npm run deploy
```

The deploy prints a URL like `https://lunch-vote.<your-subdomain>.workers.dev` —
that's the whole app, frontend and API on one origin.

## Teams Personal App

1. Drop real icons into `teams/icons/color.png` (192×192) and `outline.png`
   (32×32, white silhouette on transparent).
2. In `teams/manifest.json`, replace `lunch-vote.pages.dev` with your
   deployed URL and generate a fresh GUID for `id`.
3. Zip the manifest + icons, upload at <https://dev.teams.microsoft.com/apps>,
   click **Preview in Teams**, right-click the app in the left rail → **Pin**.

Tenant policy may block custom app upload — fall back to sharing the
Workers URL as a browser bookmark.

## Sources

| id            | URL                                                                          | Parser                         |
| ------------- | ---------------------------------------------------------------------------- | ------------------------------ |
| `ferdinando`  | [daferdinando.at/menue-1](https://www.daferdinando.at/menue-1)               | weekly PDF, 3 options/day      |
| `radatz`      | [radatz.at/wochenkarte/…ekazent-hietzing](https://www.radatz.at/wochenkarte/fleischerei-radatz-ekazent-hietzing-wien) | weekly HTML, variable options  |
| `odysseus`    | [restaurant-odysseus.at/menu](https://restaurant-odysseus.at/menu/)          | weekly PDF, 3 options/day      |
| `noodle-king` | —                                                                            | static config                  |

Each voting card shows a **View original ↗** link back to the source so
users can sanity-check against the real menu if a parser gets something
wrong. To tune a parser, grab a real fetch into `workers/test/fixtures/`
and mirror the test file structure (see `ferdinando.test.ts`).

## Tests

```bash
cd workers
npm test
```

The Ferdinando and Odysseus tests run `unpdf` against real saved PDFs;
the Radatz test runs against saved HTML. 14 tests, all fixture-based.
