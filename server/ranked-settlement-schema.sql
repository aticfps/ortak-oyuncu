-- V25.3a additive migration. Apply only after ranked-schema.sql.
-- Server-owned tables; no client or host write path is permitted.
CREATE TABLE IF NOT EXISTS ranked_matches (
  match_id TEXT PRIMARY KEY NOT NULL CHECK(length(match_id) BETWEEN 1 AND 128),
  uid_a TEXT NOT NULL REFERENCES ranked_players(uid),
  uid_b TEXT NOT NULL REFERENCES ranked_players(uid),
  status TEXT NOT NULL CHECK(status IN ('active','completed','void')),
  score_a INTEGER,
  score_b INTEGER,
  finished_at INTEGER,
  CHECK(uid_a <> uid_b),
  CHECK((status='completed' AND typeof(score_a)='integer' AND score_a BETWEEN 0 AND 100000
    AND typeof(score_b)='integer' AND score_b BETWEEN 0 AND 100000
    AND typeof(finished_at)='integer' AND finished_at>0)
    OR (status IN ('active','void') AND score_a IS NULL AND score_b IS NULL AND finished_at IS NULL))
);
CREATE TABLE IF NOT EXISTS ranked_settlements (
  match_id TEXT PRIMARY KEY NOT NULL REFERENCES ranked_matches(match_id),
  uid_a TEXT NOT NULL REFERENCES ranked_players(uid),
  uid_b TEXT NOT NULL REFERENCES ranked_players(uid),
  outcome TEXT NOT NULL CHECK(outcome IN ('win','draw','loss')),
  model TEXT NOT NULL CHECK(model='elo-v1-k50'),
  rating_a_before INTEGER NOT NULL CHECK(rating_a_before BETWEEN 0 AND 100000),
  rating_b_before INTEGER NOT NULL CHECK(rating_b_before BETWEEN 0 AND 100000),
  rating_a_after INTEGER NOT NULL CHECK(rating_a_after BETWEEN 0 AND 100000),
  rating_b_after INTEGER NOT NULL CHECK(rating_b_after BETWEEN 0 AND 100000),
  played_a_before INTEGER NOT NULL CHECK(played_a_before BETWEEN 0 AND 9007199254740990),
  played_b_before INTEGER NOT NULL CHECK(played_b_before BETWEEN 0 AND 9007199254740990),
  settled_at INTEGER NOT NULL CHECK(settled_at>0),
  CHECK(uid_a<>uid_b),
  CHECK(rating_a_after+rating_b_after=rating_a_before+rating_b_before),
  CHECK(abs(rating_a_after-rating_a_before)<=50),
  CHECK((outcome='win' AND rating_a_after>=rating_a_before) OR
        (outcome='loss' AND rating_a_after<=rating_a_before) OR outcome='draw')
);
CREATE TRIGGER IF NOT EXISTS ranked_match_identity_guard
BEFORE UPDATE ON ranked_matches
WHEN OLD.status<>'active' OR NEW.match_id<>OLD.match_id OR NEW.uid_a<>OLD.uid_a OR NEW.uid_b<>OLD.uid_b
BEGIN
  SELECT RAISE(ABORT,'RANKED_MATCH_IMMUTABLE');
END;
CREATE TRIGGER IF NOT EXISTS ranked_match_delete_guard
BEFORE DELETE ON ranked_matches
BEGIN
  SELECT RAISE(ABORT,'RANKED_MATCH_IMMUTABLE');
END;
CREATE TRIGGER IF NOT EXISTS ranked_settlement_guard
BEFORE INSERT ON ranked_settlements
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM ranked_matches m
    JOIN ranked_players a ON a.uid=m.uid_a
    JOIN ranked_players b ON b.uid=m.uid_b
    WHERE m.match_id=NEW.match_id AND m.status='completed'
      AND m.uid_a=NEW.uid_a AND m.uid_b=NEW.uid_b
      AND NEW.outcome=CASE WHEN m.score_a>m.score_b THEN 'win' WHEN m.score_a<m.score_b THEN 'loss' ELSE 'draw' END
      AND a.rating=NEW.rating_a_before AND b.rating=NEW.rating_b_before
      AND a.played=NEW.played_a_before AND b.played=NEW.played_b_before
      AND NEW.settled_at>=m.finished_at
  ) THEN RAISE(ABORT,'RANKED_SETTLEMENT_GUARD') END;
END;
-- One INSERT statement includes both profile updates. SQLite rolls the whole
-- statement back if any constraint or trigger fails; never use separate writes.
CREATE TRIGGER IF NOT EXISTS ranked_settlement_apply
AFTER INSERT ON ranked_settlements
BEGIN
  UPDATE ranked_players SET rating=NEW.rating_a_after,played=played+1,
    wins=wins+(NEW.outcome='win'),draws=draws+(NEW.outcome='draw'),losses=losses+(NEW.outcome='loss')
    WHERE uid=NEW.uid_a;
  UPDATE ranked_players SET rating=NEW.rating_b_after,played=played+1,
    wins=wins+(NEW.outcome='loss'),draws=draws+(NEW.outcome='draw'),losses=losses+(NEW.outcome='win')
    WHERE uid=NEW.uid_b;
END;
CREATE TRIGGER IF NOT EXISTS ranked_settlement_update_guard
BEFORE UPDATE ON ranked_settlements BEGIN SELECT RAISE(ABORT,'RANKED_LEDGER_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS ranked_settlement_delete_guard
BEFORE DELETE ON ranked_settlements BEGIN SELECT RAISE(ABORT,'RANKED_LEDGER_IMMUTABLE'); END;
