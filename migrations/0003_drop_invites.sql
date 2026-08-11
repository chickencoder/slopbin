-- Migration number: 0003
-- Remove the invite system. A GitHub account is the only thing you need now.
-- Existing users, posts and sessions are preserved.

DROP INDEX IF EXISTS idx_invites_creator;
DROP TABLE IF EXISTS invites;

-- `invited_by` was the last trace of invites. Dropping the column in place
-- keeps the foreign keys that posts and sessions hold into users intact --
-- rebuilding the table instead trips deferred FK checks at commit time.
ALTER TABLE users DROP COLUMN invited_by;
