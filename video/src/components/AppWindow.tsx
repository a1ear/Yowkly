import type { CSSProperties, ReactNode } from 'react';
import { C, COPY, FONT } from '../theme';
import { WIN } from '../lib/layout';
import { Icon } from './Icons';

/** Browser-style window chrome around the Yowkly app. Transform/blur come from the parent scene. */
export const AppWindow: React.FC<{ style?: CSSProperties; path: string; children: ReactNode }> = ({ style, path, children }) => (
  <div style={{
    position: 'absolute', left: WIN.x, top: WIN.y, width: WIN.w, height: WIN.h,
    borderRadius: WIN.radius, overflow: 'hidden', backgroundColor: C.canvas,
    boxShadow: `0 0 0 1px ${C.line}, 0 40px 120px rgba(0,0,0,0.6), 0 12px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)`,
    ...style,
  }}>
    <div style={{
      height: WIN.titleBar, display: 'flex', alignItems: 'center', gap: 8, padding: '0 18px',
      backgroundColor: C.surface1, borderBottom: `1px solid ${C.line}`,
    }}>
      {[C.danger, C.warning, C.success].map((c) => (
        <svg key={c} width={12} height={12} viewBox="0 0 12 12"><circle cx="6" cy="6" r="6" fill={c} opacity="0.85" /></svg>
      ))}
      <div style={{
        margin: '0 auto', height: 26, minWidth: 360, padding: '0 14px', borderRadius: 8, backgroundColor: C.surface2,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        fontFamily: FONT.mono, fontSize: 13, color: C.ink3, transform: 'translateX(-30px)',
      }}>
        <svg width={11} height={13} viewBox="0 0 11 13" fill="none" stroke={C.ink3} strokeWidth="1.5">
          <rect x="1" y="5.5" width="9" height="6.5" rx="1.5" /><path d="M3 5.5V4a2.5 2.5 0 0 1 5 0v1.5" />
        </svg>
        {COPY.url}<span style={{ color: C.ink2 }}>{path}</span>
      </div>
      <Icon name="arrowUpRight" size={16} color={C.ink3} />
    </div>
    <div style={{ position: 'relative', height: WIN.h - WIN.titleBar }}>{children}</div>
  </div>
);
