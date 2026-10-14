import { ui } from '@/components/ui';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { linkErrorMessage } from '@/lib/link-errors';
import { safeReturnTo } from '@/lib/return-to';
import { viewerFromHeaders } from '@/server/auth';
import { SignInForm } from './SignInForm';

export const dynamic = 'force-dynamic';

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeReturnTo(params.next);
  // A link from one of our mails that did not work (`lib/link-errors.ts`).
  const linkError = linkErrorMessage(params.error);
  // Already signed in: nothing to do here. On to where signing in would
  // have gone, or to the profile when that is nowhere in particular.
  if (await viewerFromHeaders(await headers())) redirect(next === '/' ? '/profile' : next);
  return (
    <main className="mx-auto my-10 max-w-[360px]">
      <h1 className="my-4.5 border-b border-rule pb-1 text-[26px] font-normal">Sign in</h1>
      <p className={`${ui.fine} mb-3`}>
        New here? Ask for a sign-in link with your institutional address: it makes your account.
      </p>
      {linkError && <div className={`${ui.note(false)} mb-3`}>{linkError}</div>}
      <SignInForm next={next} />
    </main>
  );
}
