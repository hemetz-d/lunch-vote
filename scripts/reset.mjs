// Resets user data in the D1 database. Never touches restaurants, menus, or
// source_status — those are scraped state that should persist.
//
// Usage:
//   node scripts/reset.mjs --today         reset today's votes + notes (local)
//   node scripts/reset.mjs --all           wipe all votes, notes, users (local)
//   node scripts/reset.mjs --demo          remove rows from the seed script
//
// Add --remote to hit the deployed D1 instead of the local SQLite file.
// Add --yes to skip the interactive confirmation (required for --remote in
// non-TTY environments; optional but recommended for CI-style invocations).
//
// Implementation note: writes the SQL to a temp file and invokes
// `wrangler d1 execute --file=...` rather than `--command "..."`. Windows
// cmd.exe mangles inline SQL containing quotes/parentheses when `shell: true`
// is used, and avoiding shell execution means platform-specific npx paths.
// A temp file sidesteps the whole escaping problem.

import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKERS_DIR = join(__dirname, "..", "workers");
const SQL_FILE = join(WORKERS_DIR, ".reset.sql");

const args = new Set(process.argv.slice(2));
const scopes = ["--today", "--all", "--demo"].filter(s => args.has(s));
if (scopes.length !== 1) {
  console.error(`Usage: node scripts/reset.mjs <--today|--all|--demo> [--remote] [--yes]

  --today    delete today's (UTC) votes and notes
  --all      wipe all votes, notes, and users (keeps menus/restaurants)
  --demo     remove rows seeded by scripts/seed-demo-data.mjs
               (anything with id LIKE 'demo-%')

  --remote   run against the deployed Cloudflare D1 (default: --local)
  --yes      skip the confirmation prompt
`);
  process.exit(1);
}

const scope = scopes[0];
const remote = args.has("--remote");
const yes = args.has("--yes");

const STATEMENTS = {
  "--today": [
    "DELETE FROM votes WHERE date = date('now');",
    "DELETE FROM notes WHERE date = date('now');",
  ],
  "--all": [
    "DELETE FROM votes;",
    "DELETE FROM notes;",
    "DELETE FROM users;",
  ],
  "--demo": [
    "DELETE FROM votes WHERE user_id LIKE 'demo-%';",
    "DELETE FROM notes WHERE user_id LIKE 'demo-%';",
    "DELETE FROM users WHERE id LIKE 'demo-%';",
  ],
}[scope];

const target = remote ? "remote D1 (production)" : "local D1";
console.log(`\nAbout to reset ${target}:\n  scope: ${scope}`);
for (const stmt of STATEMENTS) console.log(`    ${stmt}`);

if (!yes) {
  if (!process.stdin.isTTY) {
    console.error("\nNon-interactive shell detected. Pass --yes to proceed.");
    process.exit(1);
  }
  const ok = await confirm(`\nType "yes" to proceed${remote ? " (this affects the live site!)" : ""}: `);
  if (!ok) { console.log("Aborted."); process.exit(0); }
}

writeFileSync(SQL_FILE, STATEMENTS.join("\n") + "\n");
const flag = remote ? "--remote" : "--local";
const res = spawnSync(
  "npx",
  ["wrangler", "d1", "execute", "lunch_vote", flag, `--file=${SQL_FILE}`],
  { cwd: WORKERS_DIR, stdio: "inherit", shell: true }
);
try { unlinkSync(SQL_FILE); } catch {}
if (res.status !== 0) process.exit(res.status ?? 1);
console.log(`\nDone. Scope ${scope} on ${target}.`);

function confirm(prompt) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "yes");
    });
  });
}
