import { NextResponse, type NextRequest } from 'next/server';
import { MARKET_API, MARKET_PAGES, REDIRECT_PAGES, under } from './lib/sfw';

/**
 * The safe for work edition's front door, before any route runs: the market
 * edition's pages and its trading API are not served (a 404), so nothing can
 * be bought, valued or ranked here even by a client that still knows the old
 * paths. `/about` goes to the home page instead.
 *
 * There used to be a first-visit gate here too. It hid every page from
 * crawlers (they carry no cookie), so it is gone; `/gate` and `/enter` go
 * home for anyone who still has a link to them.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    if (MARKET_API.some((p) => under(pathname, p))) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Not in the safe for work edition: there are no markets here.' } },
        { status: 404 },
      );
    }
    return NextResponse.next();
  }
  if (REDIRECT_PAGES.some((p) => under(pathname, p))) {
    const home = request.nextUrl.clone();
    home.pathname = '/';
    home.search = '';
    return NextResponse.redirect(home, 307);
  }
  if (MARKET_PAGES.some((p) => under(pathname, p))) {
    return new NextResponse('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
  return NextResponse.next();
}

export const config = {
  // Not static files, images, health checks or what machines read.
  matcher: [
    '/((?!_next/|healthz|robots\\.txt|sitemap\\.xml|llms\\.txt|favicon\\.ico|icon\\.svg|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|txt|xml|woff2?)$).*)',
  ],
};
