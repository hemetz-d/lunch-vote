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

// Names of users active in the last 7 days who haven't voted for `isoDate`
// yet. Used to surface "waiting on X, Y" on the frontend. Excludes the
// caller — they already see a dedicated "you haven't voted" banner.
export async function listWaitingOn(
  env: Env,
  isoDate: string,
  excludeUserId: string | null
): Promise<string[]> {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const { results } = await env.DB.prepare(
    `SELECT u.name
       FROM users u
      WHERE u.updated_at >= ?
        AND u.id <> COALESCE(?, '')
        AND u.id NOT IN (SELECT user_id FROM votes WHERE date = ?)
      ORDER BY u.updated_at DESC
      LIMIT 10`
  )
    .bind(cutoff, excludeUserId ?? "", isoDate)
    .all();
  return (results as unknown as { name: string }[]).map(r => r.name).filter(Boolean);
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

export type NoteRow = {
  id: string;
  userName: string;
  body: string;
  createdAt: number;
};

export async function addNote(
  env: Env,
  isoDate: string,
  userId: string,
  body: string
): Promise<void> {
  const clean = body.trim().slice(0, 200);
  if (!clean) return;
  await env.DB.prepare(
    "INSERT INTO notes (id, date, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), isoDate, userId, clean, Date.now())
    .run();
}

export async function listNotes(env: Env, isoDate: string): Promise<NoteRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT n.id, n.body, n.created_at AS createdAt, u.name AS userName
       FROM notes n
       LEFT JOIN users u ON u.id = n.user_id
      WHERE n.date = ?
      ORDER BY n.created_at ASC`
  )
    .bind(isoDate)
    .all();
  return (results as unknown as { id: string; body: string; createdAt: number; userName: string | null }[])
    .map(r => ({ id: r.id, body: r.body, createdAt: Number(r.createdAt), userName: r.userName ?? "anonymous" }));
}

// ============================================================================
// Achievements
// ============================================================================

export type Badge =
  | "🥇"   // first vote of the day today
  | "🍝"   // loyalist: last 3 recorded votes were all the same restaurant
  | "📝"   // scribe: 10+ notes all-time
  | "👑"   // champion: most votes in the last 7 days
  | "🎯";  // committed: voted today without changing (updated_at within a few seconds of today's first vote timestamp — not easy; skip)

// Keyed by display name rather than user_id so the frontend can just look up
// badges as it renders each voter. Small office → name collisions unlikely;
// acceptable trade-off for keeping the wire format simple.
export async function listBadges(env: Env, todayIso: string): Promise<Record<string, string[]>> {
  const badgesByUser = new Map<string, string[]>();
  const addBadge = (userId: string, badge: string) => {
    if (!userId) return;
    const arr = badgesByUser.get(userId) ?? [];
    if (!arr.includes(badge)) arr.push(badge);
    badgesByUser.set(userId, arr);
  };

  // 🥇 First vote of the day.
  const first = await env.DB.prepare(
    "SELECT user_id FROM votes WHERE date = ? AND restaurant_id <> 'protest' ORDER BY updated_at ASC LIMIT 1"
  )
    .bind(todayIso)
    .first<{ user_id: string }>();
  if (first) addBadge(first.user_id, "🥇");

  // 📝 Scribe — 10+ notes all-time.
  const { results: scribeRows } = await env.DB.prepare(
    "SELECT user_id FROM notes GROUP BY user_id HAVING COUNT(*) >= 10"
  ).all();
  for (const r of scribeRows as unknown as { user_id: string }[]) addBadge(r.user_id, "📝");

  // 🍝 Loyalist — last 3 recorded votes were for the same restaurant (protest excluded).
  const { results: voteRows } = await env.DB.prepare(
    "SELECT user_id, restaurant_id, date FROM votes WHERE restaurant_id <> 'protest' ORDER BY user_id, date DESC"
  ).all();
  const historyByUser = new Map<string, string[]>();
  for (const v of voteRows as unknown as { user_id: string; restaurant_id: string; date: string }[]) {
    const arr = historyByUser.get(v.user_id) ?? [];
    arr.push(v.restaurant_id);
    historyByUser.set(v.user_id, arr);
  }
  for (const [uid, history] of historyByUser) {
    if (history.length >= 3) {
      const top = history.slice(0, 3);
      if (top.every(r => r === top[0])) addBadge(uid, "🍝");
    }
  }

  // 👑 Champion — most vote rows in the last 7 days (tied users all get it).
  const weekAgoIso = shiftIsoDate(todayIso, -7);
  const { results: weekRows } = await env.DB.prepare(
    "SELECT user_id, COUNT(*) AS n FROM votes WHERE date >= ? AND restaurant_id <> 'protest' GROUP BY user_id ORDER BY n DESC"
  )
    .bind(weekAgoIso)
    .all();
  const weekCounts = weekRows as unknown as { user_id: string; n: number }[];
  if (weekCounts.length > 0) {
    const top = weekCounts[0].n;
    for (const r of weekCounts) {
      if (r.n === top && top > 0) addBadge(r.user_id, "👑");
    }
  }

  // Resolve user_id → name so the frontend can just key on name.
  const userIds = Array.from(badgesByUser.keys());
  if (userIds.length === 0) return {};
  const placeholders = userIds.map(() => "?").join(",");
  const { results: nameRows } = await env.DB.prepare(
    `SELECT id, name FROM users WHERE id IN (${placeholders})`
  )
    .bind(...userIds)
    .all();
  const nameById = new Map<string, string>();
  for (const r of nameRows as unknown as { id: string; name: string }[]) nameById.set(r.id, r.name);

  const byName: Record<string, string[]> = {};
  for (const [uid, badges] of badgesByUser) {
    const name = nameById.get(uid);
    if (name) byName[name] = badges;
  }
  return byName;
}

export type LeaderboardEntry = { name: string; votes: number; notes: number; badges: string[] };

export async function listLeaderboard(
  env: Env,
  todayIso: string,
  badges: Record<string, string[]>
): Promise<LeaderboardEntry[]> {
  const weekAgoIso = shiftIsoDate(todayIso, -7);
  const { results: voteRows } = await env.DB.prepare(
    "SELECT user_id, COUNT(*) AS n FROM votes WHERE date >= ? AND restaurant_id <> 'protest' GROUP BY user_id"
  )
    .bind(weekAgoIso)
    .all();
  const { results: noteRows } = await env.DB.prepare(
    "SELECT user_id, COUNT(*) AS n FROM notes WHERE date >= ? GROUP BY user_id"
  )
    .bind(weekAgoIso)
    .all();

  const votesByUser = new Map<string, number>();
  for (const r of voteRows as unknown as { user_id: string; n: number }[]) votesByUser.set(r.user_id, Number(r.n));
  const notesByUser = new Map<string, number>();
  for (const r of noteRows as unknown as { user_id: string; n: number }[]) notesByUser.set(r.user_id, Number(r.n));

  const participantIds = new Set<string>([...votesByUser.keys(), ...notesByUser.keys()]);
  if (participantIds.size === 0) return [];
  const idsArr = Array.from(participantIds);
  const placeholders = idsArr.map(() => "?").join(",");
  const { results: nameRows } = await env.DB.prepare(
    `SELECT id, name FROM users WHERE id IN (${placeholders})`
  )
    .bind(...idsArr)
    .all();
  const nameById = new Map<string, string>();
  for (const r of nameRows as unknown as { id: string; name: string }[]) nameById.set(r.id, r.name);

  const entries: LeaderboardEntry[] = [];
  for (const id of participantIds) {
    const name = nameById.get(id);
    if (!name) continue;
    entries.push({
      name,
      votes: votesByUser.get(id) ?? 0,
      notes: notesByUser.get(id) ?? 0,
      badges: badges[name] ?? [],
    });
  }
  entries.sort((a, b) => b.votes - a.votes || b.notes - a.notes || a.name.localeCompare(b.name));
  return entries.slice(0, 10);
}

function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function getMyVote(env: Env, isoDate: string, userId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT restaurant_id FROM votes WHERE date = ? AND user_id = ?"
  )
    .bind(isoDate, userId)
    .first<{ restaurant_id: string }>();
  return row?.restaurant_id ?? null;
}
