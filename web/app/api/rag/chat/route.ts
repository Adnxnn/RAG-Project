import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const backendUrl = process.env.RAG_API_URL?.replace(/\/$/, '');
  if (!backendUrl) {
    return NextResponse.json(
      { error: 'RAG_API_URL is not configured on the web deployment.' },
      { status: 503 },
    );
  }

  const body = await request.json();
  const response = await fetch(`${backendUrl}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.RAG_API_KEY ? { 'x-api-key': process.env.RAG_API_KEY } : {}),
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({ error: 'Invalid backend response.' }));
  return NextResponse.json(payload, { status: response.status });
}
