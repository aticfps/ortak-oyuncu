# V26.3a targeted senior-appearance audit (2026-11-27)

Eligibility: at least one competitive senior first-team appearance, including loans. Registration, youth teams and friendlies alone do not count. The archive is not a comprehensive career audit.

Corrections:
- Caner Erkin: remove Inter (no competitive debut). https://en.wikipedia.org/wiki/Caner_Erkin ; https://www.uefa.com/uefachampionsleague/news/0232-0e954f888642-8c7ecb61d6ce-1000--caner-erkin-set-for-long-besiktas-absence/
- Pierre-Emerick Aubameyang: remove Milan in both memberships and career chain. https://www.skysports.com/football/news/11814/7392196/permanent-move-for-aubameyang
- Wout Weghorst: add Hoffenheim. https://datencenter.dfb.de/en/people/wout-weghorst/player ; https://www.bundesliga.com/en/player/wout-weghorst
- Fabinho: add Real Madrid senior debut, May 2013. https://www.bdfutbol.com/en/j/j16332.html?p=stats ; https://www.liverpoolfc.com/news/first-team/303595-fabinho-liverpool-fc-profile
- Rigobert Song: add Köln and Lens. https://www.lfchistory.net/players/414 ; https://fbref.com/en/players/d884e39b/Rigobert-Song

Retain Salah and Fabinho at Trabzonspor: current 2026 sources confirm the moves. https://www.reuters.com/sports/soccer/trabzonspor-set-sign-fabinho-free-transfer-2026-08-24/ ; https://apnews.com/article/7de43f2f89c213714c8c188dc584dc41
Carl Medjani remains ineligible for Liverpool because he had zero competitive first-team appearances: https://lfchistory.net/players/514

30 active clubs, 114 archive clubs, 1,906 players, 5,536 memberships. Active pair entries: 1,999 (previously 2,006); empty pairs: 30 (previously 31). Data correctness takes priority over inflated coverage.

Deployment: production remains disabled. The deterministic session version changes from v2 to v3; do not deploy while old sessions/accepted reservations or queue entries are outstanding. Verify both databases are drained before merge and pause preview play during deployment. Redeploy both scheduled sweepers from the same new main revision, using existing separate database bindings and configs. No ELO reset or schema change. Old completed ledger/history stays intact; old session journals are not migrated. Confirm daily pair test and run all Node tests before merge. This is a targeted audit only, not verification of every player.
