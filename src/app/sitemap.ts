import type { MetadataRoute } from 'next';
import { siteUrl } from '@/server/share';
import { sitemapPaths } from '@/server/seo';
import { mapKinds } from '@/server/views';

// Read from the database per request, never at build time.
export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = siteUrl();
  // One map per venue that has one.
  const maps = (await mapKinds()).map((kind) => `/map?${new URLSearchParams({ kind })}`);
  const fixed = ['/', ...maps, '/docs', '/privacy'].map((path) => ({
    url: `${origin}${path === '/' ? '' : path}`,
    changeFrequency: 'daily' as const,
  }));
  const paths = await sitemapPaths();
  return [...fixed, ...paths.map((path) => ({ url: `${origin}${path}` }))];
}
