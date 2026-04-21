import type { MenuSource, WeeklyMenu, DayMenu, Option, SourceEnv } from "../types.js";
import { weekdayDates } from "../dates.js";

const WEEKLY_URL =
  "https://www.radatz.at/wochenkarte/fleischerei-radatz-ekazent-hietzing-wien";
const DAYS_DE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"] as const;

export class RadatzSource implements MenuSource {
  id = "radatz";
  menuUrl = WEEKLY_URL;

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

// Exported for tests. The Radatz weekly page renders each day as:
//   Montag, 20.04.
//   <dish name with allergen codes like (A,G)>
//   <price like "8,9">
//   <next dish name>
//   <next price>
//   ...
//   Dienstag, 21.04.
//   ...
// We strip tags, locate each day header, and pair up (dish, price) lines.
// Terminators mark the end of a day block without being emitted as days themselves
// (e.g. "Samstag, 25.04.", or the "Saisonale Empfehlung" seasonal offerings section).
const TERMINATORS = ["Samstag", "Sonntag"];

export function parseRadatzHtml(html: string, dates: string[]): DayMenu[] {
  const text = htmlToText(html);
  const allDayWords = [...DAYS_DE, ...TERMINATORS].join("|");
  const headerRe = new RegExp(`(${allDayWords}),\\s*\\d{1,2}\\.\\s*\\d{1,2}\\.`, "g");
  const headers: { day: string; index: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(text)) !== null) {
    headers.push({ day: m[1], index: m.index, end: m.index + m[0].length });
  }
  // "Saisonale Empfehlung" also marks the end of the weekly menu on pages where
  // Saturday is absent.
  const seasonal = /\bSaisonale\s+Empfehlung\b/i.exec(text);
  if (seasonal) headers.push({ day: "Saisonale", index: seasonal.index, end: seasonal.index });

  return DAYS_DE.map((day, i) => {
    const here = headers.find(h => h.day === day);
    if (!here) return { date: dates[i] ?? "", options: [] };
    const next = headers.find(h => h.index > here.index);
    const block = text.slice(here.end, next?.index ?? text.length);
    return { date: dates[i] ?? "", options: parseDayBlock(block) };
  });
}

const PRICE_LINE = /^\s*(\d{1,2})[,.](\d{1,2})(?:\s+\d+g)?\s*$/;

function parseDayBlock(block: string): Option[] {
  const lines = block.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  const options: Option[] = [];
  let pendingName: string | null = null;
  for (const line of lines) {
    const priceMatch = PRICE_LINE.exec(line);
    if (priceMatch && pendingName) {
      const euros = Number(priceMatch[1]);
      const cents = Number(priceMatch[2].padEnd(2, "0")); // "3,5" -> 3.50
      options.push({ name: pendingName, price: euros + cents / 100 });
      pendingName = null;
    } else if (!priceMatch) {
      // Two consecutive non-price lines: treat the earlier one as a priceless option.
      if (pendingName) options.push({ name: pendingName });
      pendingName = line;
    }
  }
  if (pendingName) options.push({ name: pendingName });
  return options;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|td)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
