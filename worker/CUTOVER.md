# Cutover: crm.todaytec.com.vn from Netlify + Supabase to Cloudflare

State before cutover:

- New app (Worker `tdt` + D1 `tdt`): https://tdt.todaytec.workers.dev
- DNS front door (Pages `tdt-crm`, forwards to the Worker): https://tdt-crm.pages.dev
- `crm.todaytec.com.vn` is already registered on the Pages project (status pending);
  it activates by itself once DNS points at Pages.
- Old app keeps running on Netlify + Supabase until the DNS change.

## 0. Before cutover: free-plan aggregates (once)

Migration `0003_po_aggregates.sql` adds the PO aggregate caches (see `src/rpc.js`) and
swaps the PO date index for `(deleted, d, id)`. Apply it, deploy, then build the caches
one month per request:

```sh
cd worker
npm run db:migrate                     # applies 0003 (~55k rows read, ~15k rows written)
npm run deploy
MIGRATION_TOKEN=... node scripts/warm-aggregates.mjs   # ~290k rows read, ~350 written, once
```

Run this on a day with read budget left (the D1 free plan resets at 00:00 UTC). A full
re-import of all POs costs ~127k rows written (row + indexes + triggers), more than a day's
100k — keep data syncs incremental (step 2).

## 1. Freeze (about 15 minutes)

Ask the team to stop entering data in the old app.

## 2. Final data sync (Supabase → D1)

```sh
cd worker
export CLOUDFLARE_API_TOKEN=...      # or the session proxy
export MIGRATION_TOKEN=...           # the Worker secret of the same name
NODE_USE_ENV_PROXY=1 node scripts/sync-data-from-supabase.mjs --dry-run   # what would change
NODE_USE_ENV_PROXY=1 node scripts/sync-data-from-supabase.mjs             # all CRM tables, re-runnable
node scripts/sync-users-from-supabase.cjs                                 # accounts + current passwords (hashed)
```

The data sync is incremental: it compares `(id, updated_at)` on both sides, writes only
new/changed rows and removes rows that no longer exist in Supabase, so anything typed into
the new app before cutover (tests) is replaced by Supabase's data. It prints the D1 rows
read/written it caused (~15k read and ~7 written per changed PO; `--full` rewrites
everything and does not fit the free plan's daily writes).

## 3. DNS

At the DNS provider of `todaytec.com.vn`, replace the `crm` record (currently Netlify) with:

| Type | Name | Value | TTL |
|---|---|---|---|
| CNAME | crm | tdt-crm.pages.dev | 300 |

Then wait until the domain shows **Active** in Cloudflare → Workers & Pages → tdt-crm →
Custom domains (SSL is issued automatically, usually a few minutes).

## 4. Check

- https://crm.todaytec.com.vn loads, sign in with an existing account (passwords unchanged)
- Overview / PO List figures match the old app
- "Forgot password" sends the email and the link opens https://crm.todaytec.com.vn/?reset=…

## 5. After cutover

- Supabase project "CRM tdt": remove the `anon` policies on the CRM tables (today anyone
  holding the old publishable key can read/write them, including the plaintext passwords
  in `users`), then keep the project read-only as a backup for 30 days.
- Delete the Edge Functions `request-reset`, `confirm-reset` and `cf-secret-export`.
- `npx wrangler secret delete MIGRATION_TOKEN` (disables the sync scripts' access).
- Delete the temporary test account `u-e2e-test` if it still exists.
