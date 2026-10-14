import { NextResponse, type NextRequest } from 'next/server';
import { ENTERED_COOKIE, MARKET_API, MARKET_PAGES, under } from './lib/sfw';

/**
 * The safe for work edition's front door. Two jobs, before any route runs:
 *
 * - The market edition's pages and its trading API are not served: a 404,
 *   so nothing can be bought, valued or ranked here even by a client that
 *   still knows the old paths.
 * - A browser that has not yet gone past the gate (no `sfw_entered` cookie)
 *   is shown it (`/gate`, rewritten so the address bar keeps the page
 *   asked for), whatever page it asked for. Its button posts to `/enter`,
 *   which sets the cookie and goes on to that page. The API, mail links'
 *   own routes and the machine-read files are never gated.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    if (MARKET_API.some((p) => under(pathname, p))) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Not in the safe for work edition: there are no markets here.' } },
        { status: 404 },
      );
    }
    return NextResponse.next();
  }
  if (MARKET_PAGES.some((p) => under(pathname, p))) {
    return new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }

  if (request.cookies.has(ENTERED_COOKIE) || request.method !== 'GET') return NextResponse.next();
  const gate = request.nextUrl.clone();
  gate.pathname = '/gate';
  gate.search = `?${new URLSearchParams({ next: `${pathname}${search}` })}`;
  return NextResponse.rewrite(gate);
}

export const config = {
  // Not static files, images, the gate's own routes, health checks or what machines read.
  matcher: [
    '/((?!_next/|gate|enter|healthz|robots\\.txt|sitemap\\.xml|llms\\.txt|favicon\\.ico|icon\\.svg|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|txt|xml|woff2?)$).*)',
  ],
};
