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
