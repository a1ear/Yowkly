import { hash } from '@/lib/format';
import { mediaUrl } from '@/lib/labels';
import type { CategoryKind } from '@/lib/types';

const GROUNDS = ['#0A0C11', '#13100D', '#0D1210', '#120E14', '#0F0E0C'];
const PANELS = ['#141821', '#1B1712', '#141B17', '#1A1420', '#171613'];
const ACCENTS = ['#D4FF3A', '#8DBAFF', '#FF7D6E', '#FFC266', '#66D9A6', '#E8B89A'];

type Props = {
  seed: string;
  title: string;
  coverPath?: string | null;
  kind?: CategoryKind | null;
  alt?: string;
  className?: string;
  priority?: boolean;
  tall?: boolean;
};

/**
 * Real covers are required at publish time. The generative art is the fallback
 * for seed data and for images that fail to load, so a card never shows a hole.
 */
export function Cover({ seed, title, coverPath, kind, alt, className = '', priority, tall }: Props) {
  if (coverPath) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Supabase serves resized images; next/image adds a second hop
      <img
        src={mediaUrl(coverPath)}
        alt={alt ?? `Cover image for ${title}`}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
        className={`h-full w-full object-cover ${className}`}
      />
    );
  }
  return <GenerativeCover seed={seed} kind={kind} className={className} tall={tall} label={alt ?? `Preview art for ${title}`} />;
}

