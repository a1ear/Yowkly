import { ImageResponse } from 'next/og';

// The default social preview for every page that doesn't set its own
// (template pages use their cover, profiles their cover photo).
export const alt = 'Yowkly: For Devs by Devs. Web templates, app designs and UI kits, voted by developers.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, backgroundColor: '#0F0E0C', backgroundImage: 'radial-gradient(circle at 88% 8%, rgba(212,255,58,0.26) 0%, rgba(212,255,58,0) 48%)', color: '#F2EFE8' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ position: 'relative', width: 64, height: 64, display: 'flex' }}>
            <div style={{ position: 'absolute', left: 4, top: 20, width: 38, height: 38, borderRadius: 8, border: '4px solid #B8B3A8', display: 'flex' }} />
            <div style={{ position: 'absolute', left: 22, top: 4, width: 38, height: 38, borderRadius: 8, background: '#D4FF3A', display: 'flex' }} />
          </div>
          <span style={{ fontSize: 44, letterSpacing: -1 }}>Yowkly</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'flex', fontSize: 120, fontWeight: 700, letterSpacing: -5, lineHeight: 1 }}>
            For Devs&nbsp;<span style={{ color: '#D4FF3A' }}>by</span>&nbsp;Devs.
          </div>
          <div style={{ display: 'flex', fontSize: 34, color: '#B8B3A8' }}>Web templates, app designs and UI kits, voted by developers.</div>
        </div>
      </div>
    ),
    size,
  );
}
