import { C, FONT } from '../theme';
import { mix } from '../lib/motion';
import { SIDEBAR, SIDEBAR_ITEMS, WIN, sidebarItemTop } from '../lib/layout';
import { Icon } from './Icons';

/**
 * Category navigation. The active highlight is one pill that slides between
 * items (`activeFrom` → `activeTo` by `activeT`, a spring), instead of jumping.
 * `hover` is the index under the cursor and `hoverT` its 0–1 strength.
 */
export const Sidebar: React.FC<{ activeFrom: number; activeTo: number; activeT: number; hover: number; hoverT: number; press: number }> = ({
  activeFrom, activeTo, activeT, hover, hoverT, press,
}) => {
  const pillTop = mix(sidebarItemTop(activeFrom), sidebarItemTop(activeTo), activeT);
  // The pill stretches a little while travelling, then settles (squash and stretch).
  const travel = Math.sin(Math.min(1, Math.max(0, activeT)) * Math.PI);
  const active = activeT > 0.5 ? activeTo : activeFrom;
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: WIN.sidebar, borderRight: `1px solid ${C.line}`, backgroundColor: C.canvas }}>
      <div style={{
        position: 'absolute', left: SIDEBAR.padX, top: SIDEBAR.padTop, height: SIDEBAR.label, display: 'flex', alignItems: 'center',
        fontFamily: FONT.mono, fontSize: 11.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.ink3,
      }}>Categories</div>
      {/* hover wash */}
      <div style={{
        position: 'absolute', left: SIDEBAR.padX - 6, right: SIDEBAR.padX - 6, top: sidebarItemTop(hover) + 3, height: SIDEBAR.item - 6,
        borderRadius: 12, backgroundColor: C.surface2, opacity: hoverT * (hover === active ? 0 : 1),
        transform: `scale(${1 - press * 0.03})`,
      }} />
      {/* sliding active pill */}
      <div style={{
        position: 'absolute', left: SIDEBAR.padX - 6, right: SIDEBAR.padX - 6, top: pillTop + 3 - travel * 3, height: SIDEBAR.item - 6 + travel * 6,
        borderRadius: 12, backgroundColor: C.accent, boxShadow: `0 6px 24px rgba(212,255,58,${0.18 + travel * 0.2})`,
      }} />
      {SIDEBAR_ITEMS.map((item, i) => {
        const on = i === active;
        return (
          <div key={item.label} style={{
            position: 'absolute', left: SIDEBAR.padX + 8, right: SIDEBAR.padX, top: sidebarItemTop(i), height: SIDEBAR.item,
            display: 'flex', alignItems: 'center', gap: 12, fontFamily: FONT.sans, fontSize: 15, fontWeight: on ? 600 : 500,
            color: on ? C.onAccent : i === hover && hoverT > 0.5 ? C.ink : C.ink2,
          }}>
            <Icon name={item.icon} size={18} />{item.label}
          </div>
        );
      })}
      <div style={{ position: 'absolute', left: SIDEBAR.padX, right: SIDEBAR.padX, top: sidebarItemTop(SIDEBAR_ITEMS.length) + 18, height: 1, backgroundColor: C.line }} />
      {([['trophy', 'Ranking'], ['comment', 'Community'], ['upload', 'Publish']] as const).map(([icon, label], i) => (
        <div key={label} style={{
          position: 'absolute', left: SIDEBAR.padX + 8, top: sidebarItemTop(SIDEBAR_ITEMS.length) + 36 + i * SIDEBAR.item, height: SIDEBAR.item,
          display: 'flex', alignItems: 'center', gap: 12, fontFamily: FONT.sans, fontSize: 15, fontWeight: 500, color: C.ink3,
        }}>
          <Icon name={icon} size={18} />{label}
        </div>
      ))}
    </div>
  );
};
