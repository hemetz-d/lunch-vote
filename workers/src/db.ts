import type { Env, WeeklyMenu, Option } from "./types.js";

export type RestaurantRow = { id: string; name: string; source_id: string };
export type TodayForRestaurant = {
  id: string;
  name: string;
  options: Option[];
  votes: number;
  voters: string[];          // display names in vote order (earliest first)
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

  return restaurants.map(r => {
    const voters = votersByRestaurant.get(r.id) ?? [];
    return {
      id: r.id,
      name: r.name,
      options: menusByRestaurant.get(r.id) ?? [],
      votes: voters.length,
      voters,
    };
  });
}

export async function castVote(
  env: Env,
  isoDate: string,
  userId: string,
  restaurantId: string
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO votes (date, user_id, restaurant_id, updated_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(date, user_id) DO UPDATE SET restaurant_id = excluded.restaurant_id, updated_at = excluded.updated_at"
  )
    .bind(isoDate, userId, restaurantId, Date.now())
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

export async function getMyVote(env: Env, isoDate: string, userId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT restaurant_id FROM votes WHERE date = ? AND user_id = ?"
  )
    .bind(isoDate, userId)
    .first<{ restaurant_id: string }>();
  return row?.restaurant_id ?? null;
}
