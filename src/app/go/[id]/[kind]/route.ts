import { NextResponse } from 'next/server';
import { z } from 'zod';
import { userClient } from '@/lib/supabase/clients';
import { rateLimit } from '@/lib/rate-limit';

const params = z.object({ id: z.uuid(), kind: z.enum(['github', 'figma', 'canva', 'framer', 'webflow', 'penpot']) });

/**
 * "Open in Figma/Canva" goes through here so link-based templates count like
 * downloads. It redirects only to the URL stored for that template and kind,
 * never to anything taken from the request, so it cannot be an open redirect.
 */
export async function GET(request: Request, ctx: RouteContext<'/go/[id]/[kind]'>) {
  const p = params.safeParse(await ctx.params);
  if (!p.success) return new NextResponse('Not found', { status: 404 });
  const db = await userClient();
  const { data: claims } = await db.auth.getClaims();
  const key = claims?.claims?.sub ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'anon';
  if (!(await rateLimit('download', key)).ok) return new NextResponse('Too many requests', { status: 429 });

  const { data: url, error } = await db.rpc('resolve_link', { p_template: p.data.id, p_kind: p.data.kind });
  if (error || typeof url !== 'string' || !url.startsWith('https://')) return new NextResponse('Not found', { status: 404 });
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}
