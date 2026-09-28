# Operations

How to deploy, monitor, back up and restore Yowkly. "Done" means this runbook has been followed against production, including one real restore.

## 1. Environments (the $0 setup)

| | Local | Production |
|---|---|---|
| Web | `npm run dev` | Vercel Hobby (free; **non-commercial use only**, move to Pro before charging money) |
| Database + auth | `supabase start` | Supabase **Free** |
| Uploaded files and images | R2 dev buckets | Cloudflare **R2 free tier**: 10 GB storage, free downloads, no per-file cap |
| Scan worker | `npm run worker` | GitHub Actions (`scan.yml`): started by each upload, plus an hourly safety run |
| Rate limits | in-memory | Upstash free |
| Backups | none | GitHub Actions nightly `pg_dump` to R2 (`backup.yml`) |

**Free-plan limits to know about:**
- **Supabase Free pauses a project after 7 days without activity.** Real traffic prevents it, and the nightly backup also connects to the database every day.
- **Supabase's built-in email sends only a few messages per hour.** Sign-up confirmations will fail once real users arrive. Set up custom SMTP (Resend's free tier is 3,000 emails/month) before launch.
- **Supabase Free has no backups**, which is why `backup.yml` exists. Test a restore once (section 4).
- **R2 free tier:** 10 GB stored, 1M writes and 10M reads per month. Downloads never cost anything.

## 2. First deploy

1. **Supabase:** from the project folder:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push           # applies supabase/migrations (never the seed)
   ```
   Then in the dashboard:
   - **Auth → URL configuration:** site URL `https://<domain>`, redirect `https://<domain>/auth/callback`
   - **Auth → Providers:** GitHub and Google OAuth apps with callback `https://<ref>.supabase.co/auth/v1/callback` (optional; email works without them)
   - **Auth → Attack protection:** enable CAPTCHA (Cloudflare Turnstile)
   - **Auth → SMTP:** Resend (see the limits above)
   - **Database → Extensions:** confirm `pg_cron` is on and the five jobs exist: `select jobname, schedule from cron.job;`
2. **Cloudflare R2** (dashboard → R2):
   - Create four buckets: `yowkly-quarantine`, `yowkly-files`, `yowkly-media`, `yowkly-backups`.
   - **Only `yowkly-media` is public.** Enable its public r2.dev URL (or connect a custom domain like `media.yowkly.com`). That URL is `NEXT_PUBLIC_MEDIA_URL`.
   - **CORS:** browsers upload straight to R2, so add this CORS policy to `yowkly-quarantine` and `yowkly-media`:
     ```json
     [{ "AllowedOrigins": ["https://<domain>", "http://localhost:3000"],
        "AllowedMethods": ["PUT"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
     ```
   - On `yowkly-quarantine`, add a lifecycle rule that deletes objects after 2 days (abandoned uploads). On `yowkly-backups`, delete after 30 days.
   - Create an **R2 API token** with Object Read & Write on those buckets. That gives you `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.
3. **Vercel** env vars (Production and Preview): `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_MEDIA_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_QUARANTINE`, `R2_BUCKET_FILES`, `R2_BUCKET_MEDIA`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, and `NEXT_PUBLIC_CONTACT_EMAIL` (the address shown on the Privacy, Terms and Copyright pages). Then turn on **Analytics** in the Vercel project (Web Analytics is cookie-free and free on Hobby; the `<Analytics />` tag is already in the layout). Without the R2 and Upstash values, uploads, downloads and every signed-in action fail in production. **Do not** put the Supabase service-role key or the database connection string in Vercel: the web app doesn't use either.
4. **GitHub → Settings → Secrets → Actions** (for the scan worker and backups): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (the **Session pooler** string from Supabase → Connect; the direct one is IPv6-only on Free and GitHub can't reach it), `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_QUARANTINE`, `R2_BUCKET_FILES`, `R2_BUCKET_BACKUPS`.
5. **Scan worker:** `scan.yml` runs on GitHub Actions. Uploads start it straight away, so files are usually clean in about 2 minutes, and an hourly run catches anything missed.
   - **Start-on-upload token:** GitHub → Settings (your account) → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate. Repository access: only `Yowkly`. Permissions: **Actions: Read and write**. Put it in Vercel as `GITHUB_SCAN_TOKEN` (Secret) and redeploy. Without it, uploads wait for the hourly run.
   - **Cost:** each run first asks Supabase whether anything is waiting and stops in seconds if not, and the worker image and virus database are cached. A private repo uses roughly 750 minutes a month idle plus ~1–2 minutes per upload, inside the 2,000 free minutes.
   - **Never stuck:** a file whose scan crashes 3 times is rejected with "upload it again" and the creator is notified.
   - For instant scans without GitHub, run `worker/Dockerfile` on an always-free VM such as Oracle Cloud's (≥ 2 GB RAM; ClamAV needs about 1.2 GB). Verify with the EICAR test file (section 5).
6. **Domain:** add it in Vercel. HTTPS is automatic, and HSTS is sent by `next.config.ts`.
7. **Make yourself admin** (SQL editor, after signing up on the live site):
   ```sql
   insert into user_roles (user_id, role) select id, 'admin' from auth.users where email = '<you>';
   ```

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

| What | How | Retention |
|---|---|---|
| Postgres (public + auth schemas) | `backup.yml`: nightly `pg_dump` to R2 `yowkly-backups/db/` | 30 days (R2 lifecycle rule) |
| Uploaded files and images | Stored in R2 (designed for 11 nines of durability); no second copy yet | — |
| Code and migrations | GitHub | forever |

**Restore drill (do this once before launch, then quarterly):**

1. Download the newest `.dump` from R2 (`yowkly-backups/db/`).
2. Create a scratch Supabase project, `yowkly-restore-test`, and restore into it:
   ```bash
   pg_restore --no-owner --no-privileges --dbname "<scratch session-pooler URL>" yowkly-<date>.dump
   ```
3. Point a local `.env.local` at the scratch project, run `npm run dev`, and check that templates, profiles and votes are all there.
4. Write the date, duration and any surprises into the table below, then delete the scratch project.

| Date | Restored from | Duration | Notes |
|---|---|---|---|
| _not yet run_ | | | |

**Rollback:** Vercel → Deployments → promote the previous deployment (instant). Database migrations are forward-only: write a new migration that reverts, and never edit an applied one.

## 5. Security checks after every deploy

- Upload the [EICAR test file](https://www.eicar.org/download-anti-malware-testfile/) zipped. It must end up `infected` and never be downloadable.
- Signed out, `POST /api/download` must return 401. Signed in, a random file id must return 404.
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
