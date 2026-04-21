import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseRadatzHtml } from "../src/sources/radatz.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML = readFileSync(join(__dirname, "fixtures/radatz-sample.html"), "utf8");
const DATES = ["2026-04-20", "2026-04-21", "2026-04-22", "2026-04-23", "2026-04-24"];

describe("parseRadatzHtml", () => {
  const days = parseRadatzHtml(HTML, DATES);

  it("produces five weekdays", () => {
    expect(days).toHaveLength(5);
    expect(days.map(d => d.date)).toEqual(DATES);
  });

  it("parses Monday with two mains + dessert", () => {
    const mon = days[0];
    expect(mon.options.length).toBeGreaterThanOrEqual(2);
    expect(mon.options[0].name).toMatch(/Kalbsbutterschnitzel/);
    expect(mon.options[0].price).toBeCloseTo(8.9);
  });

  it("parses Friday fish dish with price", () => {
    const fri = days[4];
    const fish = fri.options.find(o => /Schollenfilet/.test(o.name));
    expect(fish).toBeDefined();
    expect(fish!.price).toBeCloseTo(9.5);
  });

  it("every parsed option with a price is in a sensible range", () => {
    for (const d of days) {
      for (const o of d.options) {
        if (o.price !== undefined) {
          expect(o.price).toBeGreaterThan(1);
          expect(o.price).toBeLessThan(30);
        }
      }
    }
  });

  it("does not bleed in Saturday or footer content", () => {
    const allNames = days.flatMap(d => d.options.map(o => o.name));
    expect(allNames.join(" ")).not.toMatch(/Samstag|Datenschutz|Marketing-Cookies/);
  });
});
