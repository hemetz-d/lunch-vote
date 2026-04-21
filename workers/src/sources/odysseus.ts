import type { MenuSource, WeeklyMenu, DayMenu, Option, SourceEnv } from "../types.js";
import { weekdayDates } from "../dates.js";

const MENU_PAGE = "https://restaurant-odysseus.at/menu/";
const DAYS_DE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"] as const;

export class OdysseusSource implements MenuSource {
  id = "odysseus";

  async fetchWeekly(env: SourceEnv): Promise<WeeklyMenu> {
    const pdfUrl = await findCurrentPdfUrl(MENU_PAGE);
    const bytes = await fetchAndCachePdf(pdfUrl, env);
    const text = await extractPdfText(bytes);
    const dates = weekdayDates(env.now ?? new Date());
    return {
      restaurant: "Restaurant Odysseus",
      days: parseOdysseusText(text, dates),
    };
  }
}

// Exported for tests.
export function parseOdysseusText(text: string, dates: string[]): DayMenu[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  const positions: { day: string; index: number }[] = [];
  for (const day of DAYS_DE) {
    const re = new RegExp(`(?:^|\\W)${day}(?=\\W|$)`);
    const m = re.exec(normalized);
    if (m) positions.push({ day, index: m.index + m[0].indexOf(day) });
  }
  positions.sort((a, b) => a.index - b.index);

  return DAYS_DE.map((day, i) => {
    const pos = positions.find(p => p.day === day);
    if (!pos) return { date: dates[i] ?? "", options: [] };
    const nextIdx = positions.filter(p => p.index > pos.index).map(p => p.index).sort((a, b) => a - b)[0];
    const slice = normalized.slice(pos.index + day.length, nextIdx ?? normalized.length).trim();
    return { date: dates[i] ?? "", options: parseDayBlock(slice) };
  });
}

// Heuristic: without a known schema, split the day's text on " oder " (German "or")
// or on numbered markers, whichever yields >=1 options. Fall back to a single option.
function parseDayBlock(block: string): Option[] {
  const markerRe = /(?:^|\s)(\d)\.\s+/g;
  const markers: { start: number; textStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(block)) !== null) {
    markers.push({ start: m.index, textStart: markerRe.lastIndex });
  }
  if (markers.length > 0) {
    const options: Option[] = [];
    for (let i = 0; i < markers.length; i++) {
      const end = i + 1 < markers.length ? markers[i + 1].start : block.length;
      const raw = block.slice(markers[i].textStart, end).trim();
      if (raw) options.push({ name: raw });
    }
    return options;
  }
  const byOr = block.split(/\s+oder\s+/i).map(s => s.trim()).filter(Boolean);
  if (byOr.length > 1) return byOr.map(name => ({ name }));
  const trimmed = block.trim();
  return trimmed ? [{ name: trimmed }] : [];
}

async function findCurrentPdfUrl(pageUrl: string): Promise<string> {
  const res = await fetch(pageUrl);
  if (!res.ok) throw new Error(`odysseus: menu page ${res.status}`);
  const html = await res.text();
  // Look for wp-content/uploads/.../Mittagsmenu*.pdf
  const re = /https?:\/\/[^"']*wp-content\/uploads\/[^"']*Mittagsmen[üu][^"']*\.pdf/gi;
  const matches = html.match(re);
  if (!matches || matches.length === 0) throw new Error("odysseus: no PDF link on menu page");
  // Pick the most recently dated one: sort by URL (yyyy/mm naturally orders).
  return matches.sort().reverse()[0];
}

async function fetchAndCachePdf(url: string, env: SourceEnv): Promise<Uint8Array> {
  const key = `odysseus/${new URL(url).pathname.split("/").pop()}`;
  try {
    const cached = await env.PDF_CACHE.get(key);
    if (cached) return new Uint8Array(await cached.arrayBuffer());
  } catch {}
  const res = await fetch(url);
  if (!res.ok) throw new Error(`odysseus: PDF fetch ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  try { await env.PDF_CACHE.put(key, bytes); } catch {}
  return bytes;
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}
