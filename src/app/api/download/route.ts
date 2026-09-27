import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authed, toUserError } from '@/lib/actions';
import { presignDownload, type LogicalBucket } from '@/lib/r2';

const body = z.object({ fileId: z.uuid(), acceptLicense: z.boolean().default(false) });

/**
 * 1. Postgres decides (begin_download): signed in, file clean, version not yanked,
 *    license accepted, daily cap, and records the download with a license snapshot.
 * 2. Only then does the server sign a 60-second R2 URL for that exact path.
 */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

  const a = await authed('download');
  if ('error' in a) {
    const status = a.error.code === 'auth' ? 401 : 429;
    return NextResponse.json({ error: a.error.error, code: a.error.code }, { status });
  }

  const { data, error } = await a.db.rpc('begin_download', {
    p_file: parsed.data.fileId,
    p_accept_license: parsed.data.acceptLicense,
  });
  if (error) {
    if (error.message === 'LICENSE_NOT_ACCEPTED') {
      return NextResponse.json({ error: 'Accept the license to continue.', code: 'license' }, { status: 409 });
    }
    const status = error.code === 'P0002' ? 404 : error.code === '54000' ? 429 : 403;
    return NextResponse.json({ error: toUserError(error, 'This file is not available.') }, { status });
  }

  const row = (data as { bucket: string; storage_path: string; filename: string }[])[0];
  let url: string;
  try {
    url = await presignDownload(row.bucket as LogicalBucket, row.storage_path, row.filename, 60);
  } catch (e) {
    console.error('[download] sign failed', (e as Error).message);
    return NextResponse.json({ error: 'The file could not be prepared. Try again in a minute.' }, { status: 502 });
  }
  return NextResponse.json({ url, filename: row.filename }, { headers: { 'Cache-Control': 'no-store' } });
}
