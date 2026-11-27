-- V26.0b: one atomic fixed-window counter per verified preview account.
CREATE TABLE IF NOT EXISTS ranked_request_limits (
 uid TEXT PRIMARY KEY NOT NULL CHECK(length(uid) BETWEEN 1 AND 128),
 window_start INTEGER NOT NULL CHECK(typeof(window_start)='integer' AND window_start>=0),
 requests INTEGER NOT NULL CHECK(typeof(requests)='integer' AND requests BETWEEN 1 AND 120),
 answers INTEGER NOT NULL CHECK(typeof(answers)='integer' AND answers BETWEEN 0 AND 30 AND answers<=requests)
);
