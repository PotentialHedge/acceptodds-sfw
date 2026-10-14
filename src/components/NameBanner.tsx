'use client';

import { usePathname } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { VERIFY_EMAIL } from '@/lib/return-to';
import { EditName } from './EditName';

// Pages that ask for the name themselves, or are mid-way through signing in.
const QUIET_PAGES = ['/signin', VERIFY_EMAIL, '/welcome', '/first-trade', '/set-password'];

const KEY = 'name_reminder_dismissed';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

function dismissedRecently(): boolean {
  try {
    const at = Number(window.localStorage.getItem(KEY));
    return at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

/**
 * "Add your name" across the site for a signed-in account that has none
 * (one made by a sign-in link, or that skipped the name after confirming):
 * until then the leaderboard and its public page show `@trader-xxxx`. The
 * button opens the profile's own name dialog; saving refreshes the page,
 * and the server then stops sending `needsName`. Dismissing hides it in
 * this browser for a week.
 */
export function NameBanner({
  needsName,
  displayName,
  handle,
}: {
  needsName: boolean;
  displayName: string;
  handle: string;
}) {
  const pathname = usePathname();
  // Nothing on the server, so the first client render matches it.
  const snoozed = useSyncExternalStore(
    () => () => {},
    dismissedRecently,
    () => true,
  );
  const [dismissed, setDismissed] = useState(false);

  if (!needsName || snoozed || dismissed || QUIET_PAGES.includes(pathname)) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 border-b border-rule bg-highlight px-6 py-2 narrow:px-4 font-sans text-[13px]">
      <span>
        Add your name: until you do, your reading groups show you as <b>@{handle}</b>.
      </span>
      <EditName
        displayName={displayName}
        handle={handle}
        label="add name"
        triggerClassName="cursor-pointer font-semibold text-accent hover:underline"
      />
      <span className="flex-1" />
      <button
        className="cursor-pointer text-faint"
        aria-label="dismiss"
        onClick={() => {
          try {
            window.localStorage.setItem(KEY, String(Date.now()));
          } catch {
            // Hidden for this page view only, then.
          }
          setDismissed(true);
        }}
      >
        ×
      </button>
    </div>
  );
}
