// Which call UI is busy right now (the 1-to-1 manager, the group manager), so one
// never rings or starts while the other has a call going. The database enforces
// "one call at a time" too; this just keeps the screen honest.
const busy = new Set<string>();

export function setCallBusy(who: string, on: boolean) {
  if (on) busy.add(who);
  else busy.delete(who);
}

/** True when a call UI other than `who` has a call going. */
export function otherCallBusy(who: string) {
  return [...busy].some((b) => b !== who);
}

/** Screen sharing needs getDisplayMedia, which phones don't have. */
export function canShareScreen() {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

/** Ask for a screen, window or tab to share. Throws if the person cancels. */
export async function pickScreen(): Promise<MediaStreamTrack> {
  const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
  const track = display.getVideoTracks()[0];
  // Keep text sharp rather than motion smooth.
  if ('contentHint' in track) track.contentHint = 'detail';
  return track;
}

/** A soft two-tone ring made with Web Audio (no sound files to download). Returns a stop function. */
export function startRinging(outgoing: boolean) {
  try {
    const ctx = new AudioContext();
    const beep = () => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = outgoing ? 440 : 660;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 1);
    };
    beep();
    const id = setInterval(beep, outgoing ? 3000 : 2000);
    return () => { clearInterval(id); ctx.close().catch(() => {}); };
  } catch {
    return () => {};
  }
}
