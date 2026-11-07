/**
 * Product events for Umami (`window.umami.track`), for funnels: where people
 * leave sign-up, sign-in and the first trade, and what they do after.
 *
 * Event data is **not personal, by construction**: only the fields listed in
 * `EventData` below, each a short code or a flag. Never an email, handle,
 * name, id or amount — the page URL is filtered in `lib/analytics.ts` for the
 * same reason, and these must not be a way around it. Add a field here only if
 * it is as harmless as the ones already there.
 *
 * Does nothing server-side, before the tracker has loaded (it retries for a
 * few seconds, since the script is added after hydration), or when analytics
 * is off.
 */

export type EventName =
  // /welcome: the address was sent / refused
  | 'signup_submitted'
  | 'signup_refused'
  // /signin
  | 'signin_succeeded'
  | 'signin_failed'
  | 'signin_link_requested'
  | 'signin_link_refused'
  // /verify-email: the code typed there
  | 'code_confirmed'
  | 'code_failed'
  | 'code_resent'
  // /verify-email once signed in: what is owed, each part of it done, and all of it done
  | 'finish_shown'
  | 'finish_step'
  | 'finish_completed'
  // trading
  | 'order_placed'
  | 'order_refused'
  // a paper's "Open Market": pressed, the market opened (by the press or on return from sign-up), refused
  | 'market_open_clicked'
  | 'market_opened'
  | 'market_open_refused'
  // the [getting started] tutorial: opened, each step first reached (2 onwards), and its last button
  | 'tutorial_opened'
  | 'tutorial_step'
  | 'tutorial_finished'
  // [onboard your agent]: the prompt copied
  | 'agent_prompt_copied'
  // small signals of interest
  | 'follow_toggled'
  | 'share_copied'
  // a share button that opens another service's share page
  | 'share_sent'
  // the home page's example searches (`lib/search-examples.ts`): shown (once per page, for each
  // place), used (Tab in the box, or the link), and a paper opened from an example's results
  | 'search_example_shown'
  | 'search_example_used'
  | 'search_example_result_opened';

export interface EventData {
  /** A refusal or failure: the error code, never its message. */
  reason?: string;
  side?: 'buy' | 'sell';
  first?: boolean;
  /** An onboarding bet was waiting. */
  bet?: boolean;
  needsName?: boolean;
  needsPassword?: boolean;
  following?: boolean;
  signedIn?: boolean;
  /**
   * What was copied: 'paper' | 'badge' | 'profile'; or where it was sent: 'x' | 'whatsapp'; or where the
   * tutorial's last button went: 'welcome' | 'close'; or where a sign-up started: 'bet' | 'open_market' |
   * 'email'; or what a Finish step did: 'bet_placed' | 'bet_skipped' | 'name' | 'password'; or what opened a
   * market: 'click' | 'return'; or where an example search was shown or used: 'placeholder' | 'link'.
   */
  target?: string;
  /** An example search's id (`lib/search-examples.ts`), never the query someone typed. */
  example?: string;
  /** A tutorial step, counted from 1. */
  step?: number;
}

type Umami = { track: (name: string, data?: Record<string, unknown>) => void };

const ATTEMPTS = 20;
const RETRY_MS = 500;

export function track(name: EventName, data?: EventData, attempt = 0): void {
  if (typeof window === 'undefined') return;
  try {
    const umami = (window as unknown as { umami?: Umami }).umami;
    if (umami) return umami.track(name, data as Record<string, unknown> | undefined);
    // Analytics off or not loaded yet; give the script a few seconds.
    if (attempt < ATTEMPTS) setTimeout(() => track(name, data, attempt + 1), RETRY_MS);
  } catch {
    // Analytics never raises into the page.
  }
}
