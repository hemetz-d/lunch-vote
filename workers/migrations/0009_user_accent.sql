-- Persist each user's chosen accent so the voter-pile avatars render with
-- the same color the user sees in the rest of the UI. NULL = legacy row
-- that pre-dates this column; the frontend falls back to a name-hash tone
-- for those until the user touches the accent again.
ALTER TABLE users ADD COLUMN accent TEXT;
