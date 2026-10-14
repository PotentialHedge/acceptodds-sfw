import { NextResponse } from 'next/server';
import { safeReturnTo } from '@/lib/return-to';
import { ENTERED_COOKIE, ENTERED_MAX_AGE } from '@/lib/sfw';

/**
 * The gate's button: remembers that this browser has gone past it, so it is
 * never shown here again, and goes on to the page that was asked for. A
 * POST, so a link scanner or a prefetch never goes past it for anyone.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const raw = form.get('next');
  const next = safeReturnTo(typeof raw === 'string' ? raw : undefined);
  // A relative Location: behind the proxy the request's own URL is the container's, not the site's.
  const response = new NextResponse(null, { status: 303, headers: { location: next } });
  response.cookies.set(ENTERED_COOKIE, '1', {
    maxAge: ENTERED_MAX_AGE,
    path: '/',
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  });
  return response;
}
