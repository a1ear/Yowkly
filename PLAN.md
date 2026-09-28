# Yowkly — Product & System Architecture Plan

> A community showcase where developers and designers publish web templates,
> app designs and UI kits. The community likes, votes and downloads them, and the
> best ones earn awards. Think Awwwards, except every entry can be downloaded and
> remixed.

Status: **Plan v1 (pre-build)** · Stack: **Next.js + Supabase (Postgres, Auth, Storage)** · Date: 2026-09-27

---

## 0. Name

**Final: Yowkly** (by NightPatch). Tagline: *"For Devs by Devs."* (was "Where templates get their shot.")

- Two syllables, spelled the way it sounds, and easy to repeat after hearing it once.
- A coined word, so it can be owned as a brand: a web search (2026-09-28) found no product, company or app using it.
- Domains: yowkly.com, .co, .app, .design, .dev, .io and .gallery all had no nameservers on 2026-09-28. **Register yowkly.com first.**
- Still to do before launch: a trademark search at IPOPHL and USPTO (software and online-services classes).

Names considered and rejected during naming (conflicts found): Nightly, Varia, Kittly, Owwwly, Nightjar, Kuwago, Tyto, Strix, Otus.

---

## 1. Requirements

### 1.1 Your objectives (all included)

| # | Objective | Where it lands |
|---|---|---|
| 1 | Upload web templates and designs (Awwwards-style) | §4 Upload pipeline |
| 2 | Catchy name | §0 |
| 3 | System architecture with a backend | §2, §3 |
| 4 | Upload **and** download | §4, §5 |
| 5 | Categories (templates, app designs, etc.) | §3.3 taxonomy |
| 6 | Mobile app design templates | Category and device-aware previews |
| 7 | User accounts: profiles, templates, uploads | §3, §6 |
| 8 | Like **and** voting system | §7 |
| 9 | For You page | §8 |
| 10 | Upload from Canva, Photoshop, Figma, etc. | §4.2 source-format matrix |

### 1.2 Requirements I added (to make it usable, safe and something people return to)

**Must-have for launch (MVP)**
1. **Licenses per template** (MIT, CC BY 4.0, CC BY-NC 4.0, Personal-use-only, Custom). The license is snapshotted onto each version. Without licenses a download site is a legal liability.
2. **Versioning.** Creators ship v1.1 without breaking v1.0. Published versions are immutable.
3. **Malware scanning and quarantine** on every uploaded file. The site hands strangers files, so this is the #1 risk.
4. **Live preview.** External demo URL in a sandboxed iframe with a desktop/tablet/mobile toggle.
5. **Search and filters:** category, tech stack, source tool, license, free, sort (Trending / Newest / Top voted / Most downloaded).
6. **Collections.** Save templates into named boards, public or private.
7. **Follow creators**, which feeds the For You page and notifications.
8. **Comments** with report and delete.
9. **Notifications** (in-app, plus an email digest): new follower, likes and votes milestones, comments, award won, upload approved or rejected.
10. **Reporting and a moderation queue**, with a trust-level review for new uploaders.
11. **Creator dashboard:** drafts, scan status, per-template views, downloads, likes and votes over time.
12. **Awards:** Template of the Day, Week and Month, computed from votes. This is the reason to keep coming back.
13. **Onboarding interests** (pick categories and stacks) so the For You page works on day one.
14. **Account deletion and data export.** Privacy law requires it, and it is the decent thing to do.
15. **DMCA / takedown flow**, plus an "I own the rights to this work" confirmation at upload.

**Phase 2**
- Figma and Canva account integrations (import a file and its thumbnail through their APIs)
- Hosted live previews of uploaded HTML zips, served on a **separate sandbox domain**
- "Inspired by / Remix of" lineage between templates
- Semantic similarity with pgvector for "More like this" and a better For You page
- Jury role: invited experts whose votes carry more weight in awards (Awwwards model)
- "Available for hire" profiles and a contact button

**Phase 3 (deliberately out of scope for now)**
- **Paid templates / marketplace.** This means Stripe Connect, tax, refunds, disputes and payouts. It is a product of its own. The schema leaves room for it (`price_cents` on versions stays null) but no payment code gets written until the free platform has users.

---

## 2. System architecture

### 2.1 Stack (boring on purpose)

