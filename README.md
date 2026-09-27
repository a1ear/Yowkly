# Yowkly

A community showcase where developers and designers publish web templates, mobile app designs and UI kits. People like, vote on and download them. The best work wins daily, weekly and monthly awards.

- **Plan & architecture:** [PLAN.md](PLAN.md)
- **Design brief sent to Claude Design:** [DESIGN_PROMPT.md](DESIGN_PROMPT.md)
- **Running it in production:** [docs/OPERATIONS.md](docs/OPERATIONS.md)

## Stack

Next.js 16 (App Router) · Supabase (Postgres, Auth, Storage, pg_cron) · Tailwind 4 · Upstash rate limiting · ClamAV scan worker.

## Local setup

Requirements: Node 20.9+, Docker Desktop (running).

```bash
npm install
npm run db:start          # starts local Supabase and applies migrations + seed
npx supabase status       # copy API URL, anon key and service_role key
cp .env.example .env.local  # paste the values in
npm run seed:storage      # placeholder bytes for the demo downloads
npm run dev               # http://localhost:3000
```

Demo accounts are listed at the top of [supabase/seed.sql](supabase/seed.sql). Local email (sign-up confirmations, magic links) is visible at http://127.0.0.1:54324.

To process uploads locally, run the scan worker in a second terminal:

```bash
ALLOW_NO_ANTIVIRUS=1 npm run worker     # structural checks only, local dev
```

With ClamAV available (`docker run -p 3310:3310 clamav/clamav`), set `CLAMD_HOST=127.0.0.1` instead.

## Scripts

| Command | What it does |
|---|---|
| `npm run check` | Lint + typecheck + all tests |
| `npm test` | Database security tests (PGlite, no Docker) + scan-worker checks |
| `npm run db:reset` | Re-apply migrations and seed to local Supabase |
| `npm run db:types` | Generate TypeScript types from the local schema |
| `npm run worker` | Run the upload scan worker |

## Where things live

```
supabase/migrations/   schema, RLS, functions, read models, feed, awards, cron  ← the source of truth for permissions
supabase/seed.sql      local demo data only
src/app/               routes (pages, server actions, route handlers)
src/app/actions/       every mutation: zod → rate limit → Supabase as the user (RLS decides)
src/lib/data/          cached public reads and per-user reads
src/components/        UI (design tokens in src/app/globals.css)
worker/                upload scanner (ClamAV + archive checks) and its Dockerfile
tests/db/              attack tests: cross-user access, tampering, abuse
tests/worker/          hostile archives: zip bombs, traversal, symlinks, executables
```

## Security model in one paragraph

The browser is never trusted. Every write goes through a server action that validates input and rate-limits, then calls Supabase **with the user's own JWT**, so Postgres Row Level Security makes the final decision. State changes (publish, moderate, download) are database functions with their own checks. The service-role key is used for exactly two things: signing 60-second download URLs for paths the database already authorised, and the scan worker. Uploaded files are unreachable until the worker marks them clean.
