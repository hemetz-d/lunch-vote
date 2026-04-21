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
