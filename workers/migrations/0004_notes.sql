CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  date       TEXT NOT NULL,            -- ISO yyyy-mm-dd, partitions per day
  user_id    TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_date_created ON notes(date, created_at);
