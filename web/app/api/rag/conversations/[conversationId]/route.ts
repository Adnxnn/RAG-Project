import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { conversationId: string } },
) {
  const backendUrl = process.env.RAG_API_URL?.replace(/\/$/, '');
  if (!backendUrl) {
    return NextResponse.json({ cleared: false, reason: 'RAG_API_URL is not configured.' });
  }

  const response = await fetch(
    `${backendUrl}/conversations/${encodeURIComponent(params.conversationId)}/index`,
    {
      method: 'DELETE',
      headers: process.env.RAG_API_KEY ? { 'x-api-key': process.env.RAG_API_KEY } : {},
      cache: 'no-store',
    },
  );

  const payload = await response.json().catch(() => ({ cleared: response.ok }));
  return NextResponse.json(payload, { status: response.status });
}
