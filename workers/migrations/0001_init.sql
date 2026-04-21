CREATE TABLE IF NOT EXISTS restaurants (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  source_id  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS menus (
  restaurant_id TEXT NOT NULL,
  date          TEXT NOT NULL,           -- ISO yyyy-mm-dd
  options_json  TEXT NOT NULL,
  fetched_at    INTEGER NOT NULL,
  PRIMARY KEY (restaurant_id, date)
);

CREATE TABLE IF NOT EXISTS votes (
  date          TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  restaurant_id TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (date, user_id)
);

CREATE TABLE IF NOT EXISTS source_status (
  source_id       TEXT PRIMARY KEY,
  last_fetched_at INTEGER,
  last_error      TEXT
);

CREATE INDEX IF NOT EXISTS idx_votes_date_restaurant ON votes(date, restaurant_id);

INSERT OR IGNORE INTO restaurants (id, name, source_id) VALUES
  ('ferdinando',  'Da Ferdinando',        'ferdinando'),
  ('radatz',      'Radatz Ekazent',       'radatz'),
  ('noodle-king', 'Noodle King',          'noodle-king'),
  ('odysseus',    'Restaurant Odysseus',  'odysseus');