| Concern | Choice | Why |
|---|---|---|
| Web app | **Next.js 15 (App Router) + TypeScript** | SSR/ISR for SEO on template pages. Server Actions and Route Handlers give us a real server layer. |
| Styling | Tailwind CSS + Radix primitives (shadcn/ui) | Accessible primitives, so we don't rebuild dialogs and menus |
| Hosting | **Vercel** | Edge CDN, preview deploys per PR, firewall/WAF |
| Database | **Supabase Postgres** | RLS, triggers, pg_cron, full-text search, pgmq queues |
| Auth | **Supabase Auth** | Email+password, magic link, **GitHub** and Google OAuth, Turnstile CAPTCHA |
| File storage | **Supabase Storage** (S3-compatible, CDN) | Resumable (TUS) uploads, signed URLs, image transforms |
| Background jobs | **Supabase Queues (pgmq) + pg_cron** | Scan, thumbnail and feed-refresh jobs without a new service |
| Scan worker | **Small Docker worker on Fly.io** running ClamAV + the zip inspector | Edge Functions cannot run ClamAV. One small machine is enough. |
| Rate limiting | **Upstash Redis** (`@upstash/ratelimit`) + DB-level caps | Supabase has no per-endpoint limiter for our routes |
| Email | **Resend** (transactional + digest) | Also configured as Supabase Auth SMTP |
| Errors / logs | **Sentry** (client + server + worker), Supabase logs, Better Stack uptime | "Production does not run on console.log" |
| Validation | **Zod**, with schemas shared by client and server | Same rules on both sides. The server is the one that counts. |

### 2.2 Diagram

```
                          ┌──────────────────────────────────────────┐
  Browser / Mobile web ──►│  Vercel Edge (CDN, WAF, ISR cache)       │
                          └───────────────┬──────────────────────────┘
                                          │
                          ┌───────────────▼──────────────────────────┐
                          │  Next.js server                          │
                          │  • RSC pages (reads via user JWT + RLS)  │
                          │  • Server Actions / Route Handlers:      │
                          │    zod validate → rate-limit → RLS write │
                          │  • /api/download → signed URL (60s)      │
                          └──┬──────────────┬───────────────┬────────┘
                   Upstash   │              │               │ Sentry
                   Redis ◄───┘              │               └──────►
                   (rate limit, view dedupe)│
                          ┌─────────────────▼────────────────────────┐
                          │  Supabase                                │
                          │  ┌──────────┐ ┌──────────┐ ┌───────────┐ │
                          │  │ Auth     │ │ Postgres │ │ Storage   │ │
                          │  │ (JWT)    │ │ RLS,     │ │ quarantine│ │
                          │  │ GitHub,  │ │ triggers,│ │ files(priv)│ │
                          │  │ Google   │ │ pg_cron, │ │ media(pub)│ │
                          │  └──────────┘ │ pgmq     │ └─────▲─────┘ │
                          │               └────┬─────┘       │       │
                          └────────────────────┼─────────────┼───────┘
                                               │ poll queue  │ move clean files
                                     ┌─────────▼─────────────┴──┐
                                     │ Scan worker (Fly.io)     │
                                     │ ClamAV • zip inspector • │
                                     │ image re-encode (sharp)  │
                                     └──────────────────────────┘
          Nightly: Storage buckets ──► Cloudflare R2 backup (Storage is NOT in DB backups)
```

### 2.3 Data access rules

- **Reads:** Server Components query Supabase **with the user's JWT**, so RLS applies. Public pages use the anon role and ISR caching.
- **Writes:** these always go through a Server Action or Route Handler: **Zod validate → rate limit → Supabase call with the user's JWT**. RLS is the final fence. The action is a courtesy layer, not the permission.
- **Service role key:** only the scan worker and cron jobs hold it. It is never in the Next.js client bundle, and never in a Server Action that echoes user input into a query.
- **Counters** (`like_count`, `download_count`, etc.) are maintained by `SECURITY DEFINER` triggers. Clients have **no UPDATE privilege** on those columns (column-level `REVOKE`).
- **Roles** live in a `user_roles` table, checked by a `has_role(uid, role)` SQL function. They are **never** in `user_metadata`, because the user can edit that field.

---

## 3. Data model (Postgres)

### 3.1 Core tables

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | `id` (= auth.users.id), `username` (unique, citext), `display_name`, `bio`, `avatar_path`, `banner_path`, `website`, `github`, `twitter`, `location`, `skills text[]`, `available_for_hire`, `trust_level` (0–3), `created_at`, `deleted_at` | Created by a trigger on signup. Username is regex-validated with a reserved-word list (admin, api, settings…). |
| `user_roles` | `user_id`, `role` (`moderator`/`admin`/`juror`) | Only admins can write. Checked in RLS. |
| `user_interests` | `user_id`, `category_id` / `tag_id` | From onboarding. Seeds the For You page. |
| `categories` | `id`, `slug`, `name`, `parent_id`, `kind` (`web`/`mobile`/`kit`/`concept`) | Seeded. Admin-managed. |
| `tags` | `id`, `slug`, `name`, `type` (`stack`/`style`/`industry`/`tool`) | e.g. `react`, `tailwind`, `minimal`, `fintech`, `figma` |
| `licenses` | `code`, `name`, `url`, `allows_commercial`, `requires_attribution` | Seeded. Read-only. |
| `templates` | `id`, `owner_id`, `slug`, `title`, `tagline`, `description` (markdown, sanitized), `category_id`, `status` (`draft`/`pending_review`/`published`/`unlisted`/`removed`), `demo_url`, `source_url` (GitHub/Figma/Canva link), `cover_path`, `current_version_id`, counters (`like_count`, `vote_count`, `vote_avg`, `download_count`, `view_count`, `comment_count`), `hot_score`, `published_at`, `search_tsv` (generated), `created_at`, `updated_at` | Owners can edit metadata. **Only RPCs** change `status`. |
| `template_tags` | `template_id`, `tag_id` | Max 10 tags (trigger). |
| `template_media` | `id`, `template_id`, `path`, `kind` (`cover`/`gallery`/`mobile_screen`), `device` (`desktop`/`tablet`/`mobile`), `width`, `height`, `alt_text` (required), `sort` | Public bucket. Images are re-encoded to WebP by the worker. |
| `template_versions` | `id`, `template_id`, `version` (semver text), `changelog`, `license_code` (**snapshot**), `price_cents` (null, reserved), `status` (`draft`/`published`/`yanked`), `published_at` | **Immutable once published** (a trigger blocks UPDATE except `status → yanked`). |
| `template_files` | `id`, `version_id`, `storage_path`, `original_name`, `mime`, `size_bytes`, `sha256`, `source_tool` (`code`/`figma`/`psd`/`canva`/`sketch`/`xd`/`ai`/`penpot`/`pdf`), `scan_status` (`pending`/`scanning`/`clean`/`infected`/`rejected`), `scan_report jsonb`, `manifest jsonb` (zip file listing) | Downloads are allowed **only** when `scan_status = 'clean'`. |

