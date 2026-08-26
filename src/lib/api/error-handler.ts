// src/lib/api/error-handler.ts — Unified API error handling
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { captureError } from '@/lib/observability/sentry';

export function handleApiError(error: unknown, route: string): NextResponse {
  if (error instanceof ZodError) {
    return NextResponse.json({ error: 'validation_error', details: error.flatten() }, { status: 400 });
  }
  const status = (error as any)?.status ?? (error as any)?.statusCode;
  if (status === 401) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (status === 403) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (status === 429) {
    const retryAfter = (error as any)?.retryAfter ?? 60;
    return NextResponse.json({ error: 'rate_limited', retryAfter }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
  }

  const err = error instanceof Error ? error : new Error(String(error));
  captureError(err, { label: `api:${route}` });

  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
  return NextResponse.json({ error: 'internal_error', message: err.message }, { status: 500 });
}
