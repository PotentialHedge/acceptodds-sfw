import { NextResponse, type NextRequest } from 'next/server';
import { MARKET_API, MARKET_PAGES, REDIRECT_PAGES, under } from './lib/sfw';
import { newBucket, parseBucket, SPLIT_COOKIE, SPLIT_HEADER } from './lib/split';

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
  // The split test (`lib/split.ts`): a paper's page gives a browser its bucket the first time, kept a year. The page
  // reads it from the header on this request, since the cookie only comes back with the next.
  if (under(pathname, '/papers') && parseBucket(request.cookies.get(SPLIT_COOKIE)?.value) === null) {
    const bucket = String(newBucket());
    const headers = new Headers(request.headers);
    headers.set(SPLIT_HEADER, bucket);
    const response = NextResponse.next({ request: { headers } });
    response.cookies.set(SPLIT_COOKIE, bucket, {
      path: '/',
      maxAge: 365 * 24 * 3600,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
      httpOnly: true,
    });
    return response;
  }
  return NextResponse.next();
}

export const config = {
  // Not static files, images, health checks or what machines read.
  matcher: [
    '/((?!_next/|healthz|robots\\.txt|sitemap\\.xml|llms\\.txt|favicon\\.ico|icon\\.svg|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|txt|xml|woff2?)$).*)',
  ],
};
