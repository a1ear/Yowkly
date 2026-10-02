import { NextResponse } from 'next/server';
import { userClient } from '@/lib/supabase/clients';
import { rateLimit } from '@/lib/rate-limit';
import { serverEnv } from '@/lib/env.server';

type IceServer = { urls: string | string[]; username?: string; credential?: string };

// Public STUN servers: enough for most home and mobile networks.
const STUN: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

/** Cloudflare TURN: try the current endpoint, then the older one (they return different shapes). */
async function cloudflareTurn(keyId: string, token: string): Promise<{ servers: IceServer[] } | { error: string }> {
  const base = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials`;
  let last = '';
  for (const path of ['generate-ice-servers', 'generate']) {
    const res = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 4 * 3600 }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 401 || res.status === 403) return { error: 'cloudflare_rejected_token' };
    if (res.status === 404) { last = 'cloudflare_unknown_key'; continue; }
    if (!res.ok) { last = `cloudflare_${res.status}`; continue; }
    const body = await res.json() as { iceServers?: IceServer | IceServer[] };
    const servers = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
    if (servers.length) return { servers };
    last = 'cloudflare_empty_response';
  }
  return { error: last || 'cloudflare_failed' };
}

/**
 * Network servers for a call. With Cloudflare TURN configured, also returns
 * short-lived relay credentials (valid 4 hours) for strict networks. The TURN
 * API token never leaves the server; only signed-in people get credentials.
 * `relayStatus` says why the relay is off, so setup problems are easy to spot.
 */
export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' };
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return NextResponse.json({ error: 'Sign in to call.' }, { status: 401, headers });
  const rl = await rateLimit('write', uid);
  if (!rl.ok) return NextResponse.json({ iceServers: STUN, relay: false, relayStatus: 'rate_limited' }, { headers });

  const keyId = serverEnv.CLOUDFLARE_TURN_KEY_ID;
  const token = serverEnv.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !token) {
    return NextResponse.json({ iceServers: STUN, relay: false, relayStatus: !keyId && !token ? 'not_configured' : !keyId ? 'missing_key_id' : 'missing_api_token' }, { headers });
  }
  try {
    const r = await cloudflareTurn(keyId, token);
    if ('error' in r) {
      console.error('[calls] TURN', r.error);
      return NextResponse.json({ iceServers: STUN, relay: false, relayStatus: r.error }, { headers });
    }
    return NextResponse.json({ iceServers: [...STUN, ...r.servers], relay: true, relayStatus: 'on' }, { headers });
  } catch (e) {
    console.error('[calls] TURN', (e as Error).message);
    return NextResponse.json({ iceServers: STUN, relay: false, relayStatus: 'cloudflare_unreachable' }, { headers });
  }
}
