import 'server-only';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { serverEnv } from '@/lib/env.server';

// Per-endpoint budgets. The database enforces its own hard caps as well
// (likes, votes, comments, reports, downloads/day), so Redis being down
// degrades to "DB caps only", never to "no limits".
export const LIMITS = {
  like: { tokens: 60, window: '10 m' },
  vote: { tokens: 30, window: '1 h' },
  comment: { tokens: 10, window: '10 m' },
  report: { tokens: 20, window: '1 d' },
  follow: { tokens: 60, window: '10 m' },
  download: { tokens: 30, window: '1 h' },
  upload: { tokens: 30, window: '1 h' },
  auth: { tokens: 10, window: '10 m' },
  write: { tokens: 120, window: '10 m' },
} as const satisfies Record<string, { tokens: number; window: `${number} ${'s' | 'm' | 'h' | 'd'}` }>;
export type LimitName = keyof typeof LIMITS;

const redis = serverEnv.UPSTASH_REDIS_REST_URL && serverEnv.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({ url: serverEnv.UPSTASH_REDIS_REST_URL, token: serverEnv.UPSTASH_REDIS_REST_TOKEN })
  : null;

const limiters = new Map<LimitName, Ratelimit>();
function limiter(name: LimitName) {
  let l = limiters.get(name);
  if (!l && redis) {
    const { tokens, window } = LIMITS[name];
    l = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(tokens, window), prefix: `rl:${name}` });
    limiters.set(name, l);
  }
  return l;
}

// Local development fallback: fixed window in process memory.
const memory = new Map<string, { count: number; resetAt: number }>();
const toMs = (w: string) => {
  const [n, unit] = w.split(' ');
  return Number(n) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[unit as 's']!;
};

export async function rateLimit(name: LimitName, key: string): Promise<{ ok: boolean; retryAfterSec: number }> {
  const l = limiter(name);
  if (l) {
    try {
      const r = await l.limit(key);
      return { ok: r.success, retryAfterSec: Math.max(1, Math.ceil((r.reset - Date.now()) / 1000)) };
    } catch {
      return { ok: true, retryAfterSec: 0 }; // Redis outage: fall back to the DB caps.
    }
  }
  const { tokens, window } = LIMITS[name];
  const k = `${name}:${key}`;
  const now = Date.now();
  const e = memory.get(k);
  if (!e || e.resetAt < now) {
    memory.set(k, { count: 1, resetAt: now + toMs(window) });
    return { ok: true, retryAfterSec: 0 };
  }
  e.count += 1;
  return { ok: e.count <= tokens, retryAfterSec: Math.ceil((e.resetAt - now) / 1000) };
}
