import type { MetadataRoute } from 'next';
import { PRIVATE_PAGES } from '@/lib/private-paths';
import { siteUrl } from '@/server/share';

// `APP_URL` is read at request time: prerendered at build, the host was localhost.
export const dynamic = 'force-dynamic';

/**
 * Public pages and the read API's documentation are open to everyone,
 * crawlers and AI agents alike. Closed: the private pages
 * (`lib/private-paths.ts`) and the API itself (`/docs` and `openapi.json`
 * describe it; crawling the endpoints would only spend a bot's rate limit).
 *
 * Share cards (`/papers/<slug>/card.png`) are closed to crawlers too: each is
 * drawn on demand, and a crawler fetching thousands of them took the site
 * down (2026-11-19). The link-preview bots that show them keep them: a bot
 * obeys only the most specific group naming it, so theirs repeats the rest.
 */
const PREVIEW_BOTS = [
  'Twitterbot',
  'facebookexternalhit',
  'LinkedInBot',
  'Slackbot',
  'Discordbot',
  'TelegramBot',
  'WhatsApp',
];

export default function robots(): MetadataRoute.Robots {
  const allow = ['/', '/api/v1/openapi.json'];
  const disallow = ['/api/', ...PRIVATE_PAGES];
  return {
    rules: [
      { userAgent: '*', allow, disallow: [...disallow, '/papers/*/card.png'] },
      { userAgent: PREVIEW_BOTS, allow, disallow },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
