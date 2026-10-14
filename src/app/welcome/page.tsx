import { redirect } from 'next/navigation';
import { safeReturnTo } from '@/lib/return-to';

export const dynamic = 'force-dynamic';

/**
 * Safe for work edition: there is no bet to start with, so the way in is
 * `/signin`, whose sign-in link also makes an account for a new address.
 */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeReturnTo((await searchParams).next);
  redirect(next === '/' ? '/signin' : `/signin?${new URLSearchParams({ next })}`);
}
