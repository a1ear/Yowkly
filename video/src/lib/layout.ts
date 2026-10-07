import { METRICS } from '../theme';

/**
 * One layout grid for the whole film. Every position (the cursor's targets, the
 * cards, the chart bars) is derived from these numbers, so moving a panel moves
 * everything that points at it.
 *
 *   ┌──────────────── window 1480×832 at (220, 204) ────────────────┐
 *   │ title bar 44                                                    │
 *   │ top bar 64                                                      │
 *   │ sidebar 248 │ canvas 1232×724                                   │
 *   └─────────────────────────────────────────────────────────────────┘
 */
export const WIN = { x: 220, y: 204, w: 1480, h: 832, radius: 22, titleBar: 44, topBar: 64, sidebar: 248 } as const;

/** The canvas (main content area) in composition coordinates. */
export const CANVAS = {
  x: WIN.x + WIN.sidebar,
  y: WIN.y + WIN.titleBar + WIN.topBar,
  w: WIN.w - WIN.sidebar,
  h: WIN.h - WIN.titleBar - WIN.topBar,
} as const;

// ── Sidebar
export const SIDEBAR_ITEMS = [
  { label: 'All templates', icon: 'grid' },
  { label: 'Inspo', icon: 'sparkle' },
  { label: 'Websites', icon: 'globe' },
  { label: 'Mobile Apps', icon: 'phone' },
  { label: 'UI Kits', icon: 'layers' },
  { label: 'Components', icon: 'component' },
  { label: 'Presentations', icon: 'monitor' },
] as const;
export const SIDEBAR = { padTop: 24, label: 28, item: 44, padX: 16 } as const;
export const WEBSITES_INDEX = 2;

/** Top of sidebar item `i`, relative to the sidebar. */
export const sidebarItemTop = (i: number) => SIDEBAR.padTop + SIDEBAR.label + i * SIDEBAR.item;
/** Centre of sidebar item `i` in composition coordinates (cursor target). */
export const sidebarItemCenter = (i: number) => ({
  x: WIN.x + SIDEBAR.padX + 92,
  y: CANVAS.y + sidebarItemTop(i) + SIDEBAR.item / 2,
});

// ── Template grid (canvas coordinates)
export const GRID = { pad: 40, header: 72, cols: 4, cardW: 270, cardH: 244, coverH: 170, gap: 24 } as const;
export const CARD_COUNT = 8;

export type Rect = { x: number; y: number; w: number; h: number };

export const cardRect = (i: number): Rect => {
  const col = i % GRID.cols;
  const row = Math.floor(i / GRID.cols);
  return {
    x: GRID.pad + col * (GRID.cardW + GRID.gap),
    y: GRID.pad + GRID.header + row * (GRID.cardH + GRID.gap),
    w: GRID.cardW,
    h: GRID.cardH,
  };
};

/** Canvas → composition coordinates. */
export const toComp = (x: number, y: number) => ({ x: CANVAS.x + x, y: CANVAS.y + y });

/** Where the vote pill of card `i` sits (cursor target), in composition coordinates. */
export const voteButtonCenter = (i: number) => {
  const r = cardRect(i);
  return toComp(r.x + r.w - 16 - 34, r.y + GRID.coverH + 30);
};
export const cardCenter = (i: number) => {
  const r = cardRect(i);
  return toComp(r.x + r.w / 2, r.y + GRID.coverH / 2);
};

// ── Value scene (canvas coordinates): metric panel on the left, chart on the right.
// Once the grid header has gone, the two panels use the canvas's full height.
const PANEL_H = CANVAS.h - GRID.pad * 2;
export const METRIC_PANEL: Rect = { x: GRID.pad, y: GRID.pad, w: 380, h: PANEL_H };
export const CHART_PANEL: Rect = { x: GRID.pad + 380 + 32, y: GRID.pad, w: CANVAS.w - GRID.pad * 2 - 380 - 32, h: PANEL_H };
export const PLOT = {
  left: CHART_PANEL.x + 48,
  right: CHART_PANEL.x + CHART_PANEL.w - 36,
  top: CHART_PANEL.y + 150,
  baseline: CHART_PANEL.y + CHART_PANEL.h - 64,
  barW: 48,
} as const;
const MAX_BAR = 100;

/** The bar each card turns into. */
export const barRect = (i: number): Rect => {
  const slot = (PLOT.right - PLOT.left) / CARD_COUNT;
  const h = (METRICS.weeklyBars[i] / MAX_BAR) * (PLOT.baseline - PLOT.top);
  return { x: PLOT.left + i * slot + (slot - PLOT.barW) / 2, y: PLOT.baseline - h, w: PLOT.barW, h };
};
