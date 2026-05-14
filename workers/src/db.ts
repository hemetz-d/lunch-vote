import type { Env, WeeklyMenu, Option } from "./types.js";

export type RestaurantRow = { id: string; name: string; source_id: string };
export type TodayForRestaurant = {
  id: string;
  name: string;
  options: Option[];
  votes: number;
  voters: string[];          // display names in vote order (earliest first)
  lastFetchedAt?: number;    // ms epoch — null if the source has never succeeded
  lastError?: string;        // most recent fetch error, if any
};

export async function listRestaurants(env: Env): Promise<RestaurantRow[]> {
  const { results } = await env.DB.prepare("SELECT id, name, source_id FROM restaurants ORDER BY name").all();
  return results as unknown as RestaurantRow[];
}

export async function storeWeeklyMenu(env: Env, restaurantId: string, menu: WeeklyMenu): Promise<void> {
  const now = Date.now();
  const stmts = menu.days
    .filter(d => d.date)
    .map(d =>
      env.DB.prepare(
        "INSERT OR REPLACE INTO menus (restaurant_id, date, options_json, fetched_at) VALUES (?, ?, ?, ?)"
      ).bind(restaurantId, d.date, JSON.stringify(d.options), now)
    );
  if (stmts.length > 0) await env.DB.batch(stmts);
}

export async function recordSourceSuccess(env: Env, sourceId: string): Promise<void> {
  await env.DB.prepare(
    "INSERT OR REPLACE INTO source_status (source_id, last_fetched_at, last_error) VALUES (?, ?, NULL)"
  )
    .bind(sourceId, Date.now())
    .run();
}

export async function recordSourceError(env: Env, sourceId: string, error: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO source_status (source_id, last_fetched_at, last_error) VALUES (?, ?, ?) " +
      "ON CONFLICT(source_id) DO UPDATE SET last_error = excluded.last_error"
  )
    .bind(sourceId, Date.now(), error)
    .run();
}

// Week-overview data: for each date in `dates`, a map of restaurant_id -> options[].
// Used by /api/week for the read-only weekly menu view. No voters / votes; this
// is purely menu display.
export async function getWeekMenus(
  env: Env,
  dates: string[]
): Promise<Map<string, Map<string, Option[]>>> {
  const out = new Map<string, Map<string, Option[]>>();
  for (const d of dates) out.set(d, new Map());
  if (dates.length === 0) return out;
  const placeholders = dates.map(() => "?").join(",");
  const { results } = await env.DB.prepare(
    `SELECT restaurant_id, date, options_json FROM menus WHERE date IN (${placeholders})`
  )
    .bind(...dates)
    .all();
  for (const r of results as unknown as { restaurant_id: string; date: string; options_json: string }[]) {
    try {
      const byRest = out.get(r.date);
      if (byRest) byRest.set(r.restaurant_id, JSON.parse(r.options_json));
    } catch {}
  }
  return out;
}

export async function getToday(env: Env, isoDate: string): Promise<TodayForRestaurant[]> {
  const restaurants = await listRestaurants(env);
  const { results: menuRows } = await env.DB.prepare(
    "SELECT restaurant_id, options_json FROM menus WHERE date = ?"
  )
    .bind(isoDate)
    .all();
  const { results: voterRows } = await env.DB.prepare(
    `SELECT v.restaurant_id, u.name, v.updated_at
       FROM votes v
       LEFT JOIN users u ON u.id = v.user_id
      WHERE v.date = ?
      ORDER BY v.updated_at ASC`
  )
    .bind(isoDate)
    .all();
  const { results: statusRows } = await env.DB.prepare(
    "SELECT source_id, last_fetched_at, last_error FROM source_status"
  ).all();

  const menusByRestaurant = new Map<string, Option[]>();
  for (const r of menuRows as unknown as { restaurant_id: string; options_json: string }[]) {
    try {
      menusByRestaurant.set(r.restaurant_id, JSON.parse(r.options_json));
    } catch {
      menusByRestaurant.set(r.restaurant_id, []);
    }
  }
  const votersByRestaurant = new Map<string, string[]>();
  for (const v of voterRows as unknown as { restaurant_id: string; name: string | null }[]) {
    const list = votersByRestaurant.get(v.restaurant_id) ?? [];
    list.push(v.name ?? "anonymous");
    votersByRestaurant.set(v.restaurant_id, list);
  }
  const statusBySource = new Map<string, { lastFetchedAt?: number; lastError?: string }>();
  for (const s of statusRows as unknown as { source_id: string; last_fetched_at: number | null; last_error: string | null }[]) {
    statusBySource.set(s.source_id, {
      lastFetchedAt: s.last_fetched_at ?? undefined,
      lastError: s.last_error ?? undefined,
    });
  }

  return restaurants.map(r => {
    const voters = votersByRestaurant.get(r.id) ?? [];
    const status = statusBySource.get(r.source_id) ?? {};
    return {
      id: r.id,
      name: r.name,
      options: menusByRestaurant.get(r.id) ?? [],
      votes: voters.length,
      voters,
      lastFetchedAt: status.lastFetchedAt,
      lastError: status.lastError,
    };
  });
}

// Add a vote without disturbing the user's other votes. Enforces mutual
// exclusion between "protest" and non-protest: adding a non-protest vote
// clears any protest row first, and adding "protest" clears all non-protest
// rows. Idempotent — re-adding the same vote is a no-op.
export async function addVote(
  env: Env,
  isoDate: string,
  userId: string,
  restaurantId: string
): Promise<void> {
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  if (restaurantId === "protest") {
    stmts.push(
      env.DB.prepare(
        "DELETE FROM votes WHERE date = ? AND user_id = ? AND restaurant_id <> 'protest'"
      ).bind(isoDate, userId)
    );
  } else {
    stmts.push(
      env.DB.prepare(
        "DELETE FROM votes WHERE date = ? AND user_id = ? AND restaurant_id = 'protest'"
      ).bind(isoDate, userId)
    );
  }
  stmts.push(
    env.DB.prepare(
      "INSERT OR IGNORE INTO votes (date, user_id, restaurant_id, updated_at) VALUES (?, ?, ?, ?)"
    ).bind(isoDate, userId, restaurantId, now)
  );
  await env.DB.batch(stmts);
}

// Wipe all of a user's votes for a given date — used by the "Change my vote"
// flow in the UI so re-swiping starts from a clean slate.
export async function clearVotes(env: Env, isoDate: string, userId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM votes WHERE date = ? AND user_id = ?")
    .bind(isoDate, userId)
    .run();
}

export async function upsertUser(env: Env, id: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, 80);
  if (!clean) return;
  await env.DB.prepare(
    "INSERT INTO users (id, name, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at"
  )
    .bind(id, clean, Date.now())
    .run();
}


// Full list of the user's votes, in chronological order.
export async function getMyVotes(env: Env, isoDate: string, userId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT restaurant_id FROM votes WHERE date = ? AND user_id = ? ORDER BY updated_at ASC"
  )
    .bind(isoDate, userId)
    .all();
  return (results as unknown as { restaurant_id: string }[]).map(r => r.restaurant_id);
}
