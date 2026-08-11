-- Migration 0002: Add better-auth admin plugin columns
-- The admin() plugin in auth-d1.ts requires these fields on user/session.
-- Without them, sign-up fails at INSERT (better-auth swallows the underlying D1 error).

ALTER TABLE user ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE user ADD COLUMN banned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user ADD COLUMN banReason TEXT;
ALTER TABLE user ADD COLUMN banExpires INTEGER;

ALTER TABLE session ADD COLUMN impersonatedBy TEXT;