### 3.2 Social and engagement

| Table | Key columns | Notes |
|---|---|---|
| `likes` | `user_id`, `template_id`, `created_at` | PK (user, template). Toggle. |
| `votes` | `user_id`, `template_id`, `created_at` | PK (user, template). Final: no update/delete for clients; cast only through `cast_vote()`, which spends 1 yowkbit. |
| `yowkbit_wallets` / `yowkbit_ledger` | balance (CHECK ≥ 0) / append-only `delta`, `reason`, `template_id` | Own rows readable; written only by triggers and `cast_vote()`. |
| `follows` | `follower_id`, `followee_id` | CHECK follower ≠ followee. |
| `collections` / `collection_items` | `id`, `owner_id`, `name`, `is_public` / `collection_id`, `template_id`, `note` | Private collections are visible to their owner only (RLS). |
| `comments` | `id`, `template_id`, `author_id`, `parent_id` (one level of replies), `body` (≤ 2000 chars), `deleted_at` | Soft-delete keeps threads intact. |
| `downloads` | `id`, `user_id` (nullable after account deletion), `template_id`, `version_id`, `file_id`, `license_code` (**snapshot**), `created_at` | Append-only. Records exactly what license the user got the file under. |
| `template_view_daily` | `template_id`, `day`, `views` | Aggregated upserts via RPC. **No raw IPs are stored.** Dedupe happens in Redis for 24h. |
| `notifications` | `id`, `user_id`, `type`, `actor_id`, `template_id`, `data jsonb`, `read_at` | Created by triggers. |
| `awards` / `dev_awards` | `template_id` or `user_id`, `period`/`week_start`, vote-count snapshots (`period_votes`) | Immutable. Counts are snapshotted when the winner is picked. |
| `reports` | `id`, `reporter_id`, `target_type`, `target_id`, `reason`, `details`, `status`, `resolved_by` | |
| `moderation_log` | `id`, `actor_id`, `action`, `target_type`, `target_id`, `reason`, `created_at` | **Append-only audit trail.** No UPDATE or DELETE for anyone. |
| `user_affinity` | `user_id`, `tag_id`/`category_id`, `weight` | Maintained by triggers and cron. Feeds For You. |

### 3.3 Taxonomy (seed)

