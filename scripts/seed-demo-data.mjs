// Populates the local D1 with ~a week of fake users, votes, and notes so
// achievement badges + the leaderboard have something to compute against.
//
// Safe to re-run: uses INSERT OR REPLACE on votes/users and unique UUIDs on
// notes (so reruns add more notes than they replace — that's fine for demo).
//
// Run with:  node scripts/seed-demo-data.mjs
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKERS_DIR = join(__dirname, "..", "workers");
const SQL_FILE = join(WORKERS_DIR, ".seed-demo.sql");

// Last 5 weekdays (Mon–Fri) going backwards from today, oldest first.
const today = new Date();
const days = [];
let cursor = new Date(today);
while (days.length < 5) {
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  const dow = cursor.getUTCDay();
  if (dow >= 1 && dow <= 5) days.push(new Date(cursor));
}
days.reverse();
const iso = d => d.toISOString().slice(0, 10);
const DAYS = days.map(iso);

const users = [
  { id: "demo-anna",  name: "Anna (demo)" },
  { id: "demo-max",   name: "Max (demo)" },
  { id: "demo-leo",   name: "Leo (demo)" },
  { id: "demo-sofia", name: "Sofia (demo)" },
];

const votes = [];
// Anna: Ferdinando every day — earns 🍝 Loyalist
for (const d of DAYS) votes.push({ user: "demo-anna", date: d, rest: "ferdinando" });
// Max: varied votes every day — earns 👑 Champion (most vote rows)
const maxPicks = ["radatz", "noodle-king", "odysseus", "ferdinando", "radatz"];
DAYS.forEach((d, i) => votes.push({ user: "demo-max", date: d, rest: maxPicks[i] }));
// Leo: just one recent vote
votes.push({ user: "demo-leo", date: DAYS[DAYS.length - 1], rest: "radatz" });
// Sofia: no votes, only notes — earns 📝 Scribe
const sofiaNotes = [
  "bring cash for Ferdinando",
  "Marco invited us to Odysseus",
  "we leave at 12:30",
  "parking near Radatz is hell today",
  "sunny — salad weather",
  "anyone want to split a pizza?",
  "Leo's birthday on Friday",
  "Noodle King runs out of tofu early",
  "ate too much yesterday",
  "new menu at Ferdinando starting Monday",
  "Sofia out sick, sending notes from home",
  "someone left an umbrella at Radatz",
];

// Emit SQL.
// D1 doesn't accept BEGIN/COMMIT from `wrangler d1 execute --file` (it insists
// on state.storage.transaction APIs). The statements are idempotent enough on
// their own — each INSERT OR REPLACE is safe to rerun.
const now = Date.now();
let sql = "";
for (const u of users) {
  const name = u.name.replaceAll("'", "''");
  sql += `INSERT OR REPLACE INTO users (id, name, updated_at) VALUES ('${u.id}', '${name}', ${now});\n`;
}
for (const v of votes) {
  sql += `INSERT OR REPLACE INTO votes (date, user_id, restaurant_id, updated_at) VALUES ('${v.date}', '${v.user}', '${v.rest}', ${now});\n`;
}
for (let i = 0; i < sofiaNotes.length; i++) {
  const body = sofiaNotes[i].replaceAll("'", "''");
  const day = DAYS[i % DAYS.length];
  sql += `INSERT INTO notes (id, date, user_id, body, created_at) VALUES ('${randomUUID()}', '${day}', 'demo-sofia', '${body}', ${now - i * 60_000});\n`;
}

writeFileSync(SQL_FILE, sql);
console.log(`wrote ${SQL_FILE} (${users.length} users, ${votes.length} votes, ${sofiaNotes.length} notes across ${DAYS.length} days)`);

const res = spawnSync("npx", ["wrangler", "d1", "execute", "lunch_vote", "--local", `--file=${SQL_FILE}`], {
  cwd: WORKERS_DIR, stdio: "inherit", shell: true,
});
try { unlinkSync(SQL_FILE); } catch {}
if (res.status !== 0) process.exit(res.status ?? 1);
console.log("\nSeeded. Start the dev server and open / to see badges + leaderboard.");
