import type { MenuSource, WeeklyMenu, Option } from "../types.js";
import { weekdayDates } from "../dates.js";

// Noodle King doesn't publish a daily menu — they serve the same build-your-own box
// every day. The two decisions the office actually cares about are noodle vs rice,
// so surface those as the two options with the protein/sauce choices in the
// description.
const STANDARD_OPTIONS: Option[] = [
  {
    name: "Noodle Box",
    description: "Grilled or crispy chicken · teriyaki, sweet chili, or sweet & sour",
    price: 6.90,
  },
  {
    name: "Rice Box",
    description: "Grilled or crispy chicken · teriyaki, sweet chili, or sweet & sour",
    price: 6.90,
  },
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
