'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { realtimeClient } from '@/lib/supabase/browser';
import { answerCall, callStatus, declineCall, endCall, incomingCall, startCall } from '@/app/actions/calls';
import { START_CALL_EVENT } from '@/lib/events';
import { canShareScreen, otherCallBusy, pickScreen, setCallBusy, startRinging } from '@/lib/call-state';
import { Avatar } from './bits';
import { Icon } from './icons';
import { useToast } from './toast';

type Peer = { display_name: string; username: string; avatar_path: string | null };
type Phase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active';
type Call = { id: string; role: 'caller' | 'callee'; video: boolean; peer: Peer };
type Signal = { type: 'ready' } | { type: 'offer' | 'answer'; sdp: RTCSessionDescriptionInit } | { type: 'ice'; candidate: RTCIceCandidateInit } | { type: 'hangup' };

const RING_TIMEOUT = 45_000;
const WHO = 'direct';

/**
 * Voice and video calls between friends. The media goes directly between the
 * two browsers (WebRTC); this component only rings, sets the connection up over
 * a private Realtime channel, and shows the call. The database decides who may
 * call whom and keeps the call history.
 */
export function CallManager({ me }: { me: string }) {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('idle');
  const [call, setCall] = useState<Call | null>(null);
  const [muted, setMuted] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [sharing, setSharing] = useState(false);
  const screenRef = useRef<MediaStreamTrack | null>(null);
  const [remoteVideo, setRemoteVideo] = useState(false);
  const [big, setBig] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const chRef = useRef<RealtimeChannel | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const remoteRef = useRef<MediaStream | null>(null);
  const remoteEl = useRef<HTMLVideoElement | null>(null);
  const localEl = useRef<HTMLVideoElement | null>(null);
  // Attach the streams whenever the video elements appear (they mount after the call UI does).
  const setRemoteEl = useCallback((el: HTMLVideoElement | null) => { remoteEl.current = el; if (el && remoteRef.current) el.srcObject = remoteRef.current; }, []);
  const setLocalEl = useCallback((el: HTMLVideoElement | null) => { localEl.current = el; if (el && localRef.current) el.srcObject = localRef.current; }, []);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const stopRing = useRef<() => void>(() => {});
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const callRef = useRef<Call | null>(null);
  const phaseRef = useRef<Phase>('idle');
  useEffect(() => { callRef.current = call; phaseRef.current = phase; setCallBusy(WHO, phase !== 'idle'); }, [call, phase]);

  // ── teardown ─────────────────────────────────────────────────────────
  const cleanup = useCallback((message?: string) => {
    stopRing.current();
    timers.current.forEach(clearTimeout);
    timers.current = [];
    pcRef.current?.close();
    pcRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    screenRef.current?.stop();
    screenRef.current = null;
    remoteRef.current = null;
    pendingIce.current = [];
    if (chRef.current) { realtimeClient().then((db) => { if (chRef.current) db.removeChannel(chRef.current); chRef.current = null; }); }
    setCall(null); setPhase('idle'); setMuted(false); setCamOn(false); setRemoteVideo(false); setStartedAt(null); setBig(false); setSharing(false);
    if (message) toast({ text: message, tone: 'ok' });
  }, [toast]);

  const hangUp = useCallback(async (message = 'Call ended.') => {
    const c = callRef.current;
    if (!c) return;
    chRef.current?.send({ type: 'broadcast', event: 'signal', payload: { type: 'hangup' } satisfies Signal });
    cleanup(message);
    await endCall(c.id);
  }, [cleanup]);

  // ── media + connection ───────────────────────────────────────────────
  const send = (s: Signal) => chRef.current?.send({ type: 'broadcast', event: 'signal', payload: s });

  const getMedia = async (video: boolean) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: video ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false,
    });
    localRef.current = stream;
    setCamOn(video);
    if (localEl.current) localEl.current.srcObject = stream;
    return stream;
  };

  const makePeer = async () => {
    const res = await fetch('/api/calls/ice').then((r) => r.json()).catch(() => ({ iceServers: [] }));
    const pc = new RTCPeerConnection({ iceServers: res.iceServers ?? [] });
    pcRef.current = pc;
    const remote = new MediaStream();
    remoteRef.current = remote;
    pc.ontrack = (e) => {
      remote.addTrack(e.track);
      if (remoteEl.current) remoteEl.current.srcObject = remote;
      const watch = () => setRemoteVideo(remote.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted));
      e.track.onunmute = watch; e.track.onmute = watch; e.track.onended = watch;
      watch();
    };
    pc.onicecandidate = (e) => { if (e.candidate) send({ type: 'ice', candidate: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') { stopRing.current(); setPhase('active'); setStartedAt((t) => t ?? Date.now()); }
      if (pc.connectionState === 'failed') hangUp("Couldn't connect the call. One of you may be on a network that blocks calls.");
    };
    return pc;
  };

  const flushIce = async () => {
    const pc = pcRef.current;
    if (!pc?.remoteDescription) return;
    for (const c of pendingIce.current.splice(0)) await pc.addIceCandidate(c).catch(() => {});
  };

  const joinChannel = async (callId: string, onSignal: (s: Signal) => void) => {
    const db = await realtimeClient();
    return new Promise<void>((resolve) => {
      const ch = db.channel(`call:${callId}`, { config: { private: true, broadcast: { self: false } } })
        .on('broadcast', { event: 'signal' }, (msg: { payload?: unknown }) => onSignal(msg.payload as Signal))
        .subscribe((status: string) => { if (status === 'SUBSCRIBED') resolve(); });
      chRef.current = ch;
    });
  };

  const onSignal = useCallback(async (s: Signal) => {
    const pc = pcRef.current;
    const c = callRef.current;
    if (!c) return;
    if (s.type === 'hangup') return cleanup('The call ended.');
    if (!pc) return;
    if (s.type === 'ice') {
      if (pc.remoteDescription) await pc.addIceCandidate(s.candidate).catch(() => {});
      else pendingIce.current.push(s.candidate);
    } else if (s.type === 'ready' && c.role === 'caller' && !pc.localDescription) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ type: 'offer', sdp: offer });
    } else if (s.type === 'offer' && c.role === 'callee' && !pc.remoteDescription) {
      await pc.setRemoteDescription(s.sdp);
      // Put our microphone (and camera, if on) on the transceivers the caller offered.
      const stream = localRef.current;
      for (const t of pc.getTransceivers()) {
        const kind = t.receiver.track.kind;
        const track = kind === 'audio' ? stream?.getAudioTracks()[0] : stream?.getVideoTracks()[0];
        await t.sender.replaceTrack(track ?? null);
        t.direction = 'sendrecv';
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({ type: 'answer', sdp: answer });
      await flushIce();
    } else if (s.type === 'answer' && c.role === 'caller' && !pc.remoteDescription) {
      await pc.setRemoteDescription(s.sdp);
      await flushIce();
    }
    // flushIce/send are stable helpers over refs
  }, [cleanup]);

  // ── starting and answering ───────────────────────────────────────────
  const begin = useCallback(async (conversationId: string, video: boolean, peer: Peer) => {
    if (phaseRef.current !== 'idle' || otherCallBusy(WHO)) return toast({ text: 'You are already in a call.', tone: 'error' });
    let stream: MediaStream;
    try { stream = await getMedia(video); } catch {
      return toast({ text: 'Allow microphone access (and camera for video) to call.', tone: 'error' });
    }
    const r = await startCall(conversationId, video);
    if (!r.ok) { stream.getTracks().forEach((t) => t.stop()); localRef.current = null; return toast({ text: r.error, tone: 'error' }); }
    const c: Call = { id: r.data.id, role: 'caller', video, peer };
    callRef.current = c;
    setCall(c); setPhase('outgoing');
    stopRing.current = startRinging(true);
    const pc = await makePeer();
    const audio = pc.addTransceiver('audio', { direction: 'sendrecv' });
    await audio.sender.replaceTrack(stream.getAudioTracks()[0] ?? null);
    // Always offer a video slot, so either side can turn the camera on later without renegotiating.
    const vid = pc.addTransceiver('video', { direction: 'sendrecv' });
    await vid.sender.replaceTrack(stream.getVideoTracks()[0] ?? null);
    await joinChannel(c.id, onSignal);
    timers.current.push(setTimeout(() => { if (phaseRef.current === 'outgoing') hangUp('No answer.'); }, RING_TIMEOUT));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hangUp, onSignal, toast]);

  const accept = async () => {
    const c = callRef.current;
    if (!c) return;
    stopRing.current();
    try { await getMedia(c.video); } catch {
      toast({ text: 'Allow microphone access to answer.', tone: 'error' });
      return;
    }
    const r = await answerCall(c.id);
    if (!r.ok) return cleanup(r.error);
    setPhase('connecting');
    await makePeer();
    await joinChannel(c.id, onSignal);
    // Tell the caller we're ready; repeat until their offer arrives (they may still be joining).
    const ping = () => { if (pcRef.current && !pcRef.current.remoteDescription && callRef.current?.id === c.id) { send({ type: 'ready' }); timers.current.push(setTimeout(ping, 1500)); } };
    ping();
  };

  const decline = async () => {
    const c = callRef.current;
    if (!c) return;
    cleanup();
    await declineCall(c.id);
  };

  // ── listening for calls ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    let cleanupCh = () => {};
    const ring = async () => {
      if (phaseRef.current !== 'idle' || otherCallBusy(WHO)) return;
      const inc = await incomingCall();
      // Group calls ring through the group call manager.
      if (!inc || inc.is_group || phaseRef.current !== 'idle' || otherCallBusy(WHO)) return;
      const c: Call = { id: inc.id, role: 'callee', video: inc.video, peer: { display_name: inc.caller_display_name, username: inc.caller_username, avatar_path: inc.caller_avatar_path } };
      callRef.current = c;
      setCall(c); setPhase('incoming');
      stopRing.current = startRinging(false);
      timers.current.push(setTimeout(() => { if (phaseRef.current === 'incoming') cleanup('Missed call.'); }, Math.max(1000, RING_TIMEOUT - (Date.now() - Date.parse(inc.created_at)))));
    };
    realtimeClient().then((db) => {
      if (cancelled) return;
      const ch = db.channel(`calls-${me}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calls', filter: `callee_id=eq.${me}` }, () => { ring(); })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calls' }, (p: { new: Record<string, unknown> }) => {
          const c = callRef.current;
          if (!c || p.new.id !== c.id) return;
          if (p.new.status === 'declined') cleanup(`${c.peer.display_name} declined the call.`);
          else if (p.new.status === 'missed' || p.new.status === 'ended') cleanup(phaseRef.current === 'incoming' ? 'Missed call.' : 'The call ended.');
          else if (p.new.status === 'active' && c.role === 'caller') { stopRing.current(); setPhase('connecting'); }
        })
        .subscribe();
      cleanupCh = () => { db.removeChannel(ch); };
    });
    ring(); // a call may already be ringing when the page loads
    const onStart = (e: Event) => {
      const d = (e as CustomEvent).detail as { conversationId: string; video: boolean; peer: Peer };
      begin(d.conversationId, d.video, d.peer);
    };
    window.addEventListener(START_CALL_EVENT, onStart);
    // Safety net: if a hang-up message is lost, notice the call ended within a few seconds.
    const poll = setInterval(async () => {
      const c = callRef.current;
      if (!c || phaseRef.current === 'idle') return;
      const s = await callStatus(c.id);
      if (s && !['ringing', 'active'].includes(s)) cleanup(s === 'declined' ? `${c.peer.display_name} declined the call.` : 'The call ended.');
    }, 5000);
    return () => { cancelled = true; cleanupCh(); window.removeEventListener(START_CALL_EVENT, onStart); clearInterval(poll); };
  }, [me, begin, cleanup]);

  // Hang up if the tab is closed mid-call.
  useEffect(() => {
    const bye = () => { const c = callRef.current; if (c) { send({ type: 'hangup' }); navigator.sendBeacon?.('/api/calls/end', JSON.stringify({ id: c.id })); } };
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, []);

  // Call timer.
  useEffect(() => {
    if (phase !== 'active') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // ── controls ─────────────────────────────────────────────────────────
  const toggleMute = () => {
    const t = localRef.current?.getAudioTracks()[0];
    if (!t) return;
    t.enabled = !t.enabled;
    setMuted(!t.enabled);
  };
  const toggleCamera = async () => {
    const pc = pcRef.current;
    const sender = pc?.getTransceivers().find((t) => t.receiver.track.kind === 'video')?.sender;
    if (!sender) return;
    if (camOn) {
      localRef.current?.getVideoTracks().forEach((t) => { t.stop(); localRef.current?.removeTrack(t); });
      if (!screenRef.current) await sender.replaceTrack(null);
      setCamOn(false);
    } else {
      try {
        const cam = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } });
        const track = cam.getVideoTracks()[0];
        localRef.current?.addTrack(track);
        if (!screenRef.current) {
          await sender.replaceTrack(track);
          if (localEl.current) localEl.current.srcObject = localRef.current;
        }
        setCamOn(true);
      } catch { toast({ text: 'Allow camera access to turn video on.', tone: 'error' }); }
    }
  };
  // Screen sharing takes over the video slot; the camera comes back when it stops.
  const videoSender = () => pcRef.current?.getTransceivers().find((t) => t.receiver.track.kind === 'video')?.sender;
  const stopShare = async () => {
    const screen = screenRef.current;
    if (!screen) return;
    screen.stop();
    screenRef.current = null;
    const cam = localRef.current?.getVideoTracks()[0] ?? null;
    await videoSender()?.replaceTrack(cam).catch(() => {});
    if (localEl.current) localEl.current.srcObject = localRef.current;
    setSharing(false);
  };
  const toggleShare = async () => {
    if (screenRef.current) return stopShare();
    const sender = videoSender();
    if (!sender) return;
    try {
      const track = await pickScreen();
      track.onended = () => { stopShare(); }; // the browser's own "Stop sharing" button
      screenRef.current = track;
      await sender.replaceTrack(track);
      if (localEl.current) localEl.current.srcObject = new MediaStream([track]);
      setSharing(true);
    } catch { /* cancelled the picker */ }
  };

  if (phase === 'idle' || !call) return null;
  const elapsed = startedAt ? Math.floor((now - startedAt) / 1000) : 0;
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  if (phase === 'incoming') {
    return (
      <div role="alertdialog" aria-label={`${call.peer.display_name} is calling`}
           className="msg-in-theirs fixed top-20 left-1/2 z-[60] flex w-[min(380px,calc(100vw-24px))] -translate-x-1/2 items-center gap-3 rounded-2xl bg-surface-1 p-4 shadow-e3 ring-1 ring-line">
        <span className="relative shrink-0">
          <Avatar name={call.peer.display_name} path={call.peer.avatar_path} seed={call.peer.username} size={52} />
          <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full ring-2 ring-accent" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate font-semibold">{call.peer.display_name}</span>
          <span className="text-[13px] text-ink-3">Incoming {call.video ? 'video' : 'voice'} call…</span>
        </span>
        <button type="button" onClick={decline} aria-label="Decline call" className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-danger text-white hover:opacity-90">
          <Icon name="phoneOff" size={20} />
        </button>
        <button type="button" onClick={accept} aria-label="Answer call" className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-success text-white hover:opacity-90">
          <Icon name={call.video ? 'video' : 'phoneCall'} size={20} />
        </button>
      </div>
    );
  }

  const status = phase === 'outgoing' ? 'Calling…' : phase === 'connecting' ? 'Connecting…' : clock;
  return (
    <section aria-label={`Call with ${call.peer.display_name}`}
             className={`msg-in-mine fixed z-[60] flex flex-col overflow-hidden rounded-2xl bg-[#0f0e0c] text-[#F2EFE8] shadow-e3 ring-1 ring-line ${
               big ? 'inset-4 md:inset-10' : 'bottom-20 left-4 w-[min(360px,calc(100vw-32px))] lg:bottom-4'}`}>
      <div className={`relative flex items-center justify-center bg-black ${big ? 'flex-1' : remoteVideo ? 'aspect-video' : 'h-44'}`}>
        <video ref={setRemoteEl} autoPlay playsInline className={`h-full w-full object-contain ${remoteVideo ? '' : 'hidden'}`} />
        {!remoteVideo && (
          <span className="flex flex-col items-center gap-2">
            <Avatar name={call.peer.display_name} path={call.peer.avatar_path} seed={call.peer.username} size={big ? 120 : 72} />
            <span className="text-[13px] text-[#B8B3A8]">{phase === 'active' ? 'Voice only' : status}</span>
          </span>
        )}
        <video ref={setLocalEl} autoPlay playsInline muted className={`absolute right-3 bottom-3 w-28 rounded-lg ring-1 ring-white/20 ${camOn || sharing ? '' : 'hidden'}`} style={sharing ? undefined : { transform: 'scaleX(-1)' }} />
        <button type="button" onClick={() => setBig((v) => !v)} aria-label={big ? 'Make the call window smaller' : 'Make the call window bigger'}
                className="absolute top-2 right-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/50 hover:bg-black/70">
          <Icon name="maximize" size={15} />
        </button>
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate text-[14px] font-semibold">{call.peer.display_name}</span>
          <span className="font-mono text-[12px] text-[#B8B3A8]" aria-live="polite">{status}</span>
        </span>
        <button type="button" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full ${muted ? 'bg-[#F2EFE8] text-[#0f0e0c]' : 'bg-white/10 hover:bg-white/20'}`}>
          <Icon name={muted ? 'micOff' : 'mic'} size={18} />
        </button>
        <button type="button" onClick={toggleCamera} disabled={phase === 'outgoing'} aria-pressed={camOn} aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-full ${camOn ? 'bg-[#F2EFE8] text-[#0f0e0c]' : 'bg-white/10 hover:bg-white/20'}`}>
          <Icon name={camOn ? 'video' : 'videoOff'} size={18} />
        </button>
        {canShareScreen() && (
          <button type="button" onClick={toggleShare} disabled={phase === 'outgoing'} aria-pressed={sharing} aria-label={sharing ? 'Stop sharing your screen' : 'Share your screen'}
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-full ${sharing ? 'bg-[#F2EFE8] text-[#0f0e0c]' : 'bg-white/10 hover:bg-white/20'}`}>
            <Icon name="monitor" size={18} />
          </button>
        )}
        <button type="button" onClick={() => hangUp()} aria-label="Hang up" className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-danger text-white hover:opacity-90">
          <Icon name="phoneOff" size={18} />
        </button>
      </div>
      {/* Remote audio plays through the video element above, even when there is no picture. */}
    </section>
  );
}
