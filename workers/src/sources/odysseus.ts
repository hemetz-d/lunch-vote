import type { MenuSource, WeeklyMenu, DayMenu, Option, SourceEnv } from "../types.js";
import { weekdayDates } from "../dates.js";

const MENU_PAGE = "https://restaurant-odysseus.at/menu/";

export class OdysseusSource implements MenuSource {
  id = "odysseus";
  menuUrl = MENU_PAGE;

  async fetchWeekly(env: SourceEnv): Promise<WeeklyMenu> {
    const pdfUrl = await findCurrentPdfUrl(MENU_PAGE);
    const bytes = await fetchPdfBytes(pdfUrl);
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

  // On a public holiday or maintenance day, the PDF prints "DD.M. Feiertag á
  // la carte" or "DD.M. Wegen ... geschlossen" in that day's column and
  // leaves the rest of the column empty. The priced grid therefore loses
  // one column per such day; we detect them all so the layout still aligns.
  const closureRe = /(\d{1,2})\.(\d{1,2})\.[^\d]{0,80}?(?:[áàa]\s*la\s*carte|geschlossen)/gi;
  const closures: { dayIdx: number; label: string }[] = [];
  for (const cm of body.matchAll(closureRe)) {
    const dd = Number(cm[1]);
    const mm = Number(cm[2]);
    let dayIdx = -1;
    for (let i = 0; i < Math.min(5, dates.length); i++) {
      const parts = dates[i].split("-");
      if (parts.length === 3 && Number(parts[1]) === mm && Number(parts[2]) === dd) {
        dayIdx = i;
        break;
      }
    }
    if (dayIdx >= 0) {
      const label = /geschlossen/i.test(cm[0]) ? "Geschlossen" : "Feiertag – à la carte";
      closures.push({ dayIdx, label });
    }
  }
  const closedDays = new Set(closures.map(c => c.dayIdx));

  // Strip the closure phrases so they don't leak into the name of whichever
  // dish follows them in the flattened text.
  const cleaned = body.replace(closureRe, " ");

  // Split on prices. Match both "€12,50" and bare "12,50" or "11,50".
  const priceRe = /€?\s*(\d{1,2})[,.](\d{2})/g;
  const pairs: { name: string; price: number }[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = priceRe.exec(cleaned)) !== null) {
    const name = cleaned.slice(cursor, m.index).trim();
    const price = Number(m[1]) + Number(m[2]) / 100;
    if (name) pairs.push({ name, price });
    cursor = priceRe.lastIndex;
  }

  const cols = 5 - closedDays.size;
  if (cols <= 0 || pairs.length < cols) return emptyDays(dates);
  const rows = Math.floor(pairs.length / cols);

  // Map each present day to its column index in the reduced grid.
  const dayToCol: Record<number, number> = {};
  let nextCol = 0;
  for (let i = 0; i < 5; i++) {
    if (!closedDays.has(i)) dayToCol[i] = nextCol++;
  }

  return Array.from({ length: 5 }, (_, dayIdx) => {
    const closure = closures.find(c => c.dayIdx === dayIdx);
    if (closure) {
      return { date: dates[dayIdx] ?? "", options: [{ name: closure.label }] };
    }
    const colIdx = dayToCol[dayIdx];
    const options: Option[] = [];
    for (let r = 0; r < rows; r++) {
      const idx = r * cols + colIdx;
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

async function fetchPdfBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`odysseus: PDF fetch ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}
