import { NextRequest, NextResponse } from 'next/server';
import { uploadBufferToStorage } from '@/lib/storage/s3';
import { createDocument } from '@/lib/documents/documents';
import { prisma } from '@/lib/db/prisma';

export const runtime = 'nodejs';

async function ensureUser(userId: string): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@local`,
        passwordHash: 'local'
      }
    });
  }
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  }

  const userId = req.headers.get('x-user-id') || process.env.DEFAULT_USER_ID;
  if (!userId) {
    return NextResponse.json({ error: 'Missing user id' }, { status: 400 });
  }

  await ensureUser(userId);

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = file.name;
  const mime = file.type || 'application/octet-stream';

  const bucket = process.env.S3_BUCKET;
  const key = `documents/${userId}/${Date.now()}-${filename}`;
  const storageUrl = await uploadBufferToStorage({
    bucket,
    key,
    body: buffer,
    contentType: mime
  });

  const doc = await createDocument({
    userId,
    filename,
    mime,
    s3Url: storageUrl
  });

  return NextResponse.json({ id: doc.id, storageUrl });
}
