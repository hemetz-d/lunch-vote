-- Allow multiple votes per (user, date). Previously the votes table used
-- (date, user_id) as PRIMARY KEY, enforcing one vote per user per day. The
-- new UI's swipe flow lets users vote for several restaurants in a single
-- session, so the key shifts to (date, user_id, restaurant_id) — each row is
-- one (user, day, restaurant) pick.
--
-- SQLite can't drop a PK constraint in place, so we rebuild the table.
PRAGMA foreign_keys=OFF;

CREATE TABLE votes_new (
  date          TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  restaurant_id TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (date, user_id, restaurant_id)
);

INSERT INTO votes_new (date, user_id, restaurant_id, updated_at)
SELECT date, user_id, restaurant_id, updated_at FROM votes;

DROP TABLE votes;
ALTER TABLE votes_new RENAME TO votes;

CREATE INDEX IF NOT EXISTS idx_votes_date_restaurant ON votes(date, restaurant_id);

PRAGMA foreign_keys=ON;
