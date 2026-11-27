# V26.0c — Preview-only ranked sweeper

Separate Cloudflare Worker, no public HTTP route. Cron once per minute (UTC). It expires at most 50 pending offers, prunes 100 stale queue leases, and checks at most 3 accepted/unfinished matches per invocation. It uses the existing durable recovery and finalization code, never client scores. No new schema; the V26.0b rate-limit migration still needs to be applied to Preview before updating the Pages app.

## Deployment (only after tests pass)
1. Copy wrangler.example.json to wrangler.json in this directory, replace REPLACE_WITH_PREVIEW_DATABASE_ID with the verified ID of ortak-oyuncu-ranked-preview, never the production database ID. Do not commit the local config.
2. From repo root run npx.cmd wrangler deploy --config workers/ranked-preview-sweeper/wrangler.json. Confirm name, D1 binding, and cron in dashboard before enabling broader testing. Do not deploy this as a Pages function or use production bindings.
3. Inspect logs for ranked_preview_sweep counts and check D1 results. Disable by deploying config with triggers.crons=[] if necessary.

Bounded work means backlog may need multiple invocations; persistent corrupt sessions may need manual investigation. The worker logs aggregate counts, not UID or match IDs. Existing access-triggered recovery remains. No automatic deletion of match history, no change to ELO, no public activation. The schedule is not live until deployed, and runtime quota/latency and actual D1 behavior must be verified. Preview and production must remain separate.
