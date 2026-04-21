export type Option = {
  name: string;
  description?: string;
  price?: number;
};

export type DayMenu = {
  date: string;           // ISO yyyy-mm-dd
  options: Option[];
};

export type WeeklyMenu = {
  restaurant: string;
  days: DayMenu[];
};

export interface MenuSource {
  id: string;
  // Human-readable URL of the original menu page. Rendered as a "View original"
  // link on each restaurant card so users can sanity-check the parsed output.
  // Optional because some sources (e.g. Noodle King) don't publish a menu page.
  menuUrl?: string;
  fetchWeekly(env: SourceEnv): Promise<WeeklyMenu>;
}

export type SourceEnv = {
  PDF_CACHE: R2Bucket;
  // Fixed "now" for deterministic testing.
  now?: Date;
};

export type Env = {
  DB: D1Database;
  PDF_CACHE: R2Bucket;
  ADMIN_SECRET: string;
};
