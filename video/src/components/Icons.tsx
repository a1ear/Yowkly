import type { CSSProperties } from 'react';
import { C } from '../theme';

// Line icons from the Yowkly website's own set: 24px grid, 1.75 stroke, round caps.
const PATHS = {
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  bit: <><path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5z" /><path d="M9 9.5l3 2.5 3-2.5M12 12v4" /></>,
  sparkle: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
  phone: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  monitor: <><rect x="2" y="4" width="20" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  trophy: <><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" /><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></>,
  upload: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></>,
  compass: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5l-2 5-5 2 2-5z" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  arrowRight: <><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>,
  arrowUpRight: <><path d="M7 17L17 7" /><path d="M8 7h9v9" /></>,
  comment: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />,
  layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>,
  component: <><path d="M12 3l4 4-4 4-4-4z" /><path d="M12 13l4 4-4 4-4-4z" /><path d="M7 8l4 4-4 4-4-4z" /><path d="M17 8l4 4-4 4-4-4z" /></>,
  check: <path d="M20 6L9 17l-5-5" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  filter: <path d="M4 5h16l-6 8v5l-4 2v-7z" />,
} as const;

export type IconName = keyof typeof PATHS;

export const Icon: React.FC<{ name: IconName; size?: number; color?: string; strokeWidth?: number; style?: CSSProperties }> = ({
  name, size = 20, color = 'currentColor', strokeWidth = 1.75, style,
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth}
       strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0, ...style }}>
    {PATHS[name]}
  </svg>
);

/**
 * The Yowkly mark: an outlined square behind a solid lime square.
 * `draw` (0–1) traces the outline; `drop` (0–1, may overshoot) lands the lime square.
 */
export const Logo: React.FC<{ size?: number; draw?: number; drop?: number }> = ({ size = 26, draw = 1, drop = 1 }) => {
  const perimeter = 4 * 15 - (8 - 2 * Math.PI) * 3; // a 15×15 square with r=3 corners
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" style={{ display: 'block', overflow: 'visible' }}>
      <rect x="2" y="7" width="15" height="15" rx="3" fill="none" stroke={C.ink2} strokeWidth="1.8"
            strokeDasharray={perimeter} strokeDashoffset={perimeter * (1 - Math.min(1, Math.max(0, draw)))} strokeLinecap="round" />
      <g style={{
        transformBox: 'fill-box', transformOrigin: 'center',
        transform: `translateY(${(1 - drop) * -14}px) rotate(${(1 - drop) * -18}deg) scale(${0.4 + 0.6 * drop})`,
        opacity: Math.min(1, Math.max(0, drop * 3)),
      }}>
        <rect x="9" y="2" width="15" height="15" rx="3" fill={C.accent} />
      </g>
    </svg>
  );
};
