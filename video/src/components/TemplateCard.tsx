import { C, FONT } from '../theme';
import { GRID } from '../lib/layout';
import { CoverArt } from './CoverArt';
import { Icon } from './Icons';

export type TemplateData = { title: string; kind: string; creator: string; votes: number };

export const TEMPLATES: TemplateData[] = [
  { title: 'Nocturne', kind: 'SaaS landing', creator: 'mira.dev', votes: 128 },
  { title: 'Atlas', kind: 'Dev portfolio', creator: 'kenji', votes: 41 },
  { title: 'Ember', kind: 'Restaurant site', creator: 'lou.studio', votes: 86 },
  { title: 'Pulse', kind: 'Analytics dashboard', creator: 'aria', votes: 203 },
  { title: 'Paper', kind: 'Editorial blog', creator: 'theo', votes: 57 },
  { title: 'Orbit', kind: 'Agency site', creator: 'nadia.ux', votes: 94 },
  { title: 'Saffron', kind: 'Event landing', creator: 'raf', votes: 39 },
  { title: 'Monolith', kind: 'Docs site', creator: 'devon', votes: 162 },
];

/**
 * A template card as it appears on Yowkly: cover, name, creator and the vote pill.
 * `content` (0–1) fades the inside out when the card morphs into a chart bar;
 * `voted` (0–1) turns the pill lime; `votePop` scales it on the click.
 */
export const TemplateCardContent: React.FC<{
  index: number; data: TemplateData; votes: number; voted: number; votePop: number; content: number;
}> = ({ index, data, votes, voted, votePop, content }) => (
  <div style={{ position: 'absolute', inset: 0, opacity: content }}>
    <div style={{ position: 'absolute', left: 0, top: 0, right: 0, height: GRID.coverH, overflow: 'hidden', borderBottom: `1px solid ${C.line}` }}>
      <CoverArt variant={index} width={GRID.cardW} height={GRID.coverH} />
    </div>
    <div style={{ position: 'absolute', left: 16, right: 16, top: GRID.coverH + 14, display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontFamily: FONT.sans, fontSize: 15.5, fontWeight: 600, color: C.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {data.title} <span style={{ color: C.ink3, fontWeight: 500 }}>— {data.kind}</span>
        </span>
        <span style={{ fontFamily: FONT.sans, fontSize: 13, color: C.ink3 }}>@{data.creator}</span>
      </div>
      <div style={{
        height: 32, minWidth: 68, padding: '0 10px', borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        fontFamily: FONT.mono, fontSize: 13.5, fontWeight: 500,
        backgroundColor: voted > 0.5 ? C.accent : C.surface3,
        color: voted > 0.5 ? C.onAccent : C.ink2,
        boxShadow: voted > 0 ? `0 0 ${18 * voted}px rgba(212,255,58,${0.45 * voted})` : 'none',
        transform: `scale(${votePop})`,
      }}>
        <Icon name="bit" size={15} />{votes}
      </div>
    </div>
  </div>
);
