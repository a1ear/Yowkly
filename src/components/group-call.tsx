'use client';
import { useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { realtimeClient } from '@/lib/supabase/browser';
import { declineGroupCall, endCall, groupCallPulse, incomingCall, joinGroupCall, startGroupCall, type CallPerson } from '@/app/actions/calls';
import { START_GROUP_CALL_EVENT } from '@/lib/events';
import { canShareScreen, otherCallBusy, pickScreen, setCallBusy, startRinging } from '@/lib/call-state';
import { Avatar } from './bits';
import { Icon } from './icons';
import { useToast } from './toast';

type Phase = 'idle' | 'incoming' | 'joining' | 'active';
type GroupCall = { id: string; conversationId: string; title: string; video: boolean; by?: string };
type Signal =
  | { type: 'hello'; from: string; session: string; person: CallPerson; to?: string }
  | { type: 'offer' | 'answer'; from: string; session: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice'; from: string; to: string; candidate: RTCIceCandidateInit }
  | { type: 'bye'; from: string };
type Peer = { pc: RTCPeerConnection; stream: MediaStream; session: string; created: number; ice: RTCIceCandidateInit[]; offering: boolean };
type Tile = { userId: string; person: CallPerson | null; video: boolean; connected: boolean };

const WHO = 'group';
const RING_TIMEOUT = 45_000;
const PULSE_MS = 5_000;
const CAMERA = { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: 'user' } as const;

/**
 * The connections of one group call. Every pair of people connects directly
 * (a "mesh"): fine for up to 6 people, with no media server in between.
 * Who sends the offer is decided by comparing user ids, so two people never
 * offer to each other at the same time. Set-up messages go over the call's
 * private Realtime channel, which only people who joined the call may use.
 */
class Mesh {
  peers = new Map<string, Peer>();
  roster = new Map<string, CallPerson>();
  els = new Map<string, HTMLVideoElement>();
  session = crypto.randomUUID();
  ch: RealtimeChannel | null = null;
  ice: RTCIceServer[] = [];
  local: MediaStream | null = null;
  screen: MediaStreamTrack | null = null;

  constructor(private me: CallPerson, private onChange: () => void, private onConnected: () => void) {}

  private send(s: Signal) { this.ch?.send({ type: 'broadcast', event: 'signal', payload: s }); }
  hello(to?: string) { this.send({ type: 'hello', from: this.me.user_id, session: this.session, person: this.me, to }); }

  audioTrack() { return this.local?.getAudioTracks()[0] ?? null; }
  cameraTrack() { return this.local?.getVideoTracks()[0] ?? null; }
  /** What goes out in the video slot: the shared screen, else the camera, else nothing. */
  videoTrack() { return this.screen ?? this.cameraTrack(); }

  async open(callId: string) {
    const res = await fetch('/api/calls/ice').then((r) => r.json()).catch(() => ({ iceServers: [] }));
    this.ice = res.iceServers ?? [];
    const db = await realtimeClient();
    await new Promise<void>((resolve) => {
      this.ch = db.channel(`call:${callId}`, { config: { private: true, broadcast: { self: false } } })
        .on('broadcast', { event: 'signal' }, (msg: { payload?: unknown }) => { this.onSignal(msg.payload as Signal); })
        .subscribe((status: string) => { if (status === 'SUBSCRIBED') resolve(); });
    });
    this.hello();
  }

  close() {
    this.send({ type: 'bye', from: this.me.user_id });
    for (const id of [...this.peers.keys()]) this.drop(id);
    const ch = this.ch;
    this.ch = null;
    if (ch) realtimeClient().then((db) => db.removeChannel(ch));
  }

  drop(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    p.pc.close();
    this.peers.delete(id);
    const el = this.els.get(id);
    if (el) el.srcObject = null;
    this.onChange();
  }

  /** Attach a person's video element (audio plays through it too, even with no picture). */
  bind(id: string, el: HTMLVideoElement | null) {
    if (!el) { this.els.delete(id); return; }
    this.els.set(id, el);
    const p = this.peers.get(id);
    if (p && el.srcObject !== p.stream) el.srcObject = p.stream;
  }

  /** Swap what goes out in the video slot on every connection (camera on/off, screen sharing). */
  setVideo(track: MediaStreamTrack | null) {
    for (const p of this.peers.values()) {
      const t = p.pc.getTransceivers().find((x) => x.receiver.track.kind === 'video');
      t?.sender.replaceTrack(track).catch(() => {});
    }
  }

  /** The check-in result: who the server says is in the call. */
  setRoster(people: CallPerson[]) {
    const ids = new Set(people.map((p) => p.user_id));
    this.roster = new Map(people.filter((p) => p.user_id !== this.me.user_id).map((p) => [p.user_id, p]));
    // Someone the server dropped (left, closed their tab) goes, unless they connected only moments ago.
    for (const [id, p] of this.peers) if (!ids.has(id) && Date.now() - p.created > 10_000) this.drop(id);
    // Anyone in the call we aren't connected to yet: say hello again.
    if ([...this.roster.keys()].some((id) => this.peers.get(id)?.pc.connectionState !== 'connected')) this.hello();
    this.onChange();
  }

  tiles(): Tile[] {
    const ids = new Set([...this.roster.keys(), ...this.peers.keys()]);
    ids.delete(this.me.user_id);
    return [...ids].map((id) => {
      const p = this.peers.get(id);
      return {
        userId: id,
        person: this.roster.get(id) ?? null,
        video: Boolean(p?.stream.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted)),
        connected: p?.pc.connectionState === 'connected',
      };
    });
  }

  private peer(id: string, session: string, offerer: boolean): Peer {
    let p = this.peers.get(id);
    const stale = p && (p.session !== session || ['failed', 'closed'].includes(p.pc.connectionState)
      || (p.pc.connectionState !== 'connected' && Date.now() - p.created > 15_000));
    if (p && stale) { this.drop(id); p = undefined; }
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const stream = new MediaStream();
    const peer: Peer = { pc, stream, session, created: Date.now(), ice: [], offering: false };
    this.peers.set(id, peer);
    if (offerer) {
      // The offerer opens an audio and a video slot, so cameras and screens can come and go without renegotiating.
      pc.addTransceiver('audio', { direction: 'sendrecv' }).sender.replaceTrack(this.audioTrack()).catch(() => {});
      pc.addTransceiver('video', { direction: 'sendrecv' }).sender.replaceTrack(this.videoTrack()).catch(() => {});
    }
    pc.ontrack = (e) => {
      stream.addTrack(e.track);
      const el = this.els.get(id);
      if (el && el.srcObject !== stream) el.srcObject = stream;
      e.track.onmute = this.onChange; e.track.onunmute = this.onChange; e.track.onended = this.onChange;
      this.onChange();
    };
    pc.onicecandidate = (e) => { if (e.candidate) this.send({ type: 'ice', from: this.me.user_id, to: id, candidate: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') this.onConnected();
      this.onChange();
    };
    this.onChange();
    return peer;
  }

  private async flush(p: Peer) {
    for (const c of p.ice.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
  }

  private async onSignal(s: Signal) {
    const me = this.me.user_id;
    if (!s || s.from === me || ('to' in s && s.to && s.to !== me)) return;
    try {
      if (s.type === 'bye') {
        this.drop(s.from);
        this.roster.delete(s.from);
        this.onChange();
      } else if (s.type === 'hello') {
        this.roster.set(s.from, s.person);
        const offerer = me < s.from;
        const p = this.peer(s.from, s.session, offerer);
        if (offerer) {
          if (p.offering || p.pc.localDescription || p.pc.signalingState !== 'stable') return;
          p.offering = true;
          const offer = await p.pc.createOffer();
          await p.pc.setLocalDescription(offer);
          this.send({ type: 'offer', from: me, session: this.session, to: s.from, sdp: offer });
        } else if (!s.to) {
          this.hello(s.from); // tell the newcomer about us, so they send the offer
        }
        this.onChange();
      } else if (s.type === 'offer') {
        let p = this.peers.get(s.from);
        if (p?.pc.remoteDescription) { this.drop(s.from); p = undefined; }
        p = p ?? this.peer(s.from, s.session, false);
        await p.pc.setRemoteDescription(s.sdp);
        for (const t of p.pc.getTransceivers()) {
          await t.sender.replaceTrack(t.receiver.track.kind === 'audio' ? this.audioTrack() : this.videoTrack()).catch(() => {});
          t.direction = 'sendrecv';
        }
        const answer = await p.pc.createAnswer();
        await p.pc.setLocalDescription(answer);
        this.send({ type: 'answer', from: me, session: this.session, to: s.from, sdp: answer });
        await this.flush(p);
      } else if (s.type === 'answer') {
        const p = this.peers.get(s.from);
        if (p && p.pc.signalingState === 'have-local-offer') { await p.pc.setRemoteDescription(s.sdp); await this.flush(p); }
      } else if (s.type === 'ice') {
        const p = this.peers.get(s.from);
        if (!p) return;
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(s.candidate).catch(() => {});
        else p.ice.push(s.candidate);
      }
    } catch {
      // A broken handshake with one person: drop it; the next check-in says hello again.
      this.drop(s.from);
    }
  }

  preview(): MediaStream | null {
    const v = this.videoTrack();
    return v ? new MediaStream([v]) : null;
  }
}

/**
 * Group voice and video calls (up to 6 people) with screen sharing. Rings you
 * when a call starts in one of your groups, and runs the call panel.
 */
export function GroupCallManager({ me }: { me: { id: string; username: string; display_name: string; avatar_path: string | null } }) {
  const toast = useToast();
  const toastRef = useRef(toast);
  useEffect(() => { toastRef.current = toast; }, [toast]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [call, setCall] = useState<GroupCall | null>(null);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [muted, setMuted] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [big, setBig] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const meshRef = useRef<Mesh | null>(null);
  const selfEl = useRef<HTMLVideoElement | null>(null);
  const stopRing = useRef<() => void>(() => {});
  const ringTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const phaseRef = useRef<Phase>('idle');
  const callRef = useRef<GroupCall | null>(null);
  useEffect(() => {
    phaseRef.current = phase;
    callRef.current = call;
    setCallBusy(WHO, phase !== 'idle');
  }, [phase, call]);

  // Everything below runs from events and timers, through refs, so it's set up once.
  const api = useRef<{
    finish: (message?: string, leave?: boolean) => void;
    begin: (conversationId: string, title: string, video: boolean, callId?: string) => Promise<void>;
  } | null>(null);

  useEffect(() => {
    const person: CallPerson = { user_id: me.id, username: me.username, display_name: me.display_name, avatar_path: me.avatar_path };
    let pulse: ReturnType<typeof setInterval> | undefined;
    const toast = (t: { text: string; tone: 'ok' | 'error' }) => toastRef.current(t);

    const finish = (message?: string, leave = true) => {
      stopRing.current();
      clearTimeout(ringTimer.current);
      clearInterval(pulse);
      const c = callRef.current;
      const mesh = meshRef.current;
      meshRef.current = null;
      if (mesh) {
        mesh.close();
        mesh.local?.getTracks().forEach((t) => t.stop());
        mesh.screen?.stop();
      }
      if (c && leave && mesh) endCall(c.id);
      callRef.current = null;
      phaseRef.current = 'idle';
      setCall(null); setPhase('idle'); setTiles([]); setMuted(false); setCamOn(false); setSharing(false); setBig(false); setStartedAt(null);
      if (message) toast({ text: message, tone: 'ok' });
    };

    const begin = async (conversationId: string, title: string, video: boolean, callId?: string) => {
      if (meshRef.current || phaseRef.current === 'joining') return toast({ text: 'You are already in a call.', tone: 'error' });
      if (otherCallBusy(WHO)) return toast({ text: 'You are already in a call.', tone: 'error' });
      stopRing.current();
      clearTimeout(ringTimer.current);
      phaseRef.current = 'joining';
      setPhase('joining');
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: video ? CAMERA : false });
      } catch {
        if (callId) await declineGroupCall(callId);
        finish();
        return toast({ text: 'Allow microphone access (and camera for video) to join the call.', tone: 'error' });
      }
      let id = callId;
      if (callId) {
        const r = await joinGroupCall(callId);
        if (!r.ok) { stream.getTracks().forEach((t) => t.stop()); finish(); return toast({ text: r.error, tone: 'error' }); }
      } else {
        const r = await startGroupCall(conversationId, video);
        if (!r.ok) { stream.getTracks().forEach((t) => t.stop()); finish(); return toast({ text: r.error, tone: 'error' }); }
        id = r.data.id;
      }
      const c: GroupCall = { id: id!, conversationId, title, video };
      const mesh = new Mesh(person, () => { if (meshRef.current === mesh) setTiles(mesh.tiles()); }, () => { stopRing.current(); setStartedAt((t) => t ?? Date.now()); });
      mesh.local = stream;
      meshRef.current = mesh;
      callRef.current = c;
      setCall(c); setCamOn(video); setPhase('active');
      phaseRef.current = 'active';
      await mesh.open(c.id);
      // Check in with the server: keeps us in the call and tells us who else is in it.
      const check = async () => {
        if (meshRef.current !== mesh) return;
        const s = await groupCallPulse(c.id);
        if (meshRef.current !== mesh) return;
        if (!s || !['ringing', 'active'].includes(s.status)) return finish(s?.status === 'missed' ? 'Nobody joined the call.' : 'The call ended.', false);
        mesh.setRoster(s.participants);
      };
      check();
      pulse = setInterval(check, PULSE_MS);
    };

    const ring = async () => {
      if (phaseRef.current !== 'idle' || otherCallBusy(WHO)) return;
      const inc = await incomingCall();
      if (!inc?.is_group || phaseRef.current !== 'idle' || otherCallBusy(WHO)) return;
      const c: GroupCall = { id: inc.id, conversationId: inc.conversation_id, title: inc.group_title ?? 'Group', video: inc.video, by: inc.caller_display_name };
      callRef.current = c;
      phaseRef.current = 'incoming';
      setCall(c); setPhase('incoming');
      stopRing.current = startRinging(false);
      ringTimer.current = setTimeout(() => { if (phaseRef.current === 'incoming') finish(); }, Math.max(1000, RING_TIMEOUT - (Date.now() - Date.parse(inc.created_at))));
    };

    api.current = { finish, begin };

    let cancelled = false;
    let cleanupCh = () => {};
    realtimeClient().then((db) => {
      if (cancelled) return;
      const ch = db.channel(`group-calls-${me.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_participants', filter: `user_id=eq.${me.id}` }, () => { ring(); })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls' }, (p: { new: Record<string, unknown> }) => {
          const c = callRef.current;
          if (!c || p.new.id !== c.id || ['ringing', 'active'].includes(String(p.new.status))) return;
          finish(phaseRef.current === 'incoming' ? undefined : 'The call ended.', false);
        })
        .subscribe();
      cleanupCh = () => { db.removeChannel(ch); };
    });
    ring(); // a group call may already be ringing when the page loads

    const onStart = (e: Event) => {
      const d = (e as CustomEvent).detail as { conversationId: string; video: boolean; title: string };
      begin(d.conversationId, d.title, d.video);
    };
    window.addEventListener(START_GROUP_CALL_EVENT, onStart);
    // Closing the tab leaves the call.
    const bye = () => { const c = callRef.current; if (c && meshRef.current) { meshRef.current.close(); navigator.sendBeacon?.('/api/calls/end', JSON.stringify({ id: c.id })); } };
    window.addEventListener('pagehide', bye);
    return () => {
      cancelled = true;
      cleanupCh();
      clearInterval(pulse);
      window.removeEventListener(START_GROUP_CALL_EVENT, onStart);
      window.removeEventListener('pagehide', bye);
    };
  }, [me.id, me.username, me.display_name, me.avatar_path]);

  // Your own picture: the shared screen, or the camera.
  useEffect(() => {
    if (selfEl.current) selfEl.current.srcObject = meshRef.current?.preview() ?? null;
  }, [camOn, sharing, phase, big]);

  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (phase === 'idle' || !call) return null;

  if (phase === 'incoming') {
    return (
      <div role="alertdialog" aria-label={`${call.by ?? 'Someone'} started a call in ${call.title}`}
           className="msg-in-theirs fixed top-20 left-1/2 z-[60] flex w-[min(400px,calc(100vw-24px))] -translate-x-1/2 items-center gap-3 rounded-2xl bg-surface-1 p-4 shadow-e3 ring-1 ring-line">
        <span className="relative inline-flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-surface-2 text-accent-ink">
          <Icon name={call.video ? 'video' : 'phoneCall'} size={22} />
          <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full ring-2 ring-accent" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate font-semibold">{call.title}</span>
          <span className="truncate text-[13px] text-ink-3">{call.by ?? 'Someone'} started a {call.video ? 'video' : 'voice'} call</span>
        </span>
        <button type="button" onClick={() => { const id = call.id; api.current?.finish(); declineGroupCall(id); }} aria-label="Decline call"
                className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-danger text-white hover:opacity-90">
          <Icon name="phoneOff" size={20} />
        </button>
        <button type="button" onClick={() => api.current?.begin(call.conversationId, call.title, call.video, call.id)} aria-label="Join call"
                className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-success text-white hover:opacity-90">
          <Icon name={call.video ? 'video' : 'phoneCall'} size={20} />
        </button>
      </div>
    );
  }

  const count = tiles.length + 1;
  const cols = big ? (count <= 1 ? 'grid-cols-1' : count <= 4 ? 'grid-cols-2' : 'grid-cols-3') : count <= 1 ? 'grid-cols-1' : 'grid-cols-2';
  const elapsed = startedAt ? Math.floor((now - startedAt) / 1000) : 0;
  const status = phase === 'joining' ? 'Joining…' : !startedAt ? 'Waiting for others…' : `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
  const showSelf = camOn || sharing;
  const tileBox = big ? 'min-h-0' : 'aspect-video';

  const toggleMute = () => {
    const t = meshRef.current?.audioTrack();
    if (!t) return;
    t.enabled = !t.enabled;
    setMuted(!t.enabled);
  };
  const toggleCamera = async () => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (camOn) {
      mesh.local?.getVideoTracks().forEach((t) => { t.stop(); mesh.local?.removeTrack(t); });
      if (!mesh.screen) mesh.setVideo(null);
      setCamOn(false);
      return;
    }
    try {
      const cam = await navigator.mediaDevices.getUserMedia({ video: CAMERA });
      const track = cam.getVideoTracks()[0];
      mesh.local?.addTrack(track);
      if (!mesh.screen) mesh.setVideo(track);
      setCamOn(true);
    } catch { toast({ text: 'Allow camera access to turn video on.', tone: 'error' }); }
  };
  const stopShare = () => {
    const m = meshRef.current;
    if (!m?.screen) return;
    m.screen.stop();
    m.screen = null;
    m.setVideo(m.cameraTrack());
    setSharing(false);
  };
  const toggleShare = async () => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (mesh.screen) return stopShare();
    try {
      const track = await pickScreen();
      track.onended = stopShare; // the browser's own "Stop sharing" button
      mesh.screen = track;
      mesh.setVideo(track);
      setSharing(true);
    } catch { /* cancelled the picker */ }
  };

  return (
    <section aria-label={`Group call in ${call.title}`}
             className={`msg-in-mine fixed z-[60] flex flex-col overflow-hidden rounded-2xl bg-[#0f0e0c] text-[#F2EFE8] shadow-e3 ring-1 ring-line ${
               big ? 'inset-4 md:inset-10' : 'bottom-20 left-4 w-[min(400px,calc(100vw-32px))] lg:bottom-4'}`}>
      <div className={`relative grid gap-1.5 bg-black p-1.5 ${cols} ${big ? 'flex-1 auto-rows-fr' : 'max-h-[50vh] overflow-y-auto'}`}>
        <div className={`relative flex items-center justify-center overflow-hidden rounded-xl bg-[#1b1a17] ${tileBox}`}>
          <video ref={(el) => { selfEl.current = el; if (el) el.srcObject = meshRef.current?.preview() ?? null; }} autoPlay playsInline muted
                 className={`absolute inset-0 h-full w-full object-contain ${showSelf ? '' : 'hidden'}`} style={sharing ? undefined : { transform: 'scaleX(-1)' }} />
          {!showSelf && <Avatar name={me.display_name} path={me.avatar_path} seed={me.username} size={big ? 88 : 44} />}
          <span className="absolute bottom-1.5 left-2 inline-flex items-center gap-1 rounded bg-black/60 px-1.5 text-[11.5px]">
            {muted && <Icon name="micOff" size={11} />}You{sharing ? ' · sharing screen' : ''}
          </span>
        </div>
        {tiles.map((t) => (
          <div key={t.userId} className={`relative flex items-center justify-center overflow-hidden rounded-xl bg-[#1b1a17] ${tileBox}`}>
            <video ref={(el) => meshRef.current?.bind(t.userId, el)} autoPlay playsInline
                   className={`absolute inset-0 h-full w-full object-contain ${t.video ? '' : 'hidden'}`} />
            {!t.video && <Avatar name={t.person?.display_name ?? '…'} path={t.person?.avatar_path} seed={t.person?.username ?? t.userId} size={big ? 88 : 44} />}
            <span className="absolute bottom-1.5 left-2 max-w-[90%] truncate rounded bg-black/60 px-1.5 text-[11.5px]">
              {t.person?.display_name ?? 'Joining…'}{t.connected ? '' : ' · connecting'}
            </span>
          </div>
        ))}
        <button type="button" onClick={() => setBig((v) => !v)} aria-label={big ? 'Make the call window smaller' : 'Make the call window bigger'}
                className="absolute top-2.5 right-2.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/60 hover:bg-black/80">
          <Icon name="maximize" size={15} />
        </button>
      </div>
      <div className="flex items-center gap-2 px-4 py-3">
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[14px] font-semibold">{call.title}</span>
          <span className="font-mono text-[12px] text-[#B8B3A8]" aria-live="polite">{count} in call · {status}</span>
        </span>
        <button type="button" onClick={toggleMute} disabled={phase !== 'active'} aria-pressed={muted} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full ${muted ? 'bg-[#F2EFE8] text-[#0f0e0c]' : 'bg-white/10 hover:bg-white/20'}`}>
          <Icon name={muted ? 'micOff' : 'mic'} size={18} />
        </button>
        <button type="button" onClick={toggleCamera} disabled={phase !== 'active'} aria-pressed={camOn} aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full ${camOn ? 'bg-[#F2EFE8] text-[#0f0e0c]' : 'bg-white/10 hover:bg-white/20'}`}>
          <Icon name={camOn ? 'video' : 'videoOff'} size={18} />
        </button>
        {canShareScreen() && (
          <button type="button" onClick={toggleShare} disabled={phase !== 'active'} aria-pressed={sharing} aria-label={sharing ? 'Stop sharing your screen' : 'Share your screen'}
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-full ${sharing ? 'bg-[#F2EFE8] text-[#0f0e0c]' : 'bg-white/10 hover:bg-white/20'}`}>
            <Icon name="monitor" size={18} />
          </button>
        )}
        <button type="button" onClick={() => api.current?.finish('You left the call.')} aria-label="Leave call" className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-danger text-white hover:opacity-90">
          <Icon name="phoneOff" size={18} />
        </button>
      </div>
    </section>
  );
}
