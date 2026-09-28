# Claude Design prompt: Yowkly frontend

> Copy everything below the line into Claude Design.

---

Design the complete frontend UI for **Yowkly**, a community platform where developers and designers publish **web templates, mobile app designs, UI kits and web app concepts**. The community **likes**, **votes** and **downloads** them, and the best work wins daily, weekly and monthly awards. Think Awwwards crossed with Dribbble, except every entry comes with a downloadable file or a link to open it in Figma or Canva.

Tagline: **"For Devs by Devs."**

## Who uses it

1. **Creators.** Frontend developers and UI/UX designers who upload templates to build a reputation, get feedback and find clients.
2. **Browsers.** Developers, founders and students looking for a starting point for their next project. They browse, save, vote and download.
3. **Moderators.** A small team reviewing new uploads and reports.

Many users are on mid-range phones and slow connections, so mobile is a first-class layout.

## Design direction

- **The work is the hero and the UI recedes.** Template thumbnails should look like gallery pieces. Chrome, borders and decoration should be quiet.
- **Dark-first** (a near-black canvas, not pure #000) with a full **light theme**. Both must meet WCAG AA contrast.
- **One confident accent color** for primary actions, votes and award badges. I'm open to your choice. Avoid the generic indigo/purple SaaS gradient. A warm signal color (amber, coral, electric lime) against the dark canvas fits a "night studio" mood.
- **Editorial typography.** A characterful display face for headlines and award moments, a clean grotesk for UI, and a mono for version numbers, file names and tech tags.
- **Motion:** subtle and purposeful. Card hover lifts and reveals a quick-action row, the like has a satisfying micro-interaction, and the vote sliders feel tactile. Respect `prefers-reduced-motion`.
- No stock-photo people, no generic 3D blobs, no emoji-as-icons. Use one consistent line icon set.

## Global layout

- **Desktop:** top nav with the logo, Explore, For You, Awards, Categories (mega-menu), a large search field (⌘K opens a command palette), an **Upload** primary button, notifications bell and avatar menu.
- **Mobile:** a compact top bar (logo, search icon, bell) and a **bottom tab bar**: Home · Explore · Upload (center, emphasized) · For You · Profile.
- Footer: categories, Awards, Licenses explained, Terms, Privacy, DMCA, social links.

## Screens to design (desktop + mobile for each)

### 1. Home `/`
- Hero: **Template of the Day**, a full-bleed cover with title, creator, vote score and "View" / "Download" buttons, plus a countdown to the next award.
- Category chip row: Websites · Mobile Apps · UI Kits · Components · Presentations · Concepts
- Sections: **Trending now**, **Fresh this week**, **Top in Mobile App Designs**, **Rising creators** (creator cards with 3 mini thumbnails and a Follow button), **Honorable mentions**.
- For logged-out visitors: a sign-up band. "Publish your work. Get voted. Get hired."

### 2. Template card (the most important component, so design it with care)
- Cover image with aspect ratio by type: 16:10 for web, and a **phone frame / 9:19.5 tall** card for mobile app designs.
- Title, creator avatar + name, like count, vote average (★ 8.4), download count.
- **Source-tool badges:** Figma, Photoshop, Canva, Sketch, Code/ZIP, Framer, Webflow.
- Stack tags: React, Tailwind, Flutter…
- License pill: MIT / CC BY / Personal use.
- Award ribbon when it has won: "Template of the Day · Sep 26".
- Hover (desktop): quick actions Like, Save to collection, Preview. On mobile these live in a long-press / ⋯ sheet.
- States: loading skeleton, image failed, "Unlisted", "Pending review" (owner view only).
- Variants: grid card, compact list row, featured large card.

### 3. Explore `/explore` and Category `/c/[category]`
- Filter sidebar on desktop, a bottom-sheet filter drawer on mobile: Category, Subcategory, Tech stack, Source tool, License (commercial use allowed?), Style, Free only.
- Sort: Trending · Newest · Top voted · Most downloaded.
- Active filters shown as removable chips, with a result count.
- Masonry or uniform grid, and infinite scroll with a "Load more" fallback.
- Empty state for "No templates match these filters", with a clear-filters action.

### 4. For You `/for-you`
- A personalized feed of cards, each with a small "why" label ("Because you follow Mara Lin", "Popular in React", "Similar to what you liked").
- A tab switch: For You · Following.
- An empty or cold-start state that invites the user to pick interests.

### 5. Template detail `/t/[slug]` (the second most important screen)
- **Gallery:** a large cover, a thumbnail strip, and lightbox zoom. Mobile app designs show screens inside phone frames, scrollable horizontally.
- **Live preview:** a framed browser with a **Desktop / Tablet / Mobile toggle** and an "Open demo in new tab" link. Show a placeholder state when no demo URL exists.
- **Right column (sticky on desktop):**
  - Title, tagline, creator card (avatar, name, Follow button, "Available for hire" badge)
  - **Download panel:** version selector (v1.2.0 • latest), file list with sizes and type icons (`dashboard-kit-v1.2.0.zip — 14.2 MB`, `dashboard-kit.fig — 38 MB`), a license summary with "Commercial use ✓ / Attribution required ✓", a **Download** primary button, and "Open in Figma" / "Open in Canva" secondary buttons for link-based sources
  - Download states: logged out ("Sign in to download"), first download (a license acceptance checkbox), preparing, success, rate-limited, "File is being scanned", "Version yanked"
  - Like button + count, Save to collection, Share, Report (in a ⋯ menu)
- **Vote module:** four criteria sliders or segmented 1–10 controls: **Design · Usability · Creativity · Code quality** (Code quality is hidden for design-only files). Show the community average as a small radar or bar breakdown with the vote count. States: can vote, already voted (edit), not eligible ("Accounts can vote after 7 days"), own template, fewer than 5 votes ("Score appears after 5 votes").
- **Tabs below:** Overview (markdown description) · Files (a zip file-tree manifest) · Versions (changelog timeline) · Comments.
- **Comments:** threaded one level deep, with composer, edit, delete and report. Empty state.
- **More from this creator** and **Similar templates** rows.

### 6. Upload wizard `/upload` (multi-step, saves progress as a draft)
1. **Basics:** title, tagline, category → subcategory, tags (max 10, autocomplete), description (markdown editor with preview).
2. **Source:** choose one or more: *Upload files* (drag-and-drop zone that accepts .zip, .fig, .psd, .ai, .sketch, .xd, .penpot, .pdf) or *Add a link* (GitHub, Figma, Canva, Framer, Webflow, or a demo URL). Each file row shows an upload progress bar, pause/resume, and then **scan status**: Uploading → Scanning for malware → ✓ Clean / ✕ Rejected (with a reason, e.g. "Executable files aren't allowed: setup.exe").
3. **Media:** cover image (required) + gallery. Each image has a **required alt-text field**. For mobile designs, upload screens and choose a phone frame. Drag to reorder.
4. **License & version:** license picker cards with plain-language explanations (MIT, CC BY 4.0, CC BY-NC 4.0, Personal use only, Custom), version number, and changelog.
5. **Review & publish:** a preview of the final card and detail page, a checklist of what's missing, an "I own the rights to this work" checkbox, and Publish. For new accounts, explain "Your first 2 uploads are reviewed by a moderator, usually within 24 h."
- Show the stepper on desktop, and a compact "Step 2 of 5" with a sticky bottom action bar on mobile. Include validation error states and an autosaved indicator.

### 7. Public profile `/@username`
- Banner, avatar, display name, @username, bio, location, links (website, GitHub, X), skills chips, and an "Available for hire" badge + Contact button.
- Stats row: Templates · Downloads · Likes received · Awards · Followers.
- Tabs: **Templates · Collections · Liked · Awards · About**.
- An own-profile variant with an Edit profile button. Empty states for each tab ("No templates yet — Upload your first").

### 8. Creator dashboard `/dashboard`
- Overview cards: views, downloads, likes and votes (7/30/90-day toggle) with sparklines, plus a line chart.
- Templates table: thumbnail, title, status pill (**Draft · Scanning · Pending review · Published · Unlisted · Removed**), latest version, downloads, score, and actions (Edit, New version, Unlist).
- A per-template analytics page and a versions manager (publish new version, yank version).

### 9. Awards `/awards`
- A big editorial treatment for today's winner, then Week and Month winners, then an archive grid by date. The award badge design should be distinctive and recognizable in small sizes on cards.

### 10. Collections, Notifications, Settings
- **Collection page:** name, owner, public/private badge, and a grid. A "Save to collection" modal lists your collections with checkboxes and a "New collection" field.
- **Notifications:** grouped by Today / Earlier, with types for new follower, like milestones, new comment, vote received, award won 🏆, upload approved, upload rejected (with reason). Mark all read.
- **Settings:** Profile · Account (email, password, connected GitHub/Google) · Notifications (toggles) · Privacy (hide Liked tab) · Danger zone (Export my data, Delete account with a typed confirmation).

### 11. Auth & onboarding
- Sign in / Sign up: **Continue with GitHub** (primary), Google, and email + password or magic link. Include a CAPTCHA area, verify-email screen, and forgot-password flow.
- **Onboarding (3 steps):** choose username + avatar → pick at least 3 interests (large selectable tiles for categories and stacks) → suggested creators to follow.

### 12. Admin / moderation `/admin` (desktop only is fine)
- Review queue: template preview, creator trust level, scan report, and Approve / Reject (reason required) / Request changes.
- Reports list with target preview, reason and status.
- An audit log table (read-only).

### 13. System pages
- A 404 with personality ("This template got lost in the layers") and a search box. A 500 page and an offline/slow-connection banner.

## States every screen must show
Loading (skeletons, not spinners, for content), empty, error with retry, logged-out vs logged-in, and permission-denied. Toasts for like, save, copy link, errors.

## Realistic sample data (use this instead of lorem ipsum)
- "**Nocturne — SaaS Dashboard Kit**" by *Mara Lin* · Next.js, Tailwind · Figma + ZIP · MIT · ★ 8.7 · 1,284 downloads · 🏆 Template of the Day
- "**Tindahan — Grocery Delivery App**" by *Paolo Reyes* · Mobile / iOS + Android · Figma · CC BY 4.0 · ★ 8.1
- "**Brutal Folio**" by *Kenji Watanabe* · Portfolio · Astro · Code ZIP · ★ 7.9
- "**Ledger Lite — Invoicing Web App Concept**" by *Amara Okafor* · Concept · Canva link · Personal use
- "**Glasshouse UI Kit**" by *Sofia Marín* · UI Kit · Photoshop PSD + Sketch · CC BY-NC
- "**Pulse — Fitness Tracker**" by *Dev Patel* · Mobile / Flutter · Figma · MIT · ★ 8.3

## Accessibility & responsiveness requirements
- Breakpoints: 360, 768, 1024, 1440, 1920.
- Visible focus rings, keyboard-reachable everything (including vote controls and the upload dropzone), a minimum 44×44 touch target, labels on every input, AA contrast in both themes, and no information conveyed by color alone (status pills get icons plus text).

## Deliverables
1. A small design system: color tokens (dark + light), type scale, spacing, radius, elevation, icon style, and components (buttons, inputs, chips, pills, tabs, cards, modals, sheets, toasts, stepper, sliders, tables, empty states).
2. All screens above at desktop and mobile widths, with the key states.
3. A clickable prototype flow: Home → Template detail → Vote → Download, and Upload wizard → Publish → Dashboard.

Backend, data and business rules already exist in a separate architecture plan. Design only the UI, but respect the states and rules described here (verified-email gates, 7-day voting age, scan statuses, license acceptance, and the review queue for new creators).
