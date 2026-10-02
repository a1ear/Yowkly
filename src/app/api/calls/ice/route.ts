import { NextResponse } from 'next/server';
import { userClient } from '@/lib/supabase/clients';
import { rateLimit } from '@/lib/rate-limit';
import { serverEnv } from '@/lib/env.server';

type IceServer = { urls: string | string[]; username?: string; credential?: string };

// Public STUN servers: enough for most home and mobile networks.
const STUN: IceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];

/**
 * Network servers for a call. With Cloudflare TURN configured, also returns
 * short-lived relay credentials (valid 4 hours) for strict networks. The TURN
 * API token never leaves the server; only signed-in people get credentials.
 */
export async function GET() {
  const headers = { 'Cache-Control': 'private, no-store' };
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return NextResponse.json({ error: 'Sign in to call.' }, { status: 401, headers });
  const rl = await rateLimit('write', uid);
  if (!rl.ok) return NextResponse.json({ iceServers: STUN }, { headers });

  const keyId = serverEnv.CLOUDFLARE_TURN_KEY_ID;
  const token = serverEnv.CLOUDFLARE_TURN_API_TOKEN;
  if (!keyId || !token) return NextResponse.json({ iceServers: STUN, relay: false }, { headers });
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 4 * 3600 }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`TURN credentials failed with ${res.status}`);
    const body = await res.json() as { iceServers?: IceServer | IceServer[] };
    const relay = Array.isArray(body.iceServers) ? body.iceServers : body.iceServers ? [body.iceServers] : [];
    return NextResponse.json({ iceServers: [...STUN, ...relay], relay: relay.length > 0 }, { headers });
  } catch (e) {
    console.error('[calls] TURN', (e as Error).message);
    return NextResponse.json({ iceServers: STUN, relay: false }, { headers });
  }
}
