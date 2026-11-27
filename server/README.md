# V25.1 ranked foundation

Cloudflare Pages Functions routes /api/ranked/status and /api/ranked/me.
Create a D1 database (e.g. ortak-oyuncu-ranked) in the Cloudflare dashboard, execute server/ranked-schema.sql in its console, then add a Production D1 binding named RANKED_DB to the Pages project and redeploy. No Firebase service account or new RTDB rules required. Preview environments must use a separate D1 database or leave the binding absent. The existing Pages build command copies only static assets, not server/ or tests/. Functions compile from the repository root. Do not change the build output directory to the repository root.

GET /api/ranked/status: 503 until DB and schema exist, 200 when ready.
GET /api/ranked/me: Bearer Firebase ID token; reads own profile.
POST /api/ranked/me: Bearer Firebase ID token; idempotently creates own profile at 1000 ELO, ignores request body. No rating update endpoints. All responses no-store. Google-only signed Firebase ID tokens are verified using Google's public keys. Revocation checking is not yet implemented; tokens remain valid until expiration.
No competitive gameplay or result settlement is exposed in V25.1; ranking remains disabled. Normal room and stats data are unchanged. The next milestones must implement authoritative gameplay and settlement before opening the queue.
Run node --test tests/*.test.cjs (Node 20+). Static http-server only tests the screen and safe API-unavailable state. Real API tests require Pages Functions and D1; do not treat static tests as deployment validation.
