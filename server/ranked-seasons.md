# V25.6 – Monthly ranked season foundation

Seasons use calendar months in UTC (inclusive start, exclusive end). `season.me` in the private preview endpoint returns the current server-selected season and the authenticated player's settled match totals and signed net ELO change. A late settlement belongs to the match finish month. Unsettled, active and void matches are excluded. Historical test matches are included in Preview; Production remains disabled.

No new table or migration, no lifetime ELO reset, no client-selected UID or season, and no changes to the game journal. This is a read-only foundation; the seasonal profile UI, previous-season browsing, global rankings and rewards remain separate work. Real D1 validation and query performance checks are still required before public activation.
