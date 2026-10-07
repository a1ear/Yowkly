import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { COPY } from './theme';
import { CUE } from './lib/cues';
import { EASE, SPRING, along, progress, springAt, type Key } from './lib/motion';
import { WEBSITES_INDEX, WIN, cardCenter, sidebarItemCenter, voteButtonCenter } from './lib/layout';
import { Background } from './components/Background';
import { AppWindow } from './components/AppWindow';
import { CardField } from './components/CardField';
import { Cursor } from './components/Cursor';
import { SceneCaption } from './components/SceneCaption';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { DashboardScene } from './scenes/DashboardScene';
import { IntroScene } from './scenes/IntroScene';
import { CTA_CENTER, OutroScene } from './scenes/OutroScene';
import { ValueBackdrop, ValueOverlay } from './scenes/ValueScene';

// ── The cursor's route through Scene 2, built from the layout grid.
const websites = sidebarItemCenter(WEBSITES_INDEX);
const card1 = cardCenter(1);
const vote1 = voteButtonCenter(1);
const card6 = cardCenter(6);
const DEMO_PATH: Key[] = [
  { f: CUE.cursorIn, x: 1580, y: 990 },
  { f: CUE.cursorAtWebsites, ...websites },
  { f: CUE.websitesClick + 50, ...websites },
  { f: CUE.cursorAtCard, ...card1 },
  { f: CUE.cursorAtCard + 14, x: card1.x + 6, y: card1.y + 4 },
  { f: CUE.cursorAtVote, ...vote1 },
  { f: CUE.voteClick + 22, ...vote1 },
  { f: CUE.cursorAtCard6, ...card6 },
  { f: CUE.cursorOutStart, x: card6.x + 8, y: card6.y + 6 },
  { f: CUE.cursorOutEnd, x: 1760, y: 1010 },
];
const OUTRO_PATH: Key[] = [
  { f: CUE.outroCursorIn, x: 1520, y: 1010 },
  // Rest on the arrow at the button's right end.
  { f: CUE.outroCursorAtCta, x: CTA_CENTER.x + 166, y: CTA_CENTER.y + 8 },
  { f: 899, x: CTA_CENTER.x + 160, y: CTA_CENTER.y + 4 },
];

