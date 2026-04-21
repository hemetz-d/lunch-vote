-- "None of these" is modeled as a special restaurant row so it rides on the
-- existing votes table (one vote per user per day, upsert-on-change). source_id
-- "protest" is not wired to any fetcher, so the cron ignores it.
INSERT OR IGNORE INTO restaurants (id, name, source_id) VALUES
  ('protest', 'None of these', 'protest');
