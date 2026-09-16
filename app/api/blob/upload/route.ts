import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { NextResponse } from 'next/server';
import { isBlobConfigured, deleteOrphanPoiBlobs } from '@/lib/blob/store';
import { assertPoiPathname } from '@/lib/blob/path';
import { MAX_FILE_BYTES } from '@/lib/extract/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  if (!isBlobConfigured()) {
    return NextResponse.json({ error: 'Blob storage is not configured.' }, { status: 503 });
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: 'Invalid upload request.' }, { status: 400 });
  }

  try {
    void deleteOrphanPoiBlobs().catch(() => undefined);

    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        assertPoiPathname(pathname);
        return {
          allowedContentTypes: [
            'application/pdf',
            'text/csv',
            'text/plain',
            'image/jpeg',
            'image/png',
            'application/octet-stream',
          ],
          addRandomSuffix: true,
          allowOverwrite: false,
          maximumSizeInBytes: MAX_FILE_BYTES,
          validUntil: Date.now() + 15 * 60 * 1000,
          cacheControlMaxAge: 60,
        };
      },
      onUploadCompleted: async () => {
        // Processing happens in /api/analyze-income. No-op so Blob's callback can succeed.
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Upload token failed.';
    return NextResponse.json({ error: 'Could not start document upload.', details: message }, { status: 400 });
  }
}
