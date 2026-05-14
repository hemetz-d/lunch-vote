import type { MenuSource, WeeklyMenu, Option } from "../types.js";
import { weekdayDates } from "../dates.js";

// Spar is the local supermarket — there's no fixed daily menu and no per-item
// prices to surface (most of it is self-service / pay-by-weight). We list the
// stable self-service categories so the voting card has something meaningful
// to display. Same items every weekday; the cron just re-stamps them.
const STANDARD_OPTIONS: Option[] = [
  { name: "Heiße Theke" },
  { name: "Salatbar & Suppen" },
  { name: "Sandwiches & Wraps" },
  { name: "Sushi & Bowls" },
];

export class SparSource implements MenuSource {
  id = "spar";

  async fetchWeekly(): Promise<WeeklyMenu> {
    const dates = weekdayDates(new Date());
    return {
      restaurant: "Spar",
      days: dates.map(date => ({ date, options: STANDARD_OPTIONS })),
    };
  }
}
