# V26.0a – Ranked recovery

Authenticated private-preview queue calls recover the caller's current reservation. Both accepted but no session: after 120 seconds from the later acceptance, atomically void only if the match is still active and no session exists. The offer remains immutable for audit. This is recovery on access, not a scheduled expiry or strict start deadline. If a session wins the race to start, it is retained.

Existing sessions are replayed from the durable journal; a stale session (45 seconds since its last persisted event) gets an internal tick. Completed/void sessions are finalized idempotently through the existing authoritative service. The returning client can poll the terminal result. No new ELO rules, database schema or public access. Preview allowlist remains enforced.

Still required: scheduled sweep for absent players, rate limits, production readiness and D1/real-device tests. The HTML version remains 25.8 for this backend-only change.
