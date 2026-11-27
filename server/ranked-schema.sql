-- V25.1: separate server-owned competitive profiles. No browser database binding.
CREATE TABLE IF NOT EXISTS ranked_players (
  uid TEXT PRIMARY KEY NOT NULL CHECK(length(uid) BETWEEN 1 AND 128),
  rating INTEGER NOT NULL DEFAULT 1000 CHECK(rating BETWEEN 0 AND 100000),
  played INTEGER NOT NULL DEFAULT 0 CHECK(played >= 0),
  wins INTEGER NOT NULL DEFAULT 0 CHECK(wins >= 0),
  draws INTEGER NOT NULL DEFAULT 0 CHECK(draws >= 0),
  losses INTEGER NOT NULL DEFAULT 0 CHECK(losses >= 0),
  created_at INTEGER NOT NULL CHECK(created_at > 0),
  CHECK(played = wins + draws + losses)
);
-- Only future server-authoritative match settlement may update rating.
