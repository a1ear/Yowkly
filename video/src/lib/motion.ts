import { Easing, interpolate, spring, type SpringConfig } from 'remotion';
import { VIDEO } from '../theme';

// ── Curves. Nothing in the film moves linearly.
export const EASE = {
  /** Fast start, long soft landing: entrances. (expo-out) */
  out: Easing.bezier(0.16, 1, 0.3, 1),
  /** Gentle on both ends: moves between two resting places. */
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  /** Accelerates away: exits. */
  in: Easing.bezier(0.7, 0, 0.84, 0),
  /** Slight overshoot, for small UI pops. (back-out) */
  pop: Easing.bezier(0.34, 1.56, 0.64, 1),
} as const;

// ── Springs, tuned per job.
export const SPRING = {
  /** Large surfaces (the app window): heavy, no wobble. */
  heavy: { damping: 26, stiffness: 90, mass: 1.2 },
  /** Cards and panels: a soft settle with a hint of bounce. */
  soft: { damping: 16, stiffness: 120, mass: 0.9 },
  /** Buttons, pills, counters: quick and lively. */
  snappy: { damping: 12, stiffness: 220, mass: 0.6 },
  /** Logo drop: noticeable bounce. */
  bouncy: { damping: 9, stiffness: 160, mass: 0.8 },
} as const satisfies Record<string, Partial<SpringConfig>>;

/** A spring that starts at `start` (frames) and runs 0 → 1. */
export function springAt(frame: number, start: number, config: Partial<SpringConfig> = SPRING.soft, durationInFrames?: number) {
  return spring({ frame: frame - start, fps: VIDEO.fps, config, durationInFrames });
}

/** Eased 0 → 1 between two frames (clamped). */
export function progress(frame: number, from: number, to: number, easing: (t: number) => number = EASE.out) {
  return interpolate(frame, [from, to], [0, 1], { easing, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
}

/** Linear mix of two numbers. */
export const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Mix two #RRGGBB colours. */
export function mixColor(a: string, b: string, t: number) {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (p: number, shift: number) => (p >> shift) & 255;
  const c = (shift: number) => Math.round(mix(ch(pa, shift), ch(pb, shift), t));
  return `rgb(${c(16)}, ${c(8)}, ${c(0)})`;
}

export type Key = { f: number; x: number; y: number };

/**
 * A path through keyframes with an ease-in-out between each pair, so the
 * cursor accelerates and settles like a real hand instead of gliding.
 */
export function along(frame: number, keys: readonly Key[]) {
  if (frame <= keys[0].f) return { x: keys[0].x, y: keys[0].y };
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (frame <= b.f) {
      const t = interpolate(frame, [a.f, b.f], [0, 1], { easing: EASE.inOut });
      // A gentle arc (hands don't move in straight lines).
      const arc = Math.sin(t * Math.PI) * Math.min(60, Math.hypot(b.x - a.x, b.y - a.y) * 0.12);
      return { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) - arc };
    }
  }
  const last = keys[keys.length - 1];
  return { x: last.x, y: last.y };
}

/** Counts up with an ease-out, like an odometer settling. */
export function countUp(frame: number, from: number, to: number, target: number) {
  return Math.round(interpolate(frame, [from, to], [0, target], { easing: Easing.bezier(0.22, 1, 0.36, 1), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
}

export const formatNumber = (n: number) => new Intl.NumberFormat('en-US').format(n);
