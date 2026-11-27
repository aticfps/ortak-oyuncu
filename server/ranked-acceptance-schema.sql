-- V25.4b: atomic reservations and acceptance. Apply after matchmaking schema.
CREATE TABLE IF NOT EXISTS ranked_offers (
 match_id TEXT PRIMARY KEY NOT NULL REFERENCES ranked_matches(match_id),
 uid_a TEXT NOT NULL REFERENCES ranked_players(uid),
 uid_b TEXT NOT NULL REFERENCES ranked_players(uid),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>0),
 expires_at INTEGER NOT NULL CHECK(expires_at=created_at+20000),
 accepted_a INTEGER CHECK(accepted_a IS NULL OR (typeof(accepted_a)='integer' AND accepted_a>=created_at AND accepted_a<expires_at)),
 accepted_b INTEGER CHECK(accepted_b IS NULL OR (typeof(accepted_b)='integer' AND accepted_b>=created_at AND accepted_b<expires_at)),
 status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined','expired')),
 CHECK(uid_a<>uid_b),
 CHECK((status='accepted')=(accepted_a IS NOT NULL AND accepted_b IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ranked_offers_expiry_idx ON ranked_offers(status,expires_at);
-- Reservation and queue consumption happen in the same INSERT statement.
CREATE TRIGGER IF NOT EXISTS ranked_offer_create_match
BEFORE INSERT ON ranked_offers
BEGIN
 SELECT CASE WHEN NEW.status<>'pending' OR NEW.accepted_a IS NOT NULL OR NEW.accepted_b IS NOT NULL
 THEN RAISE(ABORT,'INVALID_OFFER') END;
 INSERT INTO ranked_matches(match_id,uid_a,uid_b,status,score_a,score_b,finished_at)
 VALUES(NEW.match_id,NEW.uid_a,NEW.uid_b,'active',NULL,NULL,NULL);
END;
CREATE TRIGGER IF NOT EXISTS ranked_offer_update_guard
BEFORE UPDATE ON ranked_offers
WHEN OLD.status<>'pending' OR NEW.match_id<>OLD.match_id OR NEW.uid_a<>OLD.uid_a OR NEW.uid_b<>OLD.uid_b
 OR NEW.created_at<>OLD.created_at OR NEW.expires_at<>OLD.expires_at
 OR (OLD.accepted_a IS NOT NULL AND NEW.accepted_a IS NOT OLD.accepted_a)
 OR (OLD.accepted_b IS NOT NULL AND NEW.accepted_b IS NOT OLD.accepted_b)
BEGIN SELECT RAISE(ABORT,'RANKED_OFFER_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS ranked_offer_close
AFTER UPDATE ON ranked_offers WHEN NEW.status IN ('declined','expired')
BEGIN
 UPDATE ranked_matches SET status='void' WHERE match_id=NEW.match_id AND status='active';
END;
CREATE TRIGGER IF NOT EXISTS ranked_offer_session_guard
BEFORE INSERT ON ranked_sessions
WHEN EXISTS (SELECT 1 FROM ranked_offers o WHERE o.match_id=NEW.match_id AND o.status<>'accepted')
BEGIN SELECT RAISE(ABORT,'RANKED_OFFER_NOT_ACCEPTED'); END;
CREATE TRIGGER IF NOT EXISTS ranked_offer_delete_guard
BEFORE DELETE ON ranked_offers
BEGIN SELECT RAISE(ABORT,'RANKED_OFFER_IMMUTABLE'); END;
