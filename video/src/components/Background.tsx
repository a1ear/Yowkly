import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { C, T } from '../theme';
import { EASE } from '../lib/motion';

/**
 * The stage: dark canvas, a faint dot grid, two slow lime glows and a vignette.
 * The glow brightens for the outro so the logo sits in light.
 */
export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = frame / 900;
  const outroGlow = interpolate(frame, [T.outro.from, T.outro.from + 60], [0, 1], { easing: EASE.inOut, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const glowA = { x: 22 + Math.sin(drift * Math.PI * 2) * 6, y: 18 + Math.cos(drift * Math.PI * 2) * 4 };
  const glowB = { x: 80 - Math.sin(drift * Math.PI * 2) * 5, y: 86 - Math.cos(drift * Math.PI * 2) * 5 };
  return (
    <AbsoluteFill style={{ backgroundColor: C.canvas }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <pattern id="dots" width="32" height="32" patternUnits="userSpaceOnUse" patternTransform={`translate(${-frame * 0.15} ${-frame * 0.08})`}>
            <circle cx="1.5" cy="1.5" r="1.2" fill={C.ink} opacity="0.07" />
          </pattern>
          <radialGradient id="fade" cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor="#fff" stopOpacity="1" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <mask id="dotMask"><rect width="100%" height="100%" fill="url(#fade)" /></mask>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots)" mask="url(#dotMask)" />
      </svg>
      <AbsoluteFill style={{
        background: `radial-gradient(900px 600px at ${glowA.x}% ${glowA.y}%, rgba(212,255,58,${0.07 + outroGlow * 0.05}), transparent 70%)`,
      }} />
      <AbsoluteFill style={{
        background: `radial-gradient(800px 560px at ${glowB.x}% ${glowB.y}%, rgba(238,255,168,${0.045 + outroGlow * 0.04}), transparent 70%)`,
      }} />
      <AbsoluteFill style={{
        background: `radial-gradient(700px 420px at 50% 46%, rgba(212,255,58,${outroGlow * 0.12}), transparent 72%)`,
      }} />
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)' }} />
    </AbsoluteFill>
  );
};
