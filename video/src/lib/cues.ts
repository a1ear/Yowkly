import { CARD_COUNT } from './layout';

/**
 * Every beat of the film, in frames (30 fps). Scenes, the cursor and the
 * captions all read from here, so retiming one beat keeps everything in sync.
 */
export const CUE = {
  // Scene 1 · Intro & hook (0–150)
  line1: 8,
  line2: 26,
  highlight: 52,
  answer: 74,
  introExit: 98,
  windowIn: 104,
  windowSettled: 156,

  // Scene 2 · Core feature (150–450)
  dashCaption: 152,
  cursorIn: 160,
  cursorAtWebsites: 198,
  websitesClick: 206,
  cardsIn: 216,
  cardStagger: 5,
  cursorAtCard: 296,
  cursorAtVote: 330,
  voteClick: 338,
  cursorAtCard6: 398,
  cursorOutStart: 424,
  cursorOutEnd: 450,
  dashCaptionExit: 432,

  // Scene 3 · Value realisation (450–750)
  valueCaption: 458,
  headerOut: 460,
  morph: 466,
  morphStagger: 4,
  chartIn: 500,
  panelIn: 506,
  counterFrom: 520,
  counterTo: 660,
  barLabels: 540,
  trendFrom: 560,
  trendTo: 624,
  valueCaptionExit: 728,

  // Scene 4 · Outro & CTA (750–900)
  recedeFrom: 750,
  recedeTo: 804,
  logoDrawFrom: 786,
  logoDrawTo: 818,
  logoDrop: 798,
  wordmark: 812,
  tagline: 834,
  cta: 848,
  pulseFrom: 860,
  outroCursorIn: 852,
  outroCursorAtCta: 880,
} as const;

/** When card `i` springs into the grid. */
export const cardInAt = (i: number) => CUE.cardsIn + i * CUE.cardStagger;
/** When card `i` starts turning into its chart bar (left to right). */
export const morphAt = (i: number) => CUE.morph + (i % CARD_COUNT) * CUE.morphStagger;
