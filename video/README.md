# Yowkly · 30-second product demo (Remotion)

A 1920×1080, 30 fps, 30-second motion piece for Yowkly, built entirely from
React + SVG with Remotion. No images, no video clips, no screenshots: every
pixel is drawn from code, so it renders crisp at any size and every number on
screen can be edited.

## Run it

```bash
cd video
npm install
npm run studio          # live preview with a scrubbable timeline
npm run render          # → out/yowkly-demo.mp4 (H.264, CRF 16)
npm run render:prores   # → out/yowkly-demo.mov (ProRes 4444, for editing)
npm run still           # → out/poster.png (frame 880, the CTA)
```

The first render downloads Remotion's headless Chrome into `node_modules`.

## Storyboard

| Time | Frames | Scene | What happens |
| --- | --- | --- | --- |
| 0–5 s | 0–150 | **1 · Hook** | "Every project starts from a *blank canvas.*" Words rise out of masks; a lime highlight wipes in behind the accent phrase; "It doesn't have to." The block lifts and blurs away as the app window floats up (heavy spring, 3D tilt settling to flat). |
| 5–15 s | 150–450 | **2 · Core feature** | Explore with loading skeletons. The cursor clicks **Websites** in the sidebar; the active pill slides over with a squash-and-stretch; eight template cards spring into the grid one after another. The cursor hovers a card (it lifts) and spends a yowkbit on it: the pill flips lime, +1 floats up, the balance in the header ticks 100 → 99. |
| 15–25 s | 450–750 | **3 · Value** | Each card morphs, left to right, into a bar of a "build time saved" chart (position, size, radius and colour all ride one spring per card). The metric panel slides in and **Hours saved** counts up with an ease-out; a trend line draws through the bar tops. |
| 25–30 s | 750–900 | **4 · Outro & CTA** | The app shrinks back and blurs. The logo draws itself (outline traces, the lime square drops in with a bounce), the wordmark rises letter by letter, "For Devs *by* Devs." fades up, and the **Start Automating Now** button springs in with a breathing glow while the cursor comes to rest on it. |

## How it's put together

```
video/
├── package.json            Remotion 4, React 19
├── remotion.config.ts      PNG frames → H.264 CRF 16, yuv420p
├── tsconfig.json
└── src/
    ├── index.ts            registerRoot
    ├── Root.tsx            the <Composition> (1920×1080, 30 fps, 900 frames)
    ├── YowklyDemo.tsx      the timeline: window, cursor route, scene layering
    ├── theme.ts            brand colours, fonts, ALL on-screen copy, the metrics
    ├── lib/
    │   ├── cues.ts         every beat of the film, in frames
    │   ├── layout.ts       one layout grid; cursor targets and bars derive from it
    │   └── motion.ts       easing curves, spring presets, path + counter helpers
    ├── components/
    │   ├── AppWindow.tsx   browser chrome
    │   ├── TopBar.tsx      the site header (logo, nav, search, yowkbit balance)
    │   ├── Sidebar.tsx     categories with the sliding active pill
    │   ├── CardField.tsx   the 8 cards: spring in, hover, vote, morph into bars
    │   ├── TemplateCard.tsx card content + the template data
    │   ├── CoverArt.tsx    8 miniature website designs in SVG
    │   ├── SceneCaption.tsx the headline above the window
    │   ├── CtaButton.tsx   the call to action with its glow pulse
    │   ├── Cursor.tsx      SVG pointer, press squeeze and click ripple
    │   ├── Background.tsx  dot grid, drifting lime glows, vignette
    │   └── Icons.tsx       the website's own line icons + the animated logo
    └── scenes/
        ├── IntroScene.tsx
        ├── DashboardScene.tsx
        ├── ValueScene.tsx
        └── OutroScene.tsx
```

Motion rules used throughout:

- **Nothing moves linearly.** Entrances use an expo-out curve
  (`cubic-bezier(0.16, 1, 0.3, 1)`), moves between rests use ease-in-out, exits
  accelerate away. Physical objects (window, cards, pills, logo) use springs,
  tuned per job in `lib/motion.ts` (`heavy`, `soft`, `snappy`, `bouncy`).
- **One continuous object.** The app window persists from Scene 1 to Scene 4,
  and the cards *become* the chart, so the film reads as one camera move.
- **Deterministic.** Every value is a pure function of the frame number (no
  `Math.random`, no timers), so any frame renders identically, in any order.

## Editing

- **Words:** everything on screen is in `COPY` in `src/theme.ts`.
- **Timing:** move a beat in `src/lib/cues.ts`; the cursor and scenes follow.
- **Layout:** change a panel in `src/lib/layout.ts`; cursor targets and bars follow.
- **Numbers:** the "Hours saved" total and the eight bar values are in
  `METRICS` in `src/theme.ts`. They are **illustrative**. Replace them with
  real figures, or keep them clearly presented as an example, before publishing.
