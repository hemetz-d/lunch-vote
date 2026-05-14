import type { MenuSource, WeeklyMenu, Option, DayMenu, SourceEnv } from "../types.js";
import { weekdayDates } from "../dates.js";

const PDF_URL = "https://www.daferdinando.at/wochenkarte"; // page hosts the current weekly PDF
const DAYS_DE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag"] as const;
const MENU_PRICES: Record<number, number> = { 1: 13.9, 2: 11.9, 3: 15.9 };

export class FerdinandoSource implements MenuSource {
  id = "ferdinando";
  menuUrl = PDF_URL;

  async fetchWeekly(env: SourceEnv): Promise<WeeklyMenu> {
    const buf = await fetchPdfBytes(PDF_URL);
    const text = await extractPdfText(buf);
    const dates = weekdayDates(env.now ?? new Date());
    return {
      restaurant: "Da Ferdinando",
      days: parseFerdinandoText(text, dates),
    };
  }
}

// Exported for unit tests. Works on both line-broken and single-line text
// (unpdf returns space-separated text with no newlines).
export function parseFerdinandoText(text: string, dates: string[]): DayMenu[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  const dayBlocks = splitByDay(normalized);
  return DAYS_DE.map((day, i) => {
    const block = dayBlocks[day] ?? "";
    const options = parseOptions(block);
    // On a public holiday the PDF replaces the day's three options with a
    // sentence like "An Feiertagen können wir Ihnen leider kein Mittagsmenü
    // anbieten". Show a single placeholder so the card isn't blank.
    if (options.length === 0 && /Feiertag/i.test(block)) {
      options.push({ name: "Feiertag – kein Mittagsmenü" });
    }
    return { date: dates[i] ?? "", options };
  });
}

function splitByDay(text: string): Record<string, string> {
  const positions: { day: string; index: number }[] = [];
  for (const day of DAYS_DE) {
    // Match the day word as a whole token (surrounded by non-word chars or string edges).
    const re = new RegExp(`(?:^|\\W)${day}(?=\\W|$)`);
    const m = re.exec(text);
    if (m) positions.push({ day, index: m.index + m[0].indexOf(day) });
  }
  positions.sort((a, b) => a.index - b.index);
  const out: Record<string, string> = {};
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].index + positions[i].day.length;
    const end = i + 1 < positions.length ? positions[i + 1].index : text.length;
    out[positions[i].day] = text.slice(start, end);
  }
  return out;
}

function parseOptions(block: string): Option[] {
  // Find positions of "1.", "2.", "3." option markers. Each option's text runs from
  // right after its marker to just before the next marker (or the end of the block).
  const markerRe = /(?:^|\s)([123])\.\s+/g;
  const markers: { num: number; start: number; textStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(block)) !== null) {
    markers.push({ num: Number(m[1]), start: m.index, textStart: markerRe.lastIndex });
  }
  const options: Option[] = [];
  for (let i = 0; i < markers.length; i++) {
    const { num, textStart } = markers[i];
    const end = i + 1 < markers.length ? markers[i + 1].start : block.length;
    const raw = block.slice(textStart, end).trim();
    const { name, description } = splitNameAndDescription(raw);
    options.push({
      name,
      ...(description ? { description } : {}),
      ...(MENU_PRICES[num] !== undefined ? { price: MENU_PRICES[num] } : {}),
    });
  }
  return options;
}

// The raw option text is Italian followed by a German translation. Both variants exist:
//   (a) "CREMA DI BROCCOLI / PENNE PANNA E PROSCIUTTO Brokkolicremesuppe / Penne mit Obers und Schinken"
//   (b) "PIZZA FUNGHI E SALSICCIA / Pizza mit Champignon und Salsiccia"
// Heuristic: the Italian portion is uppercase (apart from "E", "DI", "AL", etc.). The
// German portion starts at the first "word" that contains a lowercase letter after an
// uppercase word. We split on the first such boundary.
function splitNameAndDescription(raw: string): { name: string; description?: string } {
  const words = raw.split(/\s+/);
  let splitAt = -1;
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1];
    const cur = words[i];
    const prevUpper = /[A-ZÀ-Ý]/.test(prev) && prev === prev.toUpperCase();
    const curHasLower = /[a-zà-ÿ]/.test(cur);
    const curStartsUpper = /^[A-ZÀ-Ý]/.test(cur);
    if (prevUpper && curHasLower && curStartsUpper && cur !== "E") {
      splitAt = i;
      break;
    }
  }
  if (splitAt < 0) return { name: raw };
  const name = words.slice(0, splitAt).join(" ").trim();
  const description = words.slice(splitAt).join(" ").trim();
  return { name, description: description || undefined };
}

async function fetchPdfBytes(url: string): Promise<Uint8Array> {
  // If the URL is the HTML menu page, find the PDF link inside it first.
  const res = await fetch(url);
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/pdf")) {
    return new Uint8Array(await res.arrayBuffer());
  }
  const html = await res.text();
  const m = /href=["']([^"']+\.pdf)["']/i.exec(html);
  if (!m) throw new Error("ferdinando: no PDF link on menu page");
  const pdfUrl = new URL(m[1], url).toString();
  const pdfRes = await fetch(pdfUrl);
  if (!pdfRes.ok) throw new Error(`ferdinando: PDF fetch ${pdfRes.status}`);
  return new Uint8Array(await pdfRes.arrayBuffer());
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}
