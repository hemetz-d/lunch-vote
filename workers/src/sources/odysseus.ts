import type { MenuSource, WeeklyMenu, DayMenu, Option, SourceEnv } from "../types.js";
import { weekdayDates } from "../dates.js";

const MENU_PAGE = "https://restaurant-odysseus.at/menu/";

export class OdysseusSource implements MenuSource {
  id = "odysseus";
  menuUrl = MENU_PAGE;

  async fetchWeekly(env: SourceEnv): Promise<WeeklyMenu> {
    const pdfUrl = await findCurrentPdfUrl(MENU_PAGE);
    const bytes = await fetchAndCachePdf(pdfUrl, env);
    const text = await extractPdfText(bytes);
    const dates = weekdayDates(env.now ?? new Date());
    return {
      restaurant: "Odysseus",
      days: parseOdysseusText(text, dates),
    };
  }
}

// Exported for tests. The Odysseus lunch PDF is a 5-column x 4-row grid:
//
//     MONTAG    DIENSTAG  MITTWOCH  DONNERSTAG FREITAG
//     <soup5-per-day, no prices>
//     <meat Mon> 12,50 <meat Tue> 12,50 ... <meat Fri> 12,50
//     <veg Mon>  11,50 <veg Tue>  11,50 ... <veg Fri>  11,50
//     <fish Mon> 12,50 <fish Tue> 12,50 ... <fish Fri> 12,50
//
// unpdf flattens the grid row-by-row into one space-separated string. We locate
// the header run, strip the footer, and split on price markers. That yields 15
// (name, price) pairs laid out as 5 days x 3 priced rows. The unpriced soup row
// in between the headers and the first price is skipped in v1 (no clean way to
// split 5 soup names without column positions).
export function parseOdysseusText(text: string, dates: string[]): DayMenu[] {
  const flat = text.replace(/\s+/g, " ").trim();
  const headerRe = /MONTAG\s+DIENSTAG\s+MITTWOCH\s+DONNERSTAG\s+FREITAG/i;
  const headerMatch = headerRe.exec(flat);
  if (!headerMatch) return emptyDays(dates);
  const afterHeader = flat.slice(headerMatch.index + headerMatch[0].length);

  // Cut off the footer block (Dessertkombi / Allergen note / MITTAGSMENÜ).
  const terminator = /[✰*]\s*Dessertkombi|MITTAGSMEN[ÜU]\s+business/i.exec(afterHeader);
  const body = terminator ? afterHeader.slice(0, terminator.index) : afterHeader;

  // Split on prices. Match both "€12,50" and bare "12,50" or "11,50".
  const priceRe = /€?\s*(\d{1,2})[,.](\d{2})/g;
  const pairs: { name: string; price: number }[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = priceRe.exec(body)) !== null) {
    const name = body.slice(cursor, m.index).trim();
    const price = Number(m[1]) + Number(m[2]) / 100;
    if (name) pairs.push({ name, price });
    cursor = priceRe.lastIndex;
  }

  // Expect 15 pairs (3 rows x 5 days). If we got at least 5, lay them out as a
  // 5-column grid; extra rows beyond 3 are ignored, missing rows become empty.
  if (pairs.length < 5) return emptyDays(dates);
  const rows = Math.floor(pairs.length / 5);

  return Array.from({ length: 5 }, (_, dayIdx) => {
    const options: Option[] = [];
    for (let r = 0; r < rows; r++) {
      const idx = r * 5 + dayIdx;
      if (idx < pairs.length) options.push(pairs[idx]);
    }
    return { date: dates[dayIdx] ?? "", options };
  });
}

function emptyDays(dates: string[]): DayMenu[] {
  return dates.slice(0, 5).map(d => ({ date: d, options: [] }));
}

async function findCurrentPdfUrl(pageUrl: string): Promise<string> {
  const res = await fetch(pageUrl);
  if (!res.ok) throw new Error(`odysseus: menu page ${res.status}`);
  const html = await res.text();
  const re = /https?:\/\/[^"']*wp-content\/uploads\/[^"']*Mittagsmen[üu][^"']*\.pdf/gi;
  const matches = html.match(re);
  if (!matches || matches.length === 0) throw new Error("odysseus: no PDF link on menu page");
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
