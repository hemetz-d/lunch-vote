import type { Env, MenuSource } from "./types.js";
import { isoDate } from "./dates.js";
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
        const today = isoDate(new Date());
        const userId = req.headers.get("x-user-id") ?? "";
        const userName = req.headers.get("x-user-name") ?? "";
        if (userId && userName) await upsertUser(env, userId, userName);
        const restaurants = await getToday(env, today);
        const sourceById = new Map(SOURCES.map(s => [s.id, s]));
        const enriched = restaurants.map(r => ({
          ...r,
          menuUrl: sourceById.get(r.id)?.menuUrl,
        }));
        const myVote = userId ? await getMyVote(env, today, userId) : null;
        const notes = await listNotes(env, today);
        return json({ date: today, restaurants: enriched, myVote, notes });
      }

      if (url.pathname === "/api/note" && req.method === "POST") {
        const userId = req.headers.get("x-user-id");
        if (!userId) return json({ error: "missing x-user-id" }, 400);
        const userName = req.headers.get("x-user-name") ?? "";
        if (userName) await upsertUser(env, userId, userName);
        const body = (await req.json().catch(() => ({}))) as { body?: string };
        if (!body.body || !body.body.trim()) return json({ error: "missing body" }, 400);
        await addNote(env, isoDate(new Date()), userId, body.body);
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
        const today = isoDate(new Date());
        await castVote(env, today, userId, body.restaurant_id);
        return json({ ok: true });
      }

      const refreshMatch = url.pathname.match(/^\/api\/refresh(?:\/([^/]+))?$/);
      if (refreshMatch && req.method === "POST") {
        // Intentionally unauthenticated: this is an office-internal tool and the
        // only side effect is fetching four public menu pages. If this ever gets
        // abused, swap in a rate-limit on source_status.last_fetched_at.
        const onlyId = refreshMatch[1];
        const targets = onlyId ? SOURCES.filter(s => s.id === onlyId) : SOURCES;
        if (targets.length === 0) return json({ error: "unknown source" }, 404);
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
