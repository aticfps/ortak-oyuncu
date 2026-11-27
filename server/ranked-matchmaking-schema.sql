-- V25.4a internal matchmaking. Apply only after ranked settlement and session schemas.
CREATE TABLE IF NOT EXISTS ranked_queue (
 uid TEXT PRIMARY KEY NOT NULL REFERENCES ranked_players(uid),
 joined_at INTEGER NOT NULL CHECK(typeof(joined_at)='integer' AND joined_at>0),
 seen_at INTEGER NOT NULL CHECK(typeof(seen_at)='integer' AND seen_at>=joined_at)
);
CREATE INDEX IF NOT EXISTS ranked_queue_seen_idx ON ranked_queue(seen_at);
CREATE INDEX IF NOT EXISTS ranked_matches_a_status_idx ON ranked_matches(uid_a,status);
CREATE INDEX IF NOT EXISTS ranked_matches_b_status_idx ON ranked_matches(uid_b,status);
-- An active or not-yet-settled completed game reserves both participants.
CREATE TRIGGER IF NOT EXISTS ranked_match_single_active_guard
BEFORE INSERT ON ranked_matches WHEN NEW.status='active'
BEGIN
 SELECT CASE WHEN EXISTS (
  SELECT 1 FROM ranked_matches m
  WHERE (m.uid_a IN (NEW.uid_a,NEW.uid_b) OR m.uid_b IN (NEW.uid_a,NEW.uid_b))
   AND (m.status='active' OR (m.status='completed' AND NOT EXISTS
    (SELECT 1 FROM ranked_settlements s WHERE s.match_id=m.match_id)))
 ) THEN RAISE(ABORT,'RANKED_PLAYER_BUSY') END;
END;
-- One match INSERT atomically consumes both queue entries.
CREATE TRIGGER IF NOT EXISTS ranked_match_queue_consume
AFTER INSERT ON ranked_matches WHEN NEW.status='active'
BEGIN
 DELETE FROM ranked_queue WHERE uid IN (NEW.uid_a,NEW.uid_b);
END;
