import { notFound, redirect } from 'next/navigation';
import { ApiError } from '@/server/api/errors';
import { resolveListing, resolveMarket } from '@/server/views';

export const dynamic = 'force-dynamic';

/**
 * Safe for work edition: there is no market page. A market in a listing
 * sends its old links on to the paper; one with no listing is not shown.
 */
export default async function MarketPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let market;
  try {
    market = await resolveMarket(decodeURIComponent(slug));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  if (!market.listingId) notFound();
  const listing = await resolveListing(market.listingId);
  redirect(`/papers/${encodeURIComponent(listing.slug)}`);
}
