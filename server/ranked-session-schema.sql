-- V25.3d: additive internal session storage. Apply after ranked-schema.sql
-- and ranked-settlement-schema.sql, only in Preview until integration is tested.
CREATE TABLE IF NOT EXISTS ranked_sessions (
  match_id TEXT PRIMARY KEY NOT NULL REFERENCES ranked_matches(match_id),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 256),
  state_json TEXT NOT NULL CHECK(length(state_json) BETWEEN 2 AND 65536),
  updated_at INTEGER NOT NULL CHECK(typeof(updated_at)='integer' AND updated_at>0)
);
-- CAS in the repository additionally requires the exact previous revision.
CREATE TRIGGER IF NOT EXISTS ranked_session_revision_guard
BEFORE UPDATE ON ranked_sessions
WHEN NEW.match_id<>OLD.match_id OR NEW.revision<>OLD.revision+1 OR NEW.updated_at<OLD.updated_at
BEGIN SELECT RAISE(ABORT,'RANKED_SESSION_REVISION'); END;
