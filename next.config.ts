import type { NextConfig } from 'next';
import { PRIVATE_PAGES } from './src/lib/private-paths';

const nextConfig: NextConfig = {
  // No `X-Powered-By: Next.js`: it tells a scanner which advisories to try.
  poweredByHeader: false,
  async redirects() {
    return [
      // A mail link wrapped at its hyphen and cut there (before mails had an HTML part, `lib/mail-html.ts`)
      // still confirmed the address, then landed here. The query, if any survived, carries over.
      { source: '/verify-', destination: '/verify-email', permanent: false },
      // A guessed address: there is no sign-up page of its own. `/signin` sends a first visit on to `/welcome`.
      { source: '/signup', destination: '/signin', permanent: false },
      // The page's old address, still in shared links.
      { source: '/how-it-works', destination: '/about', permanent: true },
    ];
  },
  async headers() {
    return PRIVATE_PAGES.map((source) => ({
      source,
      headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
    }));
  },
  // Not optional: the production image copies .next/standalone and is ~200 MB
  // instead of ~1 GB. The deployment host's disk budget depends on it.
  output: 'standalone',
};

export default nextConfig;
