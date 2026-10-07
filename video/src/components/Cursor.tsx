import { C } from '../theme';

/**
 * An SVG pointer. `press` (0–1) squeezes it on click; `ripple` (0–1) draws the
 * expanding lime ring that marks where the click landed.
 */
export const Cursor: React.FC<{ x: number; y: number; opacity?: number; press?: number; ripple?: number }> = ({
  x, y, opacity = 1, press = 0, ripple = -1,
}) => (
  <>
    {ripple >= 0 && ripple < 1 && (
      <svg width={120} height={120} viewBox="0 0 120 120"
           style={{ position: 'absolute', left: x - 60, top: y - 60, pointerEvents: 'none', overflow: 'visible' }}>
        <circle cx="60" cy="60" r={8 + ripple * 44} fill="none" stroke={C.accent} strokeWidth={3 * (1 - ripple)} opacity={1 - ripple} />
        <circle cx="60" cy="60" r={6 + ripple * 18} fill={C.accent} opacity={0.35 * (1 - ripple)} />
      </svg>
    )}
    <svg width={34} height={40} viewBox="0 0 34 40"
         style={{
           position: 'absolute', left: x - 6, top: y - 4, opacity, pointerEvents: 'none', overflow: 'visible',
           transform: `scale(${1 - press * 0.14})`, transformOrigin: '6px 4px',
           filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.55))',
         }}>
      <path d="M6 4 L6 31 L13.2 24.4 L18 35.2 L23 33 L18.3 22.4 L28 22.4 Z"
            fill={C.ink} stroke={C.canvas} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  </>
);
