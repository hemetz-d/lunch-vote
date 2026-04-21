import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseOdysseusText } from "../src/sources/odysseus.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = join(__dirname, "fixtures/odysseus-sample.pdf");
const DATES = ["2026-04-20", "2026-04-21", "2026-04-22", "2026-04-23", "2026-04-24"];

async function extract(): Promise<string> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const bytes = new Uint8Array(readFileSync(PDF_PATH));
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
});
