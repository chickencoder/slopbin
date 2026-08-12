-- The slop that the users throw into the bin. Each row is one link, one
-- verdict from a very cheap model, and (when has_shot = 1) one screenshot
-- in R2 under shots/<id>.jpg.
CREATE TABLE slops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  url TEXT NOT NULL,
  verdict TEXT NOT NULL DEFAULT '',
  has_shot INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX slops_created_idx ON slops (created_at DESC, id DESC);
CREATE INDEX slops_user_idx ON slops (user_id, created_at DESC);