function GenerativeCover({ seed, kind, className, tall, label }: { seed: string; kind?: CategoryKind | null; className: string; tall?: boolean; label: string }) {
  const h = hash(seed);
  const ground = GROUNDS[h % GROUNDS.length];
  const panel = PANELS[h % PANELS.length];
  const accent = ACCENTS[(h >> 3) % ACCENTS.length];
  const alt = ACCENTS[(h >> 6) % ACCENTS.length];
  const line = '#262B38';
  const variant = kind === 'mobile' ? 'mobile' : kind === 'kit' || kind === 'component' ? 'kit' : kind === 'concept' ? 'concept' : (h >> 9) % 2 ? 'dashboard' : 'landing';
  const vb = tall ? '0 0 180 320' : '0 0 320 200';

  return (
    <svg viewBox={vb} preserveAspectRatio="xMidYMid slice" role="img" aria-label={label} className={`h-full w-full ${className}`}>
      <rect width="100%" height="100%" fill={ground} />
      {variant === 'dashboard' && (
        <g>
          <rect width="58" height="200" fill={panel} />
          <rect x="12" y="14" width="18" height="18" rx="5" fill={accent} />
          {[46, 62, 76, 90, 104].map((y, i) => <rect key={y} x="13" y={y} width={[30, 28, 32, 24, 30][i]} height="5" rx="2.5" fill={i === 0 ? '#8D97AD' : '#2E3546'} />)}
          {[70, 152, 234].map((x, i) => (
            <g key={x}>
              <rect x={x} y="14" width="76" height="42" rx="6" fill={panel} stroke={line} />
              <rect x={x + 8} y="22" width="22" height="4" rx="2" fill="#3A4254" />
              <rect x={x + 8} y="36" width={30 + ((h >> (i + 2)) % 20)} height="9" rx="3" fill="#E9ECF3" opacity=".85" />
            </g>
          ))}
          <rect x="70" y="64" width="160" height="124" rx="6" fill={panel} stroke={line} />
          <path d="M80 100H220M80 128H220M80 156H220" stroke={line} />
          <path d={`M80 170 L100 ${150 + (h % 14)} L120 ${154 + ((h >> 2) % 12)} L140 ${132 + ((h >> 4) % 16)} L160 ${138 + ((h >> 5) % 14)} L180 ${112 + ((h >> 6) % 16)} L200 ${118 + ((h >> 7) % 12)} L220 98 L220 180 L80 180Z`} fill={accent} opacity=".1" />
          <polyline points={`80,170 100,${150 + (h % 14)} 120,${154 + ((h >> 2) % 12)} 140,${132 + ((h >> 4) % 16)} 160,${138 + ((h >> 5) % 14)} 180,${112 + ((h >> 6) % 16)} 200,${118 + ((h >> 7) % 12)} 220,98`} fill="none" stroke={accent} strokeWidth="2" />
          <rect x="238" y="64" width="74" height="124" rx="6" fill={panel} stroke={line} />
          <circle cx="275" cy="112" r="22" fill="none" stroke="#232A38" strokeWidth="8" />
          <circle cx="275" cy="112" r="22" fill="none" stroke={accent} strokeWidth="8" strokeDasharray={`${60 + (h % 50)} 200`} transform="rotate(-90 275 112)" />
          <circle cx="275" cy="112" r="22" fill="none" stroke={alt} strokeWidth="8" strokeDasharray="26 200" strokeDashoffset={-(62 + (h % 50))} transform="rotate(-90 275 112)" />
          {[150, 162, 174].map((y, i) => <rect key={y} x="250" y={y} width={[50, 36, 44][i]} height="4" rx="2" fill="#2E3546" />)}
        </g>
      )}
      {variant === 'landing' && (
        <g>
          <rect x="0" y="0" width="320" height="22" fill={panel} />
          <rect x="14" y="8" width="26" height="6" rx="3" fill={accent} />
          {[200, 230, 260].map((x) => <rect key={x} x={x} y="9" width="20" height="4" rx="2" fill="#3A4254" />)}
          <text x="18" y="78" fontFamily="Georgia, serif" fontSize="34" fill="#F2EFE8">{['Build', 'Make', 'Ship', 'Studio'][h % 4]}</text>
          <text x="18" y="112" fontFamily="Georgia, serif" fontSize="34" fontStyle="italic" fill={accent}>{['loudly.', 'calmly.', 'today.', 'better.'][(h >> 2) % 4]}</text>
          <rect x="18" y="128" width="110" height="5" rx="2.5" fill="#3A4254" />
          <rect x="18" y="138" width="86" height="5" rx="2.5" fill="#2E3546" />
          <rect x="18" y="154" width="52" height="16" rx="5" fill={accent} />
          <rect x="176" y="40" width="126" height="140" rx="8" fill={panel} stroke={line} />
          <circle cx="239" cy="100" r={26 + (h % 10)} fill={alt} opacity=".85" />
          <rect x="190" y="150" width="98" height="6" rx="3" fill="#3A4254" />
        </g>
      )}
      {variant === 'mobile' && (
        <g>
          {(tall ? [[34, 26]] : [[34, 18], [128, 34], [222, 18]]).map(([x, y], i) => (
            <g key={x} transform={tall ? 'translate(0 0) scale(1.45)' : undefined}>
              <rect x={x} y={y} width="66" height="140" rx="12" fill="#0B0B0A" stroke="#3A3833" strokeWidth="2" />
              <rect x={x + 5} y={y + 6} width="56" height="128" rx="8" fill={panel} />
              <rect x={x + 26} y={y + 9} width="14" height="3" rx="1.5" fill="#0B0B0A" />
              <rect x={x + 10} y={y + 20} width="30" height="5" rx="2.5" fill="#E9ECF3" opacity=".85" />
              <rect x={x + 10} y={y + 32} width="46" height={i === 1 ? 46 : 30} rx="6" fill={i === 1 ? accent : alt} opacity={i === 1 ? 1 : 0.8} />
              {[0, 1, 2].map((r) => <rect key={r} x={x + 10} y={y + (i === 1 ? 86 : 70) + r * 13} width="46" height="8" rx="3" fill="#2E3546" />)}
              <rect x={x + 10} y={y + 120} width="46" height="8" rx="4" fill={accent} opacity=".9" />
            </g>
          ))}
        </g>
      )}
      {variant === 'kit' && (
        <g>
          {Array.from({ length: 12 }, (_, i) => {
            const x = 14 + (i % 4) * 76;
            const y = 14 + Math.floor(i / 4) * 60;
            const t = (h >> i) % 4;
            return (
              <g key={i}>
                <rect x={x} y={y} width="68" height="52" rx="8" fill={panel} stroke={line} opacity=".95" />
                {t === 0 && <rect x={x + 12} y={y + 18} width="44" height="16" rx="8" fill={accent} />}
                {t === 1 && <><rect x={x + 16} y={y + 20} width="26" height="12" rx="6" fill="#2E3546" /><circle cx={x + 36} cy={y + 26} r="5" fill={alt} /></>}
                {t === 2 && <><rect x={x + 10} y={y + 12} width="48" height="6" rx="3" fill="#3A4254" /><rect x={x + 10} y={y + 24} width="36" height="6" rx="3" fill="#2E3546" /><rect x={x + 10} y={y + 36} width="22" height="6" rx="3" fill={accent} /></>}
                {t === 3 && <circle cx={x + 34} cy={y + 26} r="13" fill="none" stroke={alt} strokeWidth="4" />}
              </g>
            );
          })}
        </g>
      )}
      {variant === 'concept' && (
        <g fill="none" stroke="#3A4254" strokeWidth="1.5" strokeDasharray="4 4">
          <rect x="20" y="20" width="280" height="160" rx="10" />
          <rect x="36" y="40" width="120" height="70" rx="6" stroke={accent} />
          <path d="M36 128h160M36 144h120M36 160h90" />
          <rect x="176" y="40" width="108" height="120" rx="6" />
          <circle cx="230" cy="92" r="24" stroke={alt} />
        </g>
      )}
    </svg>
  );
}
