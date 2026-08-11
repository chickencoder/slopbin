-- Migration number: 0004
-- The golden banana peel. There is exactly one peel on slopbin. One user
-- holds it at a time, and gives it to a different user. Each hold is one row,
-- thus the table is also the history of the peel.

CREATE TABLE peel_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  -- NULL means the user took the peel from the bin. A number means a
  -- different user gave the peel to them.
  from_user_id INTEGER REFERENCES users(id),
  note TEXT NOT NULL DEFAULT '',
  taken_at INTEGER NOT NULL,
  -- NULL while this user holds the peel.
  released_at INTEGER
);

CREATE INDEX idx_peel_taken ON peel_holds(taken_at DESC);
CREATE INDEX idx_peel_open ON peel_holds(released_at);
