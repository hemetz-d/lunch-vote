import type { MenuSource, WeeklyMenu, DayMenu, Option, SourceEnv } from "../types.js";
import { weekdayDates } from "../dates.js";

const WEEKLY_URL =
  "https://www.radatz.at/wochenkarte/fleischerei-radatz-ekazent-hietzing-wien";
const DAYS_DE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"] as const;

export class RadatzSource implements MenuSource {
  id = "radatz";

  async fetchWeekly(env: SourceEnv): Promise<WeeklyMenu> {
    const res = await fetch(WEEKLY_URL);
    if (!res.ok) throw new Error(`radatz: page ${res.status}`);
    const html = await res.text();
    const dates = weekdayDates(env.now ?? new Date());
    return {
      restaurant: "Radatz Ekazent",
      days: parseRadatzHtml(html, dates),
    };
  }
}

// Exported for tests. The Radatz page layout is HTML-based but unknown at
// implementation time — we use a robust day-header + text-segment approach:
// strip tags, split on weekday headers, then treat the rest as one option per day.
export function parseRadatzHtml(html: string, dates: string[]): DayMenu[] {
  const text = htmlToText(html);
  const positions: { day: string; index: number }[] = [];
  for (const day of DAYS_DE) {
    const re = new RegExp(`(?:^|\\W)${day}(?=\\W|$)`, "i");
    const m = re.exec(text);
    if (m) positions.push({ day, index: m.index + m[0].toLowerCase().indexOf(day.toLowerCase()) });
  }
  positions.sort((a, b) => a.index - b.index);

  return DAYS_DE.map((day, i) => {
    const pos = positions.find(p => p.day === day);
    if (!pos) return { date: dates[i] ?? "", options: [] };
    const nextIdx = positions.filter(p => p.index > pos.index).map(p => p.index).sort((a, b) => a - b)[0];
    const slice = text.slice(pos.index + day.length, nextIdx ?? text.length).trim();
    // Keep slice short: stop at 600 chars or the first double-newline, whichever first.
    const trimmed = slice.slice(0, 600).split(/\n{2,}/)[0].trim();
    return { date: dates[i] ?? "", options: splitOptions(trimmed) };
  });
}

function splitOptions(block: string): Option[] {
  // Radatz often lists items separated by " | " or newlines.
  const parts = block
    .split(/\s*[|•]\s*|\n+/)
    .map(s => s.trim())
    .filter(s => s.length > 2 && s.length < 200);
  if (parts.length === 0) return block.trim() ? [{ name: block.trim() }] : [];
  return parts.map(name => ({ name }));
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .trim();
}
