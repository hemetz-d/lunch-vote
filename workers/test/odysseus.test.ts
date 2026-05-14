import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseOdysseusText } from "../src/sources/odysseus.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = join(__dirname, "fixtures/odysseus-sample.pdf");
const HOLIDAY_PDF_PATH = join(__dirname, "fixtures/odysseus-holiday-sample.pdf");
const DOUBLE_CLOSURE_PDF_PATH = join(__dirname, "fixtures/odysseus-double-closure-sample.pdf");
const DATES = ["2026-04-20", "2026-04-21", "2026-04-22", "2026-04-23", "2026-04-24"];
const HOLIDAY_DATES = ["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14", "2026-05-15"];
const DOUBLE_CLOSURE_DATES = ["2026-04-27", "2026-04-28", "2026-04-29", "2026-04-30", "2026-05-01"];

async function extract(path: string = PDF_PATH): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const bytes = new Uint8Array(readFileSync(path));
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

describe("parseOdysseusText (real PDF via unpdf)", () => {
  it("parses 5 days each with 3 priced options in {11.5, 12.5}", async () => {
    const text = await extract();
    const days = parseOdysseusText(text, DATES);
    expect(days).toHaveLength(5);
    for (const d of days) {
      expect(d.options).toHaveLength(3);
      for (const o of d.options) {
        expect(o.price).toBeDefined();
        expect([11.5, 12.5]).toContain(o.price);
      }
    }
  }, 30000);

  it("places the right dish on the right day (spot checks)", async () => {
    const text = await extract();
    const days = parseOdysseusText(text, DATES);
    const names = days.map(d => d.options.map(o => o.name).join(" | "));
    // Monday = Pasta Alfredo (meat slot)
    expect(names[0]).toMatch(/Pasta Alfredo/);
    // Tuesday = Spareribs
    expect(names[1]).toMatch(/Spareribs/);
    // Friday = Lachsfilet (fish slot)
    expect(names[4]).toMatch(/Lachsfilet/);
  }, 30000);

  it("does not include footer boilerplate in any option name", async () => {
    const text = await extract();
    const days = parseOdysseusText(text, DATES);
    const allNames = days.flatMap(d => d.options.map(o => o.name)).join(" ");
    expect(allNames).not.toMatch(/Dessertkombi|Allergene|MITTAGSMEN/);
  }, 30000);

  // Real PDF for the week of 11.5.–15.5.2026, where Donnerstag (14.5.) is a
  // public holiday: that column is empty except for "14.5. Feiertag á la
  // carte". Without holiday-aware layout, the price-pair grid misaligns.
  it("handles a Feiertag column without misaligning the other days", async () => {
    const text = await extract(HOLIDAY_PDF_PATH);
    const days = parseOdysseusText(text, HOLIDAY_DATES);
    expect(days).toHaveLength(5);

    expect(days[3].date).toBe("2026-05-14");
    expect(days[3].options).toHaveLength(1);
    expect(days[3].options[0].name).toMatch(/Feiertag/);
    expect(days[3].options[0].price).toBeUndefined();

    for (const i of [0, 1, 2, 4]) {
      expect(days[i].options).toHaveLength(3);
      for (const o of days[i].options) expect([11.5, 12.5]).toContain(o.price);
    }

    const names = days.map(d => d.options.map(o => o.name).join(" | "));
    expect(names[0]).toMatch(/Cordon Bleu/);
    expect(names[1]).toMatch(/Faschiertes/);
    expect(names[2]).toMatch(/Gyros/);
    expect(names[4]).toMatch(/Hühnerfilet/);
    expect(names[4]).not.toMatch(/Feiertag/);
    expect(names[4]).not.toMatch(/14\.5\./);
  }, 30000);

  // Real PDF for the week of 27.4.–1.5.2026, where Dienstag (28.4.) is closed
  // for maintenance ("Wegen Wartungsarbeiten geschlossen") and Freitag (1.5.)
  // is a public holiday ("Feiertag Á la carte"). Both columns must be
  // skipped for the remaining three days to align.
  it("handles two missing columns (maintenance closure + holiday)", async () => {
    const text = await extract(DOUBLE_CLOSURE_PDF_PATH);
    const days = parseOdysseusText(text, DOUBLE_CLOSURE_DATES);
    expect(days).toHaveLength(5);

    expect(days[1].date).toBe("2026-04-28");
    expect(days[1].options).toHaveLength(1);
    expect(days[1].options[0].name).toMatch(/Geschlossen/i);
    expect(days[1].options[0].price).toBeUndefined();

    expect(days[4].date).toBe("2026-05-01");
    expect(days[4].options).toHaveLength(1);
    expect(days[4].options[0].name).toMatch(/Feiertag/);
    expect(days[4].options[0].price).toBeUndefined();

    for (const i of [0, 2, 3]) {
      expect(days[i].options).toHaveLength(3);
      for (const o of days[i].options) expect([11.5, 12.5]).toContain(o.price);
    }

    const names = days.map(d => d.options.map(o => o.name).join(" | "));
    expect(names[0]).toMatch(/Odysseus Grillmix/);
    expect(names[2]).toMatch(/Chicken Gyros/);
    expect(names[3]).toMatch(/Rindsgulasch/);
    expect(names[2]).not.toMatch(/Wartungsarbeiten/);
    expect(names[3]).not.toMatch(/Feiertag/);
  }, 30000);
});
