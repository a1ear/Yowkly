import { C, FONT } from '../theme';
import { Icon } from './Icons';

/**
 * The call to action. `pulse` (0–1, looping) breathes the glow; `hover` (0–1)
 * is the cursor resting on it: brighter, a touch larger, the arrow nudges right.
 */
export const CtaButton: React.FC<{ label: string; pulse: number; hover: number; press?: number }> = ({ label, pulse, hover, press = 0 }) => {
  const glow = 18 + pulse * 26 + hover * 16;
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      {/* soft halo ring that expands with the pulse */}
      <div style={{
        position: 'absolute', inset: -10 - pulse * 10, borderRadius: 999,
        border: `2px solid rgba(212,255,58,${0.35 * (1 - pulse)})`,
      }} />
      <div style={{
        height: 76, padding: '0 38px 0 40px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 16,
        backgroundColor: hover > 0.5 ? C.accentSoft : C.accent, color: C.onAccent,
        fontFamily: FONT.sans, fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em',
        transform: `scale(${1 + hover * 0.04 - press * 0.05})`,
        boxShadow: `0 0 ${glow}px rgba(212,255,58,${0.45 + pulse * 0.25}), 0 18px 50px rgba(212,255,58,0.18), inset 0 -3px 0 rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.5)`,
      }}>
        {label}
        <span style={{
          width: 44, height: 44, borderRadius: 44, backgroundColor: C.onAccent, color: C.accent,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', transform: `translateX(${hover * 6}px)`,
        }}>
          <Icon name="arrowRight" size={22} strokeWidth={2.2} />
        </span>
      </div>
    </div>
  );
};
