-- Spar (local supermarket) — self-service lunch, no daily menu to scrape.
-- Like noodle-king it has a static "menu" (categories) provided by the source.
-- Hidden from the weekly overview (frontend HIDDEN_IN_WEEK) but available on
-- the Today vote card.
INSERT OR IGNORE INTO restaurants (id, name, source_id) VALUES
  ('spar', 'Spar', 'spar');
