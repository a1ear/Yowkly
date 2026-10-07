import { C, FONT } from '../theme';
import { WIN } from '../lib/layout';
import { Icon, Logo } from './Icons';

/**
 * The app's header, as on the website: logo, centred nav, search, yowkbit balance.
 * `bits` is the balance; `bitsFlash` (0–1) lights the pill up when a vote is spent.
 */
export const TopBar: React.FC<{ active: string; bits: number; bitsFlash: number }> = ({ active, bits, bitsFlash }) => (
  <div style={{
    height: WIN.topBar, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center',
    padding: '0 28px', borderBottom: `1px solid ${C.line}`, backgroundColor: 'rgba(15,14,12,0.92)',
  }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Logo size={26} />
      <span style={{ fontFamily: FONT.serif, fontSize: 27, color: C.ink, letterSpacing: '-0.01em', lineHeight: 1 }}>Yowkly</span>
    </div>
    <nav style={{ display: 'flex', gap: 30, fontFamily: FONT.sans, fontSize: 15, fontWeight: 500 }}>
      {['Explore', 'Ranking', 'Community', 'Categories'].map((n) => (
        <span key={n} style={{ position: 'relative', color: n === active ? C.ink : C.ink3, padding: '6px 0' }}>
          {n}
          {n === active && <span style={{ position: 'absolute', left: 0, right: 0, bottom: -2, height: 2, borderRadius: 2, backgroundColor: C.accent }} />}
        </span>
      ))}
    </nav>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
      <div style={{
        height: 36, width: 250, borderRadius: 999, backgroundColor: C.surface2, display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 8px 0 14px', color: C.ink3, fontFamily: FONT.sans, fontSize: 14, whiteSpace: 'nowrap',
      }}>
        <Icon name="search" size={16} />Search templates
        <span style={{ marginLeft: 'auto', fontFamily: FONT.mono, fontSize: 11, padding: '2px 6px', borderRadius: 5, border: `1px solid ${C.line}` }}>Ctrl K</span>
      </div>
      <div style={{
        height: 36, display: 'flex', alignItems: 'center', gap: 7, padding: '0 12px', borderRadius: 999,
        backgroundColor: `rgba(212,255,58,${0.08 + bitsFlash * 0.5})`,
        boxShadow: `inset 0 0 0 1px rgba(212,255,58,${0.25 + bitsFlash * 0.5}), 0 0 ${bitsFlash * 24}px rgba(212,255,58,${bitsFlash * 0.6})`,
        color: bitsFlash > 0.5 ? C.onAccent : C.accent, fontFamily: FONT.mono, fontSize: 14, fontWeight: 500,
      }}>
        <Icon name="bit" size={16} />{bits}
      </div>
      <Icon name="bell" size={20} color={C.ink2} />
      <svg width={34} height={34} viewBox="0 0 34 34">
        <circle cx="17" cy="17" r="17" fill="#E9C46A" />
        <text x="17" y="22" textAnchor="middle" fontFamily={FONT.sans} fontWeight={700} fontSize="13" fill="#1A1712">JR</text>
      </svg>
    </div>
  </div>
);