/** 0 → 1 → 0 around a click: the press of the button under the cursor. */
const pressAt = (frame: number, click: number) =>
  interpolate(frame, [click - 3, click, click + 6], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
/** The click ring: 0 → 1 over 22 frames after the click, -1 when not showing. */
const rippleAt = (frame: number, click: number) => (frame >= click && frame < click + 22 ? progress(frame, click, click + 22) : -1);

/**
 * Yowkly · 30-second product demo (1920×1080, 30 fps).
 *
 *  0–5 s   Scene 1  Kinetic hook, then the app window floats up into place.
 *  5–15 s  Scene 2  Sidebar click → "Websites"; cards spring into the grid; a vote.
 *  15–25 s Scene 3  Each card morphs into a chart bar; "Hours saved" ticks up.
 *  25–30 s Scene 4  The app recedes and blurs; the logo draws in; the CTA breathes.
 *
 * The app window is one persistent object across all four scenes, so the story
 * reads as a single continuous camera move rather than four separate clips.
 */
export const YowklyDemo: React.FC = () => {
  const frame = useCurrentFrame();

  // ── App window: floats in (Scene 1), rests (2–3), recedes behind a blur (4).
  const float = springAt(frame, CUE.windowIn, SPRING.heavy, CUE.windowSettled - CUE.windowIn);
  const recede = progress(frame, CUE.recedeFrom, CUE.recedeTo, EASE.inOut);
  const windowVisible = frame >= CUE.windowIn - 1;
  const windowStyle: React.CSSProperties = {
    opacity: Math.min(1, float * 2) * (1 - recede * 0.72),
    transform: [
      'perspective(2400px)',
      `translateY(${(1 - float) * 280 + recede * 36}px)`,
      `rotateX(${(1 - float) * 16}deg)`,
      `scale(${(0.86 + 0.14 * float) * (1 - recede * 0.3)})`,
    ].join(' '),
    transformOrigin: '50% 40%',
    filter: recede > 0 ? `blur(${recede * 16}px) saturate(${1 - recede * 0.4})` : undefined,
  };

  // ── Sidebar interaction.
  const sidebarPress = pressAt(frame, CUE.websitesClick);
  const hoverT = progress(frame, CUE.cursorAtWebsites - 8, CUE.cursorAtWebsites + 2) * (1 - progress(frame, CUE.websitesClick, CUE.websitesClick + 8));
  const activeT = springAt(frame, CUE.websitesClick + 1, SPRING.snappy);

  // ── Yowkbit balance: one bit spent on the vote.
  const bits = frame >= CUE.voteClick + 2 ? 99 : 100;
  const bitsFlash = interpolate(frame, [CUE.voteClick + 2, CUE.voteClick + 6, CUE.voteClick + 30], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  // ── Cursor.
  const inDemo = frame >= CUE.cursorIn && frame <= CUE.cursorOutEnd;
  const inOutro = frame >= CUE.outroCursorIn;
  const demoCursor = along(frame, DEMO_PATH);
  const outroCursor = along(frame, OUTRO_PATH);
  const cursorOpacity = inDemo
    ? progress(frame, CUE.cursorIn, CUE.cursorIn + 12) * (1 - progress(frame, CUE.cursorOutEnd - 14, CUE.cursorOutEnd))
    : inOutro ? progress(frame, CUE.outroCursorIn, CUE.outroCursorIn + 12) : 0;
  const press = pressAt(frame, CUE.websitesClick) + pressAt(frame, CUE.voteClick);
  const ripple = Math.max(rippleAt(frame, CUE.websitesClick), rippleAt(frame, CUE.voteClick));
  const ctaHover = progress(frame, CUE.outroCursorAtCta - 6, CUE.outroCursorAtCta + 6);

  const path = frame < CUE.websitesClick + 2 ? '/explore' : frame < CUE.headerOut ? '/c/websites' : '/dashboard/insights';

  return (
    <AbsoluteFill>
      <Background />
      <IntroScene />

      {windowVisible && (
        <AppWindow style={windowStyle} path={path}>
          <TopBar active="Explore" bits={bits} bitsFlash={bitsFlash} />
          <div style={{ position: 'absolute', left: 0, right: 0, top: WIN.topBar, bottom: 0 }}>
            <Sidebar activeFrom={0} activeTo={WEBSITES_INDEX} activeT={activeT} hover={WEBSITES_INDEX} hoverT={hoverT} press={sidebarPress} />
            <div style={{ position: 'absolute', left: WIN.sidebar, top: 0, right: 0, bottom: 0, overflow: 'hidden' }}>
              <DashboardScene />
              <ValueBackdrop />
              <CardField />
              <ValueOverlay />
            </div>
          </div>
        </AppWindow>
      )}

      <SceneCaption eyebrow={COPY.dashboardEyebrow} headline={COPY.dashboardHeadline} enter={CUE.dashCaption} exit={CUE.dashCaptionExit} />
      <SceneCaption eyebrow={COPY.valueEyebrow} headline={COPY.valueHeadline} enter={CUE.valueCaption} exit={CUE.valueCaptionExit} />

      <OutroScene hover={ctaHover} />

      {cursorOpacity > 0 && (
        <Cursor
          x={inOutro ? outroCursor.x : demoCursor.x}
          y={inOutro ? outroCursor.y : demoCursor.y}
          opacity={cursorOpacity}
          press={inOutro ? 0 : press}
          ripple={inOutro ? -1 : ripple}
        />
      )}
    </AbsoluteFill>
  );
};
