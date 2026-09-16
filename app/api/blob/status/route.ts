import { NextResponse } from 'next/server';
import { isBlobConfigured } from '@/lib/blob/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ enabled: isBlobConfigured() });
}
