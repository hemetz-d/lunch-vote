import type { MenuSource, WeeklyMenu, Option } from "../types.js";
import { weekdayDates } from "../dates.js";

const STANDARD_OPTIONS: Option[] = [
  { name: "Pad Thai",        description: "Rice noodles, egg, peanuts, tamarind" },
  { name: "Pho Bo",          description: "Vietnamese beef noodle soup" },
  { name: "Ramen",           description: "Japanese wheat-noodle broth" },
  { name: "Bun Bo Nam Bo",   description: "Cold Vietnamese beef & noodle salad" },
  { name: "Curry Noodles",   description: "Choice of red / green / yellow curry" },
];

export class NoodleKingSource implements MenuSource {
  id = "noodle-king";

  async fetchWeekly(): Promise<WeeklyMenu> {
    const dates = weekdayDates(new Date());
    return {
      restaurant: "Noodle King",
      days: dates.map(date => ({ date, options: STANDARD_OPTIONS })),
    };
  }
}
