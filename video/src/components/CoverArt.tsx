import { C } from '../theme';

/**
 * Miniature website designs for the template cards, drawn in SVG so they stay
 * sharp at any scale. Four layouts × their own palettes = eight distinct covers.
 */
type Palette = { bg: string; panel: string; accent: string; ink: string; muted: string };

const PALETTES: Palette[] = [
  { bg: '#14130F', panel: '#1F1D18', accent: C.accent, ink: '#F2EFE8', muted: '#5C5850' },
  { bg: '#0E1420', panel: '#162033', accent: '#8DBAFF', ink: '#E8F0FF', muted: '#3B4B66' },
  { bg: '#1A1210', panel: '#2A1C18', accent: '#FF9F7A', ink: '#FFEDE6', muted: '#634640' },
  { bg: '#0F1A15', panel: '#17271F', accent: '#66D9A6', ink: '#E5FFF3', muted: '#36584A' },
  { bg: '#F4F1EA', panel: '#E7E2D6', accent: '#17160F', ink: '#17160F', muted: '#B5AE9F' },
  { bg: '#1B1426', panel: '#271D38', accent: '#C9A7FF', ink: '#F3EBFF', muted: '#4D3F66' },
  { bg: '#1C180D', panel: '#2B2513', accent: '#FFC266', ink: '#FFF4DE', muted: '#655634' },
  { bg: '#101010', panel: '#1B1B1B', accent: '#EEFFA8', ink: '#FAFAFA', muted: '#474747' },
];

export const CoverArt: React.FC<{ variant: number; width: number; height: number }> = ({ variant, width, height }) => {
  const p = PALETTES[variant % PALETTES.length];
  const layout = variant % 4;
  return (
    <svg width={width} height={height} viewBox="0 0 270 170" preserveAspectRatio="xMidYMid slice" style={{ display: 'block' }}>
      <rect width="270" height="170" fill={p.bg} />
      {/* nav */}
      <rect x="14" y="12" width="22" height="6" rx="3" fill={p.accent} />
      {[0, 1, 2].map((i) => <rect key={i} x={160 + i * 26} y="13" width="18" height="4" rx="2" fill={p.muted} />)}
      {layout === 0 && (
        <>
          <rect x="14" y="40" width="150" height="14" rx="3" fill={p.ink} />
          <rect x="14" y="60" width="110" height="14" rx="3" fill={p.ink} />
          <rect x="14" y="84" width="130" height="5" rx="2.5" fill={p.muted} />
          <rect x="14" y="94" width="100" height="5" rx="2.5" fill={p.muted} />
          <rect x="14" y="112" width="58" height="18" rx="9" fill={p.accent} />
          <rect x="80" y="112" width="50" height="18" rx="9" fill="none" stroke={p.muted} />
          <rect x="178" y="36" width="78" height="112" rx="10" fill={p.panel} />
          <circle cx="217" cy="78" r="22" fill={p.accent} opacity="0.85" />
          <rect x="190" y="112" width="54" height="5" rx="2.5" fill={p.muted} />
          <rect x="196" y="124" width="42" height="5" rx="2.5" fill={p.muted} />
        </>
      )}
      {layout === 1 && (
        <>
          <rect x="14" y="32" width="242" height="52" rx="8" fill={p.panel} />
          <rect x="26" y="44" width="96" height="10" rx="3" fill={p.ink} />
          <rect x="26" y="62" width="64" height="5" rx="2.5" fill={p.muted} />
          <polyline points="140,74 162,62 184,68 206,48 228,54 246,40" fill="none" stroke={p.accent} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect x={14 + i * 82} y="94" width="74" height="62" rx="8" fill={p.panel} />
              <rect x={24 + i * 82} y="106" width="30" height="5" rx="2.5" fill={p.muted} />
              <rect x={24 + i * 82} y="118" width="44" height="12" rx="3" fill={i === 1 ? p.accent : p.ink} />
              <rect x={24 + i * 82} y="138" width={20 + i * 8} height="5" rx="2.5" fill={p.muted} />
            </g>
          ))}
        </>
      )}
      {layout === 2 && (
        <>
          <rect x="14" y="32" width="242" height="70" rx="8" fill={p.panel} />
          <rect x="70" y="48" width="130" height="12" rx="3" fill={p.ink} />
          <rect x="92" y="66" width="86" height="5" rx="2.5" fill={p.muted} />
          <rect x="108" y="78" width="54" height="14" rx="7" fill={p.accent} />
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <rect x={14 + i * 61} y="110" width="55" height="46" rx="6" fill={p.panel} />
              <rect x={20 + i * 61} y="116" width="43" height="24" rx="4" fill={i % 2 ? p.muted : p.accent} opacity={i % 2 ? 0.6 : 0.8} />
              <rect x={20 + i * 61} y="146" width="28" height="4" rx="2" fill={p.muted} />
            </g>
          ))}
        </>
      )}
      {layout === 3 && (
        <>
          <rect x="14" y="32" width="64" height="124" rx="8" fill={p.panel} />
          {[0, 1, 2, 3, 4].map((i) => <rect key={i} x="24" y={44 + i * 20} width={i === 1 ? 44 : 36} height="8" rx="4" fill={i === 1 ? p.accent : p.muted} />)}
          <rect x="88" y="32" width="168" height="16" rx="4" fill={p.panel} />
          <rect x="88" y="56" width="80" height="100" rx="8" fill={p.panel} />
          <rect x="98" y="66" width="60" height="44" rx="6" fill={p.accent} opacity="0.85" />
          <rect x="98" y="118" width="44" height="5" rx="2.5" fill={p.muted} />
          <rect x="98" y="130" width="30" height="5" rx="2.5" fill={p.muted} />
          <rect x="176" y="56" width="80" height="46" rx="8" fill={p.panel} />
          <rect x="176" y="110" width="80" height="46" rx="8" fill={p.panel} />
          <rect x="186" y="68" width="50" height="8" rx="3" fill={p.ink} />
          <rect x="186" y="122" width="38" height="8" rx="3" fill={p.ink} />
        </>
      )}
    </svg>
  );
};
