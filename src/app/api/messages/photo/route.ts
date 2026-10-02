import { NextResponse } from 'next/server';
import { userClient } from '@/lib/supabase/clients';
import { rateLimit } from '@/lib/rate-limit';
import { getObject, putObject } from '@/lib/r2';
import { toUserError } from '@/lib/actions';

const MAX = 4 * 1024 * 1024;

/** What the bytes really are, from their first bytes (never trust the file name or the browser's type). */
function sniff(b: Uint8Array): { ext: string; type: string } | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', type: 'image/png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return { ext: 'gif', type: 'image/gif' };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return { ext: 'webp', type: 'image/webp' };
  }
  return null;
}

/**
 * Chat photos go through the server (not a pre-signed browser upload) so the
 * bytes can be checked before they are stored, and they land in the PRIVATE
 * bucket. The database issues the path; send_message later attaches it.
 */
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return NextResponse.json({ error: 'Sign in to send photos.' }, { status: 401, headers });
  const rl = await rateLimit('upload', uid);
  if (!rl.ok) return NextResponse.json({ error: 'Slow down a little and try again.' }, { status: 429, headers });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: 'No photo received.' }, { status: 400, headers });
  if (file.size > MAX) return NextResponse.json({ error: 'Photos can be up to 4 MB.' }, { status: 413, headers });
  const bytes = await file.arrayBuffer();
  const kind = sniff(new Uint8Array(bytes.slice(0, 16)));
  if (!kind) return NextResponse.json({ error: 'Use a PNG, JPG, WebP or GIF image.' }, { status: 415, headers });
  const width = Number(form?.get('width')) || null;
  const height = Number(form?.get('height')) || null;

  const { data: path, error } = await db.rpc('prepare_message_image', { p_ext: kind.ext, p_width: width, p_height: height });
  if (error) return NextResponse.json({ error: toUserError(error) }, { status: 400, headers });
  try {
    await putObject('template-files', path as string, bytes, kind.type);
  } catch (e) {
    console.error('[messages] photo upload failed', (e as Error).message);
    return NextResponse.json({ error: 'Photo uploads are temporarily unavailable.' }, { status: 502, headers });
  }
  return NextResponse.json({ path }, { headers });
}

const PHOTO_PATH = /^dm\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp|gif)$/;
const TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

/**
 * A chat photo's bytes, from our own domain, for "Copy image" (the browser can
 * only copy an image it is allowed to read, and the storage links are on
 * another domain). Only people in the conversation get it.
 */
export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const path = new URL(request.url).searchParams.get('path') ?? '';
  if (!PHOTO_PATH.test(path)) return NextResponse.json({ error: 'Photo not found.' }, { status: 404, headers });
  const db = await userClient();
  const { data } = await db.auth.getClaims();
  const uid = data?.claims?.sub;
  if (!uid) return NextResponse.json({ error: 'Sign in first.' }, { status: 401, headers });
  const rl = await rateLimit('write', uid);
  if (!rl.ok) return NextResponse.json({ error: 'Slow down a little and try again.' }, { status: 429, headers });
  const { data: visible } = await db.rpc('visible_message_images', { p_paths: [path] });
  if (!((visible ?? []) as string[]).includes(path)) return NextResponse.json({ error: 'Photo not found.' }, { status: 404, headers });
  try {
    const res = await getObject('template-files', path);
    return new Response(res.body, {
      headers: { ...headers, 'Content-Type': TYPES[path.split('.').pop()!], 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (e) {
    console.error('[messages] photo read failed', (e as Error).message);
    return NextResponse.json({ error: 'Could not load the photo.' }, { status: 502, headers });
  }
}
