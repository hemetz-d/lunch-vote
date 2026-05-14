import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseFerdinandoText } from "../src/sources/ferdinando.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(join(__dirname, "fixtures/ferdinando-sample.txt"), "utf8");
const DATES = ["2026-04-20", "2026-04-21", "2026-04-22", "2026-04-23", "2026-04-24"];

describe("parseFerdinandoText", () => {
  const days = parseFerdinandoText(FIXTURE, DATES);

  it("extracts all five weekdays", () => {
    expect(days).toHaveLength(5);
    expect(days.map(d => d.date)).toEqual(DATES);
  });

  it("parses three options per day", () => {
    for (const d of days) expect(d.options).toHaveLength(3);
  });

  it("captures Italian name and German description for Monday", () => {
    const mon = days[0];
    expect(mon.options[0].name).toMatch(/CREMA DI BROCCOLI.*PENNE PANNA E PROSCIUTTO/);
    expect(mon.options[0].description).toMatch(/Brokkolicremesuppe/);
    expect(mon.options[2].name).toMatch(/POLLO AL ROSMARINO/);
  });

  it("applies menu prices 13.9 / 11.9 / 15.9 in order", () => {
    const prices = days[0].options.map(o => o.price);
    expect(prices).toEqual([13.9, 11.9, 15.9]);
  });

  it("parses Friday correctly (last day)", () => {
    const fri = days[4];
    expect(fri.options[1].name).toMatch(/PIZZA TONNO E LIMONE/);
    expect(fri.options[2].description).toMatch(/Rotwein-Sauce/);
  });
});

// Real PDF for the week of 11.–15. Mai 2026, where Donnerstag (14.5.) is a
// public holiday and the PDF replaces that day's three options with
// "An Feiertagen können wir Ihnen leider kein Mittagsmenü anbieten".
describe("parseFerdinandoText with a holiday day", () => {
  it("returns a Feiertag placeholder for the holiday and parses the other days", async () => {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdfPath = join(__dirname, "fixtures/ferdinando-holiday-sample.pdf");
    const bytes = new Uint8Array(readFileSync(pdfPath));
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    const asString = Array.isArray(text) ? text.join("\n") : text;

    const dates = ["2026-05-11", "2026-05-12", "2026-05-13", "2026-05-14", "2026-05-15"];
    const days = parseFerdinandoText(asString, dates);
    expect(days).toHaveLength(5);

    expect(days[3].date).toBe("2026-05-14");
    expect(days[3].options).toHaveLength(1);
    expect(days[3].options[0].name).toMatch(/Feiertag/);
    expect(days[3].options[0].price).toBeUndefined();

    for (const i of [0, 1, 2, 4]) expect(days[i].options).toHaveLength(3);
    expect(days[0].options[0].name).toMatch(/ZUPPA DI LENTICCHIE/);
    expect(days[4].options[1].name).toMatch(/PIZZA TONNO E LIMONE/);
  }, 30000);
});
