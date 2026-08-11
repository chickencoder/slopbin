-- Migration number: 0002
-- Replace password auth with GitHub OAuth. Accounts are now GitHub
-- identities. Day-one reset: password users can't migrate, so all
-- data is wiped and the genesis invite re-seeded.

DROP TABLE sessions;
DROP TABLE posts;
DROP TABLE invites;
DROP TABLE users;

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id INTEGER NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE, -- mirrors the GitHub login
  invited_by INTEGER REFERENCES users(id),
  merged_prs INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  created_by INTEGER REFERENCES users(id),
  used_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_posts_created ON posts(created_at DESC);
CREATE INDEX idx_posts_user ON posts(user_id);
CREATE INDEX idx_invites_creator ON invites(created_by);
CREATE INDEX idx_sessions_user ON sessions(user_id);

INSERT INTO invites (code, created_by, used_by, created_at)
VALUES ('genesis', NULL, NULL, unixepoch());
