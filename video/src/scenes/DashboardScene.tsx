import { interpolate, useCurrentFrame } from 'remotion';
import { C, FONT } from '../theme';
import { CUE } from '../lib/cues';
import { EASE, progress } from '../lib/motion';
import { CARD_COUNT, GRID, cardRect } from '../lib/layout';
import { Icon } from '../components/Icons';

const FILTERS = ['Trending', 'Newest', 'Top voted', 'Free', 'Figma', 'Next.js'];

/**
 * Scene 2 (5–15 s), canvas layer: the Explore header and the loading skeletons.
 * Before the sidebar click the grid shows shimmering placeholders; on the click
 * the title swaps to "Websites" and the real cards (CardField) spring in.
 */
export const DashboardScene: React.FC = () => {
  const frame = useCurrentFrame();
  const out = progress(frame, CUE.headerOut, CUE.headerOut + 22, EASE.in);
  if (out >= 1) return null;

  const swap = progress(frame, CUE.websitesClick + 2, CUE.websitesClick + 20, EASE.inOut);
  const skeletonsGone = progress(frame, CUE.websitesClick, CUE.websitesClick + 14, EASE.out);
  const shimmerX = ((frame * 14) % 900) - 300;

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* header */}
      <div style={{
        position: 'absolute', left: GRID.pad, right: GRID.pad, top: GRID.pad, height: GRID.header - 20,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        opacity: 1 - out, transform: `translateY(${-out * 24}px)`,
      }}>
        <div style={{ position: 'relative', height: 44, width: 420, overflow: 'hidden' }}>
          {(['All templates', 'Websites'] as const).map((title, i) => {
            const y = i === 0 ? -swap * 100 : (1 - swap) * 100;
            return (
              <div key={title} style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: 14, transform: `translateY(${y}%)`,
                fontFamily: FONT.serif, fontSize: 40, color: C.ink, letterSpacing: '-0.02em', lineHeight: 1,
              }}>
                {title}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {FILTERS.map((f, i) => (
            <div key={f} style={{
              height: 34, padding: '0 14px', borderRadius: 999, display: 'flex', alignItems: 'center', gap: 6,
              fontFamily: FONT.sans, fontSize: 13.5, fontWeight: 500,
              backgroundColor: i === 0 ? C.ink : 'transparent', color: i === 0 ? C.canvas : C.ink2,
              boxShadow: i === 0 ? 'none' : `inset 0 0 0 1px ${C.line}`,
            }}>
              {i === 0 && <Icon name="sparkle" size={13} />}{f}
            </div>
          ))}
          <div style={{
            height: 34, width: 34, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `inset 0 0 0 1px ${C.line}`, color: C.ink2,
          }}>
            <Icon name="filter" size={15} />
          </div>
        </div>
      </div>

      {/* loading skeletons (gray placeholder bars with a sweep) */}
      {skeletonsGone < 1 && Array.from({ length: CARD_COUNT }, (_, i) => {
        const r = cardRect(i);
        const breathe = interpolate(Math.sin((frame + i * 6) / 9), [-1, 1], [0.75, 1]);
        return (
          <div key={i} style={{
            position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: 16, overflow: 'hidden',
            backgroundColor: C.surface1, boxShadow: `inset 0 0 0 1px ${C.line}`,
            opacity: (1 - skeletonsGone) * breathe, transform: `scale(${1 - skeletonsGone * 0.04})`,
          }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: GRID.coverH, backgroundColor: C.surface2 }} />
            <div style={{ position: 'absolute', left: 16, top: GRID.coverH + 18, width: 150, height: 12, borderRadius: 6, backgroundColor: C.surface3 }} />
            <div style={{ position: 'absolute', left: 16, top: GRID.coverH + 40, width: 90, height: 10, borderRadius: 5, backgroundColor: C.surface2 }} />
            <div style={{ position: 'absolute', right: 16, top: GRID.coverH + 21, width: 64, height: 30, borderRadius: 15, backgroundColor: C.surface2 }} />
            <div style={{
              position: 'absolute', top: 0, bottom: 0, width: 160, left: shimmerX - r.x * 0.4,
              background: 'linear-gradient(90deg, transparent, rgba(242,239,232,0.06), transparent)', transform: 'skewX(-18deg)',
            }} />
          </div>
        );
      })}
    </div>
  );
};