- **Websites:** Landing page · SaaS · Portfolio · Agency · E-commerce · Blog / Editorial · Dashboard / Admin · Docs · Event · Restaurant · Real estate · Personal
- **Mobile app designs:** iOS · Android · Cross-platform, with sub-types Finance · Health · Social · Travel · Food · Productivity · E-commerce
- **UI kits and design systems:** Component libraries · Design systems · Icon sets · Wireframe kits
- **Components:** Navbars · Heroes · Pricing · Forms · Footers · Cards · Charts
- **Other:** Presentation / pitch decks · Web app concepts (idea showcases, which don't need a downloadable file)
- **Tags:** stack (HTML/CSS, React, Next.js, Vue, Svelte, Astro, Tailwind, Flutter, SwiftUI, React Native, Webflow, Framer), tool (Figma, Photoshop, Canva, Sketch, Illustrator, Penpot, XD), style (Minimal, Brutalist, Glassmorphism, Dark, Editorial, 3D, Retro)

### 3.4 Indexes (set these before the data grows)

- `templates (status, published_at desc)`, `templates (status, hot_score desc)`, `templates (category_id, status, hot_score desc)`, `templates (owner_id)`
- GIN on `templates.search_tsv`, plus GIN `pg_trgm` on `title` for typo-tolerant search
- `template_tags (tag_id, template_id)`, `likes (template_id)`, `votes (template_id)`, `follows (followee_id)`, `downloads (template_id, created_at)`, `notifications (user_id, read_at, created_at desc)`

### 3.5 Row Level Security (summary)

RLS is enabled on **every** table, and the default is deny.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| profiles | everyone (not `deleted_at`) | trigger only | self (not `trust_level`) | — (use the deletion RPC) |
| templates | published/unlisted: everyone · otherwise: owner, mods | owner = auth.uid() | owner: metadata columns only | owner if `status='draft'`, else mods |
| template_versions / files | if the parent template is visible to you | owner of the template | owner while `draft` only | owner while `draft` only |
| likes / follows | everyone | `user_id = auth.uid()` | — | self |
| votes | aggregate only through a view; raw rows: self + admins | self, **not own template**, email verified, account ≥ 7 days old | self | self |
| collections | public or owner | owner | owner | owner |
| comments | everyone (visible template) | self, verified email | self, within 15 min | self (soft), mods |
| downloads | self, template owner (aggregate view), admins | **server route only** (service RPC) | — | — |
| reports | reporter + mods | self | mods | — |
| moderation_log | mods | mods (via RPC) | **nobody** | **nobody** |
| user_roles | self, admins | admins | admins | admins |

**The acceptance test for this schema** (automated with pgTAP): *can user A read, update or delete anything of user B's that isn't public?* It must be **no** for every table, including through RPCs.

Storage policies:
- `quarantine` (private): a user may INSERT only under `{auth.uid()}/…`. **Nobody** may SELECT except the service role.
- `template-files` (private): no direct access for anyone. Only the service role and signed URLs.
- `media` (public read): INSERT under `{auth.uid()}/…`, images only, ≤ 10 MB.
- `avatars` (public read): INSERT/UPDATE under `{auth.uid()}/…`, images only, ≤ 2 MB.

---

## 4. Upload pipeline

### 4.1 Flow

```
1. Create draft        Server Action → templates(status=draft) + template_versions(draft)
2. Request upload URL  Server Action: zod(name, size, declared type) + rate limit
                       → allowlist extension check → createSignedUploadUrl(
                         quarantine/{uid}/{template}/{version}/{uuid}.{ext})
3. Upload              Browser → Storage directly (TUS resumable for files > 6 MB,
                       progress bar, pause/resume)
4. Finalize            Server Action: object exists? size matches? → template_files
                       (scan_status=pending) → enqueue pgmq 'scan'
5. Scan (worker)       • magic-byte check (the real type must match the extension)
                       • ClamAV scan
                       • zip: reject bombs (> 500 MB unpacked, > 5,000 entries,
                         ratio > 100:1), path traversal (../), symlinks, and
                         executables (.exe .dll .bat .cmd .sh .ps1 .msi .jar .scr .app .apk…)
                       • build manifest (file tree shown on the detail page)
                       • sha256
                       clean → copy to template-files/, scan_status=clean, delete from quarantine
                       dirty → scan_status=infected|rejected, notify owner, log
6. Media               Cover + gallery → worker re-encodes to WebP (strips EXIF/GPS)
7. Publish (RPC)       Checks: title, category, license, ≥1 cover with alt text,
                       ≥1 clean file OR a valid source/demo link, owns everything.
                       trust_level 0 → pending_review (mod queue)
                       trust_level ≥1 → published
```

Trust levels: 0 = new (the first 2 publishes are reviewed) · 1 = established (auto-publish) · 2 = featured creator · 3 = staff. Levels are promoted automatically after clean publishes. Moderators can demote.

### 4.2 Source-format matrix (Canva, Photoshop, Figma, …)

| Tool | How it gets on Yowkly (MVP) | Preview | Phase 2 |
|---|---|---|---|
| **Code** (HTML/CSS/JS, React, etc.) | `.zip` upload and/or GitHub repo link | Demo URL in a sandboxed iframe + screenshots | Hosted preview on the sandbox domain |
| **Figma** | `.fig` upload **or** Figma file / Community link | Creator screenshots. The link opens in Figma. | Figma OAuth: import frames as thumbnails through the REST API |
| **Photoshop** | `.psd` upload (≤ 200 MB) | Creator screenshots (required) | Server-side PSD thumbnail |
| **Canva** | **Canva template link** (Canva has no editable file export). Optional PDF/PNG export upload | Screenshots | Canva Connect API integration |
| **Illustrator** | `.ai` / `.svg` / `.pdf` | Screenshots | |
| **Sketch** | `.sketch` | Screenshots | |
| **Adobe XD** | `.xd` | Screenshots | |
| **Penpot** | `.penpot` | Screenshots | |
| **Framer / Webflow** | Remix link / cloneable link | Demo URL | |

- Links are validated against an **allowlist of hosts** (`github.com`, `figma.com`, `canva.com`, `framer.com`, `webflow.com`, `penpot.app`, plus any `https` demo URL) and stored normalized. They are always rendered with `rel="noopener noreferrer nofollow ugc"`.
- Size limits: 200 MB per file, 5 files per version, 1 GB per user for MVP. The Supabase **Pro** plan is required to raise the 50 MB free-tier limit.

---

## 5. Download flow

```
GET /api/templates/{id}/download?file={fileId}
  1. Require login (it gives a real rate-limit identity, stops scraping, and
     lets the creator see download stats)
  2. Rate limit: 30 downloads / hour / user, 200 / day
  3. Check: template visible, version published (not yanked), file scan_status = clean
  4. User has ticked "I accept the <license>" (first download per license)
  5. INSERT downloads (snapshot version_id + license_code)
  6. createSignedUrl(path, 60s, { download: "<slug>-v<version>.<ext>" }) → 302 redirect
```

- Signed URLs expire after 60 seconds, so a shared link dies quickly.
- The `download_count` trigger dedupes the same user + version within 24 hours.
- Link-only templates (Canva, Figma) go through a `/go/{id}` redirect that logs the click, so they count the same way.

---

## 6. User accounts and profiles

- **Sign up / in:** GitHub (the main path for developers), Google, and email + password or magic link. Turnstile CAPTCHA on signup. Email verification is required before uploading, voting or commenting. Leaked-password protection is on.
- **Onboarding:** username → avatar → choose 3+ interests (categories and stacks) → suggested creators to follow.
- **Public profile `/@username`:** banner, avatar, bio, links, skills, "available for hire" badge, stats (templates, total downloads, likes received, awards). Tabs: **Templates · Collections · Liked · Awards · About**.
- **Creator dashboard `/dashboard`:** drafts, uploads with scan status, pending review, per-template charts (views, downloads, likes, votes over 7/30/90 days), version management.
- **Settings:** profile, account (email, password, linked providers), notifications (in-app and email digest toggles), privacy (hide liked tab), **export my data (JSON)**, **delete account**. Deletion is soft-delete + unpublish now and a hard purge after 30 days by cron. Download logs keep `version_id` with `user_id` set to null.

---

## 7. Likes, votes and yowkbits

The two systems are deliberately separate. *(Revised 2026-09-28: the 1–10 multi-criteria rating was replaced by yowkbit votes.)*

| | **Like** ❤ | **Vote** ⬡ |
|---|---|---|
| Purpose | Quick appreciation, saves to your Liked tab | A deliberate pick that drives the **Ranking** |
| Cost | Free, unlimited, undoable | **1 yowkbit**. Every account gets **100 yowkbits** at sign-up |
| Limit | One per template (toggle) | One per template, **final** (no edits, no refunds) |
| Who | Any verified user | Verified email, account ≥ 24 hours old, not the owner, balance ≥ 1 |
| Shown as | Count | Count |

**Ledger, not a counter.** `yowkbit_wallets.balance` has `CHECK (balance >= 0)` so overspending is impossible even under concurrent requests; every change is also written to the append-only `yowkbit_ledger` (`signup_grant +100`, `vote −1`), so a balance can always be explained. Clients can read their own wallet and ledger and nothing else; the only way to spend is `cast_vote()`, which locks the wallet, re-checks eligibility, inserts the vote, debits 1 and writes the ledger row in one transaction.

**Anti-gaming**
- One vote per (user, template) (primary key). Self-votes, unverified and brand-new accounts are refused inside `cast_vote`.
- Rate limit: 60 likes / 10 min, 30 votes / hour (edge + database).
- Raw votes are private to the voter; the public sees counts. Live standings are aggregate-only functions (`ranking_templates`, `ranking_devs`).
- Scarcity is the main defence: a throwaway account has at most 100 votes and can use only one per template.

**Ranking (pg_cron, UTC)**
- **Template of the Day / Week / Month:** most votes *received during* that day / ISO week / month (minimum 3 / 5 / 10). Ties go to whoever reached the count first. A template can take each spot once; the mobile-apps category also gets a weekly pick.
- **Dev of the Week:** Monday 00:06 UTC, the creator whose published templates received the most votes that week (minimum 5), stored in `dev_awards`.
- Winners are immutable rows that snapshot the vote counts. The winner gets a badge, a profile stat and a notification.

---

## 8. For You feed

**v1: rule-based, runs in Postgres, fully explainable**

```
score(t, u) = 0.35 · affinity(u, t.tags ∪ t.category)   -- from likes/downloads/votes/interests
            + 0.25 · follows(u, t.owner)                  -- 1 if followed, else 0
            + 0.25 · normalized(t.hot_score)              -- community trending
            + 0.15 · freshness(t.published_at)            -- exponential decay, 3-day half-life
```

- `hot_score` is refreshed every 15 min by pg_cron: `(likes + 2·votes + 3·downloads_7d + views_7d/20) / (age_hours + 2)^1.5`
- `user_affinity` is updated by triggers: like +1, vote +2, download +3, onboarding interest +2. It decays 10% weekly.
- Exclusions: own templates, already liked or downloaded, removed or yanked.
- **Diversity:** at most 2 templates per creator per page of 24, and at most 40% from a single category.
- **Exploration:** 10% of slots are random well-rated templates outside the user's affinity, so the feed doesn't become an echo chamber.
- **Cold start:** onboarding interests + global trending. Logged-out users see Trending.
- Implemented as `for_you(cursor)` RPC (`SECURITY INVOKER`, keyset pagination).
- Each card gets a small "Why am I seeing this?" note ("Because you follow Ana", "Popular in React"). It builds trust and helps debugging.

**Phase 2:** pgvector embeddings of title + description + tags for "More like this" and the similarity term.

---

## 9. The 13-layer audit

| # | Layer | Scope decision |
|---|---|---|
| 1 | **Frontend** | ✅ IN. Every screen has loading (skeletons), empty and error states. Upload has progress, pause/resume and failure retry. Scan status is shown live. |
| 2 | **Backend & APIs** | ✅ IN. Server Actions + Route Handlers, Zod validation on everything, RPCs for state transitions (publish, moderate, delete account). The client is never trusted. |
| 3 | **Database & Storage** | ✅ IN. Schema in §3 with CHECK constraints, unique keys, FKs, indexes, immutable versions and awards, append-only logs. 4 buckets with split trust. |
| 4 | **Auth & Permissions** | ✅ IN. Supabase Auth, verified email gates, `user_roles` + `has_role()`, and trust levels. A hidden button is never the permission. |
| 5 | **Hosting & Deploy** | ✅ IN. Vercel + Supabase Pro, real domain, HTTPS, separate staging and production projects. |
| 6 | **Cloud & Compute** | ✅ IN, **minimal**. One Fly.io machine for the scan worker. No Kubernetes, no microservices. |
| 7 | **CI/CD & Version Control** | ✅ IN. GitHub. Actions run lint, typecheck, Vitest, **pgTAP RLS tests**, Playwright e2e. Supabase migrations via CLI. Vercel preview per PR + Supabase branching. `main` deploys to production. |
| 8 | **Security & RLS** | ✅ IN, **critical**. RLS on every table, storage policies, malware quarantine, CSP headers, sandboxed iframes (`sandbox="allow-scripts allow-same-origin"` is **never** combined with our own origin), sanitized markdown, allowlisted links, no service key on the client. |
| 9 | **Rate Limiting** | ✅ IN. Upstash on sign-up, upload URL, finalize, download, like, vote, comment, report and search. DB caps: 10 drafts/day, 5 files/version. |
| 10 | **Caching & CDN** | ✅ IN. ISR for template, profile and category pages (revalidate on publish or update). Storage CDN + image transforms for media. Trending is precomputed. |
| 11 | **Scaling** | 📝 **Planned, not built.** The known pressure points are listed in §11. Nothing is sharded or given a separate search engine until metrics say so. |
| 12 | **Monitoring & Logs** | ✅ IN. Sentry across web, server and worker. Better Stack uptime on `/api/health`. Alerts on scan queue depth > 50, scan failures, and 5xx rate. |
| 13 | **Availability & Recovery** | ✅ IN. Supabase daily backups + **PITR**. **A nightly Storage → Cloudflare R2 sync** (Supabase DB backups do *not* include Storage files). A documented restore drill **run once before launch**. Vercel instant rollback. |

---

## 10. Security threat checklist

| Threat | Defence |
|---|---|
| Malware in uploads | Quarantine bucket, ClamAV, executable blocklist, magic bytes, zip bomb limits, downloads only when `clean` |
| XSS through descriptions or comments | Markdown rendered server-side with an allowlist sanitizer (no raw HTML), strict CSP |
| XSS through demo previews | External URLs only, in a sandboxed iframe. Hosted previews (phase 2) only on a **separate registrable domain** |
| IDOR (reaching another user's drafts or files) | RLS + storage path policies + pgTAP tests that try it |
| Privilege escalation | Roles in `user_roles`, never `user_metadata`. Column-level REVOKE on status, counters and trust level. |
| Vote and like manipulation | Unique constraints, age gate, rate limits, Bayesian ranking, anomaly flagging |
| Hotlinking or scraping downloads | Login required, 60s signed URLs, rate limits |
| Copyright theft (re-uploading someone's template) | Ownership attestation, sha256 duplicate detection against existing files, report + DMCA flow, moderator takedown with audit log |
| Open redirects via `/go/{id}` | Redirect only to the stored, validated URL of that template, never to a query parameter |
| Spam accounts | Turnstile, email verification, trust level 0 review queue |
| SQL injection | Parameterized Supabase client and RPCs only. No string-built SQL. |

---

## 11. Scaling — where it goes when traffic arrives

1. **View tracking write load**: move to batched inserts from Redis every minute.
2. **Storage egress costs** (downloads are the big line item): move `template-files` to **Cloudflare R2** (zero egress). The signed-URL flow stays the same.
3. **Search**: if Postgres FTS + trigram stops being enough, move to Meilisearch or Typesense, kept in sync from a queue.
4. **Feed**: precompute per-user For You candidate lists nightly and re-rank at request time.
5. **Scan throughput**: add Fly.io machines. The queue already decouples them.
6. **Read load**: Supabase read replicas for public queries.

---

## 12. Routes and pages

| Route | Page |
|---|---|
| `/` | Home: hero, Template of the Day, Trending, New, categories, top creators |
| `/for-you` | Personalized feed (requires login) |
| `/explore` | Browse all with filters and sort |
| `/c/[category]` | Category page (with subcategory chips) |
| `/search?q=` | Search results + filters |
| `/t/[slug]` | Template detail |
| `/t/[slug]/v/[version]` | A specific version |
| `/ranking` | Live weekly standings, Dev of the Week, Day / Week / Month winners (`/awards` redirects here) |
| `/@[username]` | Public profile |
| `/collections/[id]` | Collection |
| `/upload` | Upload wizard (new template) |
| `/dashboard` · `/dashboard/templates/[id]` | Creator dashboard + analytics + versions |
| `/notifications` | Notifications |
| `/settings/*` | Profile, account, notifications, privacy, danger zone |
| `/auth/*` · `/onboarding` | Sign in / up, verify, reset, onboarding |
| `/admin/*` | Moderation queue, reports, users, categories, audit log (role-gated on the **server**) |
| `/legal/*` | Terms, Privacy, Licenses explained, DMCA |
| `404`, `500` | Real error pages |

---

## 13. Build order (following the 15-step workflow)

| Milestone | Contents | Done when |
|---|---|---|
| **M0 Foundation** | Repo, CI, Supabase projects (staging/prod), migrations, seed data, Sentry | CI green, a migration applied to staging |
| **M1 Accounts** | Auth (GitHub/Google/email), profiles, onboarding, settings | RLS tests pass for profiles |
| **M2 The boring core** | Templates CRUD, versions, **upload pipeline + scan worker**, **download flow**, licenses | Can publish and download a zip end-to-end. An EICAR test file gets rejected. |
| **M3 Discovery** | Home, explore, categories, search, template detail, ISR | Lighthouse ≥ 90 on detail pages |
| **M4 Social** | Likes, votes, follows, collections, comments, notifications | Abuse tests pass (self-vote, double vote, rate limits) |
| **M5 Ranking** | hot_score cron, awards cron, For You RPC | Feed is correct for seeded test personas |
| **M6 Trust & safety** | Reports, moderation queue, trust levels, admin, audit log, DMCA | A moderator can remove content and it shows in the log |
| **M7 Launch hardening** | SEO (OG images, sitemap, JSON-LD), a11y pass, perf pass, backups + **restore drill**, legal pages | All 7 gates pass against **production** |

---

## 14. The 7 gates (launch checklist)

1. **Functional:** every CRUD path works (templates, versions, files, collections, comments, likes, votes, follows, reports), upload/download works end-to-end, account deletion works.
2. **Security:** pgTAP cross-user tests, try IDOR on drafts and quarantine files, self-vote, tampered `status`/counter columns, EICAR upload, zip bomb, path traversal zip, a `javascript:` demo URL, XSS in markdown, a spammed endpoint.
3. **Responsive:** 360 / 768 / 1024 / 1440 / 1920 px. Mobile bottom nav. The upload wizard works on a phone.
4. **SEO & Web:** per-template title/meta, dynamic OG image, `sitemap.xml`, `robots.txt`, JSON-LD (`CreativeWork`), a required alt text field, a real 404.
5. **Performance:** measure first. Image sizes via transforms, bundle budget, `EXPLAIN ANALYZE` on feed/search, then cache.
6. **Accessibility:** keyboard-only upload and voting, visible focus, AA contrast, labelled inputs, sliders with ARIA values, `prefers-reduced-motion`.
7. **Production:** real domain, HTTPS, production Supabase, env vars set, Sentry receiving events, uptime monitor, and **a backup that has been restored once**.

---

## 15. Decisions log (build phase, 2026-09-28)

### From the design review (Claude Design canvas vs. this plan)
| # | Design showed | Decision |
|---|---|---|
| 1 | One "Download · 52.2 MB" button bundling every file | **Per-file downloads.** Each file gets its own signed URL, so there's no server-side zipping. |
| 2 | "Open in Canva" on a Figma+ZIP template | Link buttons render **only for link kinds the template actually has**. |
| 3 | Dashboard offered Edit / New version / Unlist on every row, including Removed | **Actions per status**: exactly what the server will accept. |
| 4 | Same template winning Template of the Day repeatedly | **A template wins each award kind once** (unique constraint). |
| 5 | "Mobile Design of the Week" | Added **category-scoped awards** (`awards.category_id`). |
| 6 | Upload limit "500 MB each" | Kept **200 MB** (cost and scan time). |
| 7 | "Link verified" (implies fetching user URLs server-side = SSRF risk) | **Host allowlist + format check** only, enforced in the DB. No server fetches of user URLs. |
| 8 | "This collection is private. Ask her for a share link." | Private collections **404**, so their existence is never revealed. |
| 9 | Offline banner: "likes will sync when you reconnect" | **No offline mutation queue** in v1. |
| 10 | Mobile vote sliders pre-filled | Vote controls **start unset**; submit needs every criterion. |
| 11 | Yanked version with a reason | Added `yank_reason` (required). |
| 12 | "Honorable mentions" (undefined) | Defined as high-scoring templates from this week **without an award**. |
| 13 | "Free only" filter | Removed. Everything is free in v1. |
| 14 | "Markdown supported" in comments | Comments are **plain text**. Descriptions use a tiny safe subset with no HTML and no links. |

### From the scalability review (applied)
- Counters live in `template_stats`, not on `templates`, so hot templates don't rewrite the wide row.
- `refresh_hot_scores()` only touches the last 30 days.
- For You ranks a **capped candidate set** (≤ 400 + followed), not the whole catalogue.
- Public pages use a **cookie-less cached client** (Next fetch cache with tags). Personal state loads in the browser.
- RLS uses `(select auth.uid())`, and `owner_id` is denormalised onto child tables so policies need no joins.
- Result counts show "1,000+" past 1,000 and use estimated counts.
- Likes don't invalidate page caches.

### Other deviations from the original plan
- **Queue:** the `template_files` row *is* the queue (`FOR UPDATE SKIP LOCKED`, retry after 15 min, max 3 attempts), instead of pgmq. That's one less moving part.
- **Next.js 16** (not 15): `proxy.ts` replaces middleware, and `revalidateTag(tag, profile)` takes two arguments.
- **Moderation reject** returns the template to draft. The published-but-never-public version stays as history, and the creator publishes a fix as a new version.

### Free-tier architecture (2026-09-28)
Supabase Pro isn't affordable, so production runs at $0:
- **Uploaded files and images moved to Cloudflare R2** (10 GB free, free downloads, no 50 MB cap). Postgres still authorises every upload (`prepare_file_upload`, `prepare_media_upload`) and download (`begin_download`); the server only signs R2 links for paths the database approved. Upload links sign the exact size and type.
- **The web app no longer uses the Supabase service-role key.** Draft deletions go through owner-checked functions that return the R2 keys to delete.
- **Resumable (tus) uploads were dropped**: single signed uploads up to 200 MB. Multipart uploads can come back if large files often fail.
- **Backups:** nightly `pg_dump` to R2 from GitHub Actions (Supabase Free has none). **Scan worker:** GitHub Actions every 30 minutes, or an always-free VM.

### Yowkbits, Ranking and alpha prep (2026-09-28)
- **Likes and votes separated for real:** votes now cost yowkbits (100 at sign-up, 1 per vote, one per template, final). The 1–10 rating, the Bayesian award formula and juror weighting were removed; the Ranking counts votes received in the period. See §7.
- **Account age gate lowered from 7 days to 24 hours** so alpha testers can vote on day two; email verification + one vote per template + the 100-yowkbit cap carry the anti-abuse load.
- **"Awards" renamed "Ranking"** (`/awards` → `/ranking`, permanent redirect). Database names (`awards`, `grant_award`) stay; users never see them.
- **Dev of the Week** added (`dev_awards`, `grant_dev_of_week`, cron Monday 00:06 UTC).
- **Email category removed** (migration refuses to run if anything still uses it).
- **Demo seed data removed** for alpha: local and production both start empty.
- Tagline is now **"For Devs by Devs."** Header search collapses to an icon (⌘K / Ctrl+K opens it). CSS-only motion (page fades, scroll reveal, vote/like feedback), all disabled under `prefers-reduced-motion`.
- A vote uses `updateTag` (read-your-own-write), so the voter's next page load shows their vote immediately; likes still don't touch the cache.

## 16. Build status

**Verification level (2026-09-28):** code complete for the milestones marked ✅. Lint and typecheck are clean, and 37 automated tests pass (29 database attack tests on PGlite/Postgres 18, 8 hostile-archive tests). In a real browser, only the pages that need no database have been checked (sign-in, 404, legal, mobile nav), plus HTTP status codes and security headers. **Every data-backed page and flow still needs an end-to-end run against local Supabase** (Docker Desktop's engine would not start on the dev machine).

| Milestone | Status |
|---|---|
| M0 Foundation | ✅ Repo, migrations (9), seed, CI workflow, 37 automated tests |
| M1 Accounts | ✅ Email/password with verification, magic link, GitHub/Google OAuth, reset, onboarding, profile |
| M2 Core | ✅ Upload wizard (resumable), scan worker (ClamAV + archive checks), publish gate, per-file download, licenses, versions/yank |
| M3 Discovery | ✅ Home, Explore/filters/search, categories, template detail, awards, profiles |
| M4 Social | ✅ Likes, votes, follows, collections (save), comments, reports. ⏳ Notifications page, collection pages |
| M5 Ranking | ✅ Hot score, awards engine + cron, For You v1 |
| M6 Trust & safety | ✅ DB layer (moderation RPCs, audit log, trust levels). ⏳ `/admin` UI |
| M7 Launch hardening | ⏳ Settings page, Sentry, dynamic OG images, sitemap, a11y/perf pass on real data, backups + restore drill |
