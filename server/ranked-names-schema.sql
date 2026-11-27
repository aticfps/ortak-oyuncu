-- V26.2a: only player-selected public game nicknames; no Google profile fields.
CREATE TABLE IF NOT EXISTS ranked_names (
 uid TEXT PRIMARY KEY NOT NULL REFERENCES ranked_players(uid) ON DELETE CASCADE,
 display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 16)
);
