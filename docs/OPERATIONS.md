# Operations

How to deploy, monitor, back up and restore Yowkly. "Done" means this runbook has been followed against production, including one real restore.

## 1. Environments

| | Local | Staging | Production |
|---|---|---|---|
| Web | `npm run dev` | Vercel preview (per PR) | Vercel production (`main`) |
| Database | `supabase start` | Supabase project `yowkly-staging` | Supabase project `yowkly-prod` (**Pro plan**) |
| Scan worker | `npm run worker` | Fly.io `yowkly-scan-staging` | Fly.io `yowkly-scan` |
| Rate limits | in-memory | Upstash (free) | Upstash |

Supabase **Pro** is required for production: 200 MB uploads (free tier caps at 50 MB), daily backups, point-in-time recovery, no project pausing.

## 2. First deploy

1. **Supabase project**: create `yowkly-prod`. Then:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push           # applies supabase/migrations (never the seed)
   ```
   Then configure these in the dashboard:
   - **Auth → URL configuration:** site URL `https://<domain>`, redirect `https://<domain>/auth/callback`
   - **Auth → Providers:** GitHub and Google OAuth apps with callback `https://<ref>.supabase.co/auth/v1/callback`
   - **Auth → Attack protection:** enable CAPTCHA (Cloudflare Turnstile) and leaked-password protection
   - **Auth → SMTP:** Resend (custom domain, SPF/DKIM)
   - **Storage → Settings:** global file size limit 210 MB
   - **Database → Extensions:** confirm `pg_cron` is on and the five jobs exist: `select jobname, schedule from cron.job;`
2. **Vercel**: import the repo and set these env vars (Production and Preview separately): `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `SENTRY_DSN`. The app refuses to boot in production without Upstash.
3. **Domain**: add it in Vercel. HTTPS is automatic, and HSTS is sent by `next.config.ts`.
4. **Scan worker** (Fly.io):
   ```bash
   fly launch --no-deploy --name yowkly-scan --dockerfile worker/Dockerfile
   fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
   fly scale memory 2048        # clamd needs ~1.2 GB for signatures
   fly deploy
   ```
   Verify it with the EICAR test file (section 5).
5. **Make yourself admin**: `insert into user_roles (user_id, role) values ('<your uuid>', 'admin');` in the SQL editor.

## 3. Monitoring

- **Errors:** Sentry for web (client and server) and the worker. *Not wired yet:* install `@sentry/nextjs`, run its wizard, and set `SENTRY_DSN`.
- **Uptime:** Better Stack monitor on `https://<domain>/` and `https://<domain>/explore` every 1 min, alerting by email and push.
- **Scan queue:** alert if this returns > 50, or anything older than 30 min:
  ```sql
  select count(*), min(created_at) from template_files where scan_status in ('pending','scanning');
  ```
- **Cron failures:** `select * from cron.job_run_details where status <> 'succeeded' order by start_time desc limit 20;`
- **Supabase:** Reports → API and Database. Check weekly for slow queries (Query Performance).

## 4. Backups and restore

Supabase database backups **do not include Storage files**. Both need covering:

| What | How | Retention |
|---|---|---|
| Postgres | Supabase daily backups + PITR add-on | 7 days PITR |
| Storage (`template-files`, `media`, `avatars`) | Nightly `rclone sync` from Supabase S3 to Cloudflare R2 (GitHub Actions cron) | 30 days (R2 object versioning) |
| Code and migrations | GitHub | forever |

**Restore drill (do this once before launch, then quarterly):**

1. Create a scratch Supabase project, `yowkly-restore-test`.
2. Restore the latest production backup into it (Dashboard → Database → Backups → Restore to new project).
3. `rclone copy r2:yowkly-backup/template-files supabase-restore:template-files` for a sample of 10 files.
4. Point a local `.env.local` at the scratch project, run `npm run dev`, and download one of the restored files.
5. Write the date, duration and any surprises into this file, then delete the scratch project.

| Date | Restored from | Duration | Notes |
|---|---|---|---|
| _not yet run_ | | | |

**Rollback:** Vercel → Deployments → promote the previous deployment (instant). Database migrations are forward-only: write a new migration that reverts, and never edit an applied one.

## 5. Security checks after every deploy

- Upload the [EICAR test file](https://www.eicar.org/download-anti-malware-testfile/) zipped. It must end up `infected` and never be downloadable.
- Signed out, `GET /api/download` must return 401, and `POST` with a random file id must return 404.
- `curl -I https://<domain>` shows `content-security-policy`, `strict-transport-security` and `x-content-type-options`.
- `npm test` has passed in CI (RLS attack tests).

## 6. Scheduled jobs (pg_cron, UTC)

| Job | Schedule | Function |
|---|---|---|
| refresh-hot-scores | every 15 min | `refresh_hot_scores()`, last 30 days only |
| award-day | 00:00 daily | `grant_award('day', yesterday)` |
| award-week | 00:05 Monday | `grant_award('week', …)` overall and for Mobile Apps |
| award-month | 00:10 on the 1st | `grant_award('month', previous month)` |
| purge-deleted-accounts | 03:00 daily | hard-deletes accounts soft-deleted more than 30 days ago |
