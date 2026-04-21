import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseFerdinandoText } from "../src/sources/ferdinando.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDF_PATH = join(__dirname, "fixtures/ferdinando-sample.pdf");

describe("unpdf extraction against real Ferdinando PDF", () => {
  it("extracts text and parses all 5 days with 3 options each", async () => {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const bytes = new Uint8Array(readFileSync(PDF_PATH));
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    const asString = Array.isArray(text) ? text.join("\n") : text;

    expect(asString.length).toBeGreaterThan(100);
    expect(asString).toMatch(/Montag/);
    expect(asString).toMatch(/Freitag/);

    const days = parseFerdinandoText(asString, [
      "2026-04-20", "2026-04-21", "2026-04-22", "2026-04-23", "2026-04-24",
    ]);
    expect(days).toHaveLength(5);
    for (const d of days) expect(d.options.length).toBeGreaterThanOrEqual(3);
  }, 30000);
});
