import type { Env, MenuSource } from "./types.js";
import { isoDate, viewingDate } from "./dates.js";
import {
  listRestaurants,
  storeWeeklyMenu,
  recordSourceSuccess,
  recordSourceError,
  getToday,
  castVote,
  getMyVote,
  upsertUser,
  addNote,
  listNotes,
  listWaitingOn,
  listBadges,
  listLeaderboard,
} from "./db.js";
import { NoodleKingSource } from "./sources/noodle-king.js";
import { FerdinandoSource } from "./sources/ferdinando.js";
import { RadatzSource } from "./sources/radatz.js";
import { OdysseusSource } from "./sources/odysseus.js";

const SOURCES: MenuSource[] = [
  new FerdinandoSource(),
  new RadatzSource(),
  new NoodleKingSource(),
  new OdysseusSource(),
];

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-user-id, x-user-name",
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

    try {
      if (url.pathname === "/api/today" && req.method === "GET") {
        const now = new Date();
        const today = isoDate(now);
        const viewing = viewingDate(now);
        const userId = req.headers.get("x-user-id") ?? "";
        const userName = req.headers.get("x-user-name") ?? "";
        if (userId && userName) await upsertUser(env, userId, userName);
        const allRestaurants = await getToday(env, viewing);
        const sourceById = new Map(SOURCES.map(s => [s.id, s]));
        // Peel the "protest" pseudo-restaurant off into its own field so the
        // frontend doesn't try to render it as a card.
        const protestRow = allRestaurants.find(r => r.id === "protest");
        const restaurants = allRestaurants
          .filter(r => r.id !== "protest")
          .map(r => ({ ...r, menuUrl: sourceById.get(r.id)?.menuUrl }));
        const protest = protestRow
          ? { votes: protestRow.votes, voters: protestRow.voters }
          : { votes: 0, voters: [] };
        const myVote = userId ? await getMyVote(env, viewing, userId) : null;
        const notes = await listNotes(env, viewing);
        const waitingOn = await listWaitingOn(env, viewing, userId || null);
        const badges = await listBadges(env, viewing);
        const leaderboard = await listLeaderboard(env, viewing, badges);
        return json({
          date: viewing,
          previewing: viewing !== today,
          restaurants,
          protest,
          myVote,
          notes,
          waitingOn,
          badges,
          leaderboard,
        });
      }

      if (url.pathname === "/api/note" && req.method === "POST") {
        const userId = req.headers.get("x-user-id");
        if (!userId) return json({ error: "missing x-user-id" }, 400);
        const userName = req.headers.get("x-user-name") ?? "";
        if (userName) await upsertUser(env, userId, userName);
        // Rate limit: 5 notes per 60 seconds per user.
        const recent = await env.DB.prepare(
          "SELECT COUNT(*) AS n FROM notes WHERE user_id = ? AND created_at > ?"
        )
          .bind(userId, Date.now() - 60_000)
          .first<{ n: number }>();
        if ((recent?.n ?? 0) >= 5) {
          return json({ error: "too many notes, slow down" }, 429);
        }
        const body = (await req.json().catch(() => ({}))) as { body?: string };
        if (!body.body || !body.body.trim()) return json({ error: "missing body" }, 400);
        await addNote(env, viewingDate(new Date()), userId, body.body);
        return json({ ok: true });
      }

      if (url.pathname === "/api/vote" && req.method === "POST") {
        const userId = req.headers.get("x-user-id");
        if (!userId) return json({ error: "missing x-user-id" }, 400);
        const userName = req.headers.get("x-user-name") ?? "";
        if (userName) await upsertUser(env, userId, userName);
        const body = (await req.json().catch(() => ({}))) as { restaurant_id?: string };
        if (!body.restaurant_id) return json({ error: "missing restaurant_id" }, 400);
        const restaurants = await listRestaurants(env);
        if (!restaurants.some(r => r.id === body.restaurant_id)) {
          return json({ error: "unknown restaurant" }, 400);
        }
        const voteDate = viewingDate(new Date());
        await castVote(env, voteDate, userId, body.restaurant_id);
        return json({ ok: true });
      }

      const refreshMatch = url.pathname.match(/^\/api\/refresh(?:\/([^/]+))?$/);
      if (refreshMatch && req.method === "POST") {
        // Intentionally unauthenticated: this is an office-internal tool and
        // the only side effect is fetching public menu pages. Rate-limited
        // globally so mass spam can't hammer the restaurants' sites: if any
        // source was fetched within the last 60s, reject with a 429. Serves
        // as a per-restaurant-site soft limit without per-IP tracking.
        const onlyId = refreshMatch[1];
        const targets = onlyId ? SOURCES.filter(s => s.id === onlyId) : SOURCES;
        if (targets.length === 0) return json({ error: "unknown source" }, 404);

        const ids = targets.map(t => t.id);
        const placeholders = ids.map(() => "?").join(",");
        const recent = await env.DB.prepare(
          `SELECT MAX(last_fetched_at) AS latest FROM source_status WHERE source_id IN (${placeholders})`
        )
          .bind(...ids)
          .first<{ latest: number | null }>();
        const lastFetch = recent?.latest ?? 0;
        const sinceMs = Date.now() - lastFetch;
        if (lastFetch && sinceMs < 60_000) {
          return json(
            { error: "refreshed recently, try again later", retryAfter: Math.ceil((60_000 - sinceMs) / 1000) },
            429
          );
        }

        const report = await runSources(env, targets);
        return json({ ok: true, report });
      }

      return new Response("Not found", { status: 404, headers: CORS_HEADERS });
    } catch (err) {
      return json({ error: String(err instanceof Error ? err.message : err) }, 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runSources(env, SOURCES).then(() => undefined));
  },
};

async function runSources(env: Env, sources: MenuSource[]) {
  const report: Record<string, { ok: boolean; error?: string; days?: number }> = {};
  const restaurants = await listRestaurants(env);
  for (const src of sources) {
    const restaurant = restaurants.find(r => r.source_id === src.id);
    if (!restaurant) {
      report[src.id] = { ok: false, error: "no restaurant mapped" };
      continue;
    }
    try {
      const menu = await withRetry(() => src.fetchWeekly({}), 3);
      await storeWeeklyMenu(env, restaurant.id, menu);
      await recordSourceSuccess(env, src.id);
      report[src.id] = { ok: true, days: menu.days.length };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await recordSourceError(env, src.id, msg);
      report[src.id] = { ok: false, error: msg };
    }
  }
  return report;
}

async function withRetry<T>(fn: () => Promise<T>, attempts: number): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, 500 * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}
