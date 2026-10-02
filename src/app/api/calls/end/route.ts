import { NextResponse } from 'next/server';
import { z } from 'zod';
import { userClient } from '@/lib/supabase/clients';

/** Hang up when the tab closes (sent with navigator.sendBeacon; end_call checks you're in the call). */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const id = z.object({ id: z.uuid() }).safeParse(body);
  if (!id.success) return new NextResponse(null, { status: 400 });
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  if (!data?.claims?.sub) return new NextResponse(null, { status: 401 });
  await db.rpc('end_call', { p_call: id.data.id });
  return new NextResponse(null, { status: 204 });
}
