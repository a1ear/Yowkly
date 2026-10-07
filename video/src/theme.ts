import { loadFont as loadGeist } from '@remotion/google-fonts/Geist';
import { loadFont as loadGeistMono } from '@remotion/google-fonts/GeistMono';
import { loadFont as loadInstrumentSerif } from '@remotion/google-fonts/InstrumentSerif';

// ── Video ───────────────────────────────────────────────────────────────
export const VIDEO = { width: 1920, height: 1080, fps: 30, durationInFrames: 900 } as const;

/** Seconds → frames, so the timeline below reads in seconds like the storyboard. */
export const s = (seconds: number) => Math.round(seconds * VIDEO.fps);

// ── Timeline (frames). Scenes overlap slightly so every hand-off is a motion, not a cut.
export const T = {
  intro: { from: 0, to: s(5) },          // 0–150   kinetic hook + window floats in
  dashboard: { from: s(5), to: s(15) },  // 150–450 sidebar click, grid populates, a vote
  value: { from: s(15), to: s(25) },     // 450–750 cards morph into a chart, counter ticks
  outro: { from: s(25), to: s(30) },     // 750–900 UI recedes + blurs, logo, CTA
} as const;

// ── Brand: Yowkly "Night Studio" tokens (same values as the website's globals.css).
export const C = {
  canvas: '#0F0E0C',
  surface1: '#171613',
  surface2: '#1E1C18',
  surface3: '#27251F',
  line: '#2E2B25',
  ink: '#F2EFE8',
  ink2: '#B8B3A8',
  ink3: '#948F84',
  accent: '#D4FF3A',      // neon lime-yellow: always a fill with dark text on it
  accentSoft: '#EEFFA8',  // light yellow highlight
  onAccent: '#11140A',
  success: '#66D9A6',
  warning: '#FFC266',
  info: '#8DBAFF',
  danger: '#FF7D6E',
} as const;

// ── Type: the website's own families.
const weights = { weights: ['400', '500', '600', '700'] as ('400' | '500' | '600' | '700')[], subsets: ['latin'] as 'latin'[] };
export const FONT = {
  sans: loadGeist('normal', weights).fontFamily,
  mono: loadGeistMono('normal', { weights: ['400', '500'], subsets: ['latin'] }).fontFamily,
  serif: loadInstrumentSerif('normal', { weights: ['400'], subsets: ['latin'] }).fontFamily,
} as const;
loadInstrumentSerif('italic', { weights: ['400'], subsets: ['latin'] });

// ── Copy. Everything on screen lives here so it can be edited without touching motion code.
export const COPY = {
  hookLine1: ['Every', 'project', 'starts'],
  hookLine2: ['from', 'a'],
  hookAccent: 'blank canvas.',
  hookAnswer: 'It doesn’t have to.',
  dashboardEyebrow: 'Explore',
  dashboardHeadline: 'Templates built and voted by devs.',
  valueEyebrow: 'Ship faster',
  valueHeadline: 'Start from proven work. Save the weeks.',
  metricLabel: 'Hours saved',
  metricCaption: 'Starting from community templates instead of a blank file',
  metricBadge: 'Weeks back in your roadmap',
  chartTitle: 'Build time saved per launch',
  tagline: 'For Devs by Devs.',
  cta: 'Start Automating Now',
  url: 'yowkly.vercel.app',
} as const;

/**
 * Illustrative numbers for the "Time saved" scene. Replace them with real
 * figures (or keep them clearly illustrative) before publishing the video.
 */
export const METRICS = {
  hoursSaved: 1240,
  weeklyBars: [18, 26, 31, 44, 52, 61, 78, 96], // eight bars, one per card that morphs
  weekLabels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'],
} as const;
