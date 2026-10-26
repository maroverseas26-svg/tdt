# tdt — Cloudflare Worker for Todaytec CRM

Serves the CRM frontend and the auth API. Accounts and password hashes live in
Cloudflare D1 (`tdt`), SMTP credentials are Worker secrets — neither is in the
frontend bundle or in Supabase.

- URL (temporary, until `crm.todaytec.com.vn` DNS moves from Netlify): https://tdt.todaytec.workers.dev
- Account: `b644d3ffa105392fa0afdcd5aa4c7b84` · D1: `tdt` (APAC)

## API (`/api/*`)

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | anyone | `{email, password}` → sets `tdt_session` HttpOnly cookie; 10 failures / 15 min per email → 429 |
| POST | `/api/auth/logout` | anyone | clears the session |
| GET | `/api/auth/me` | session | current user |
| POST | `/api/auth/request-reset` | anyone | `{email}` → emails `<origin>/?reset=<token>` (30 min); always the same answer |
| POST | `/api/auth/confirm-reset` | anyone | `{token, password}` → `invalid_or_expired` / `too_short` |
| POST | `/api/auth/change-password` | session | `{currentPassword, newPassword}` |
| GET | `/api/users` | session | team list, never includes passwords |
| PUT | `/api/users/:id` | admin, or self | admin may pass `password` to set it; self edits keep role/scope fields |
| POST | `/api/users/:id/password` | admin | `{password}` |
| DELETE | `/api/users/:id` | admin | soft delete (`_deleted: true`) |

Admin = role `BOD` or `modules` contains `admin`. Passwords: PBKDF2-SHA256, 100k
iterations, random salt, stored as `pbkdf2-sha256$iter$salt$hash`.

## Secrets

`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (copied from the
Supabase Edge Function secrets). Optional: `APP_NAME`, `APP_URL` (reset links
otherwise use the request origin). Set with `npx wrangler secret put <NAME>`.

## Accounts

`scripts/sync-users-from-supabase.cjs` copies the accounts from Supabase
`users(_all)` into D1 with hashed passwords (21 accounts loaded on 2026-10-26).
Re-run it right before the DNS cutover; after cutover D1 is the only source.

## Deploy

```sh
npm install
npm run db:migrate   # applies migrations/ to the remote D1
npm run deploy       # copies ../index.html to dist/ and deploys
```

The frontend is imported into the Worker as a Text module (not Workers static
assets), so a deploy is a single script upload.
