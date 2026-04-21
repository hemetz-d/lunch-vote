import { describe, it, expect } from "vitest";
import { viewingDate } from "../src/dates.js";

describe("viewingDate", () => {
  it("returns today for weekdays", () => {
    expect(viewingDate(new Date("2026-04-20T12:00:00Z"))).toBe("2026-04-20"); // Mon
    expect(viewingDate(new Date("2026-04-21T12:00:00Z"))).toBe("2026-04-21"); // Tue
    expect(viewingDate(new Date("2026-04-24T12:00:00Z"))).toBe("2026-04-24"); // Fri
  });

  it("jumps to next Monday on Sat/Sun", () => {
    expect(viewingDate(new Date("2026-04-25T12:00:00Z"))).toBe("2026-04-27"); // Sat -> Mon
    expect(viewingDate(new Date("2026-04-26T12:00:00Z"))).toBe("2026-04-27"); // Sun -> Mon
  });
});
