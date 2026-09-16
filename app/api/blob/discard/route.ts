import { NextResponse } from 'next/server';
import { deletePoiBlobs, isBlobConfigured } from '@/lib/blob/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!isBlobConfigured()) {
    return NextResponse.json({ ok: true });
  }

  let pathnames: unknown;
  try {
    const body = (await request.json()) as { pathnames?: unknown };
    pathnames = body.pathnames;
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (!Array.isArray(pathnames)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  await deletePoiBlobs(pathnames.filter((value): value is string => typeof value === 'string'));
  return NextResponse.json({ ok: true });
}
