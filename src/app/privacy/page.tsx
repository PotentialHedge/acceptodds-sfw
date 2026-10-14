import type { Metadata } from 'next';
import Link from 'next/link';
import { TitleBlock } from '@/components/TitleBlock';
import { ui } from '@/components/ui';
import { siteName } from '@/server/share';

export const metadata: Metadata = {
  title: 'Privacy | acceptodds',
  description: 'What acceptodds stores about you, why, who else sees it, and how to have it changed or removed.',
  alternates: { canonical: '/privacy' },
};

const CONTACT = 'hello@acceptodds.com';
/** Where account deletion is asked for. */
const ACCOUNTS_CONTACT = 'accounts@acceptodds.com';
const prose = 'mt-2 space-y-3 leading-relaxed';
const list = 'mt-2 list-disc space-y-1.5 pl-5 leading-relaxed';

/**
 * The privacy notice (GDPR Art. 13, and the Swiss FADP), set like
 * `/about`. It must stay true to the code: a new cookie, a new mail,
 * a new processor or a new thing made public belongs here too.
 */
export default function PrivacyPage() {
  return (
    <main className={`${ui.page} max-w-[640px]`}>
      <TitleBlock
        title="Privacy"
        byline={siteName()}
        abstract="acceptodds stores what it needs to run accounts and markets, and little else. It sets no advertising or tracking cookies, sells nothing, and counts visits without knowing who made them. This page lists what is stored, why, who else handles it, and how to have it changed or removed."
      />

      <h2 id="who" className={ui.groupHeading}>
        Who is responsible
      </h2>
      <div className={prose}>
        <p>
          acceptodds is run by the people behind it, reachable at{' '}
          <a href={`mailto:${CONTACT}`} className={ui.hyperref}>
            {CONTACT}
          </a>
          . Write there with any question about your data, or to use any of the rights in §6.
        </p>
      </div>

      <h2 id="account" className={ui.groupHeading}>
        Your account
      </h2>
      <div className={prose}>
        <p>When you sign up and use the site, we store:</p>
        <ul className={list}>
          <li>
            your email address and any further institutional addresses you confirm, and the institutions they belong to,
            to sign you in and to check that you may trade;
          </li>
          <li>your display name, your handle and, if you set one, a hash of your password (never the password);</li>
          <li>
            sign-in sessions (not the network address or browser they came from), and a hash of each API key you create;
          </li>
          <li>
            your trades, positions and $rep balance, the comments you post and the papers you follow, group, back or
            mark as read: the site itself.
          </li>
        </ul>
        <p>
          The legal basis is the contract you enter by signing up (GDPR Art. 6(1)(b)). It is kept while your account
          exists. A sign-up whose address is never confirmed is deleted after a week.
        </p>
        <p>
          To delete your account, write to{' '}
          <a href={`mailto:${ACCOUNTS_CONTACT}`} className={ui.hyperref}>
            {ACCOUNTS_CONTACT}
          </a>{' '}
          from the address you signed up with.
        </p>
      </div>

      <h2 id="public" className={ui.groupHeading}>
        What is public
      </h2>
      <div className={prose}>
        <p>
          Your display name, handle, institutions, rank and net worth appear on the leaderboard and on your page at{' '}
          <span className="font-mono">/people/&lt;handle&gt;</span>. Comments are shown under a random alias per paper,
          with your current position in that market, rounded to two figures, never your name. A position is public only
          if you make it so, one at a time. Your email address is never shown to anyone else.
        </p>
      </div>

      <h2 id="mail" className={ui.groupHeading}>
        Email
      </h2>
      <div className={prose}>
        <p>
          We send the mail the site needs (confirmation codes, sign-in links, password resets, codes for an AI agent you
          ask to sign in) and, unless you turn them off on your profile, a morning digest of the papers you follow and a
          note when someone mentions you in a comment. Mail is delivered by Resend, which handles your address for that
          purpose only.
        </p>
      </div>

      <h2 id="visits" className={ui.groupHeading}>
        Visits, analytics and cookies
      </h2>
      <div className={prose}>
        <ul className={list}>
          <li>
            <b>Analytics.</b> We count page views, a few product events (such as “a trade was placed”) and how fast
            pages load (load and response times, layout shift) with Umami, run on our own server. It sets no cookies and
            stores no IP address; addresses are used only in passing, to tell visits apart and to find a country. Page
            addresses are stripped of anything personal before they are sent, and events never carry an email, name,
            handle or amount.
          </li>
          <li>
            <b>Paper views.</b> A paper’s view count counts each visitor once a day. A visitor is your account when
            signed in, otherwise your network address; what is stored is a keyed hash of it and the day, deleted after
            two days. Which paper was read after which is kept only as a total per pair of papers.
          </li>
          <li>
            <b>Activity log.</b> We log which pages and markets signed-in accounts look at, to run and improve the site.
            The log holds no content of what you did, only that it happened.
          </li>
          <li>
            <b>Cloudflare</b> sits in front of the site, protects it from abuse and so sees every visitor’s network
            address.
          </li>
          <li>
            <b>Cookies and browser storage</b> are only functional: the sign-in session, whether you have gone past the
            first page (the way into the safe for work edition), whether you have seen the welcome page, which venue you
            last picked, which home-page sections you left open, which announcements you dismissed, and a random token
            that ties a bet chosen during sign-up to this browser. Your browser’s own storage remembers a pending
            confirmation, the last paper you read and, for each tab, your last home-page search. None of it tracks you
            elsewhere.
          </li>
        </ul>
        <p>
          The basis for all of this is our legitimate interest in running a secure, working site and knowing how it is
          used (GDPR Art. 6(1)(f)).
        </p>
      </div>

      <h2 id="research" className={ui.groupHeading}>
        Research
      </h2>
      <div className={prose}>
        <p>
          We may study how the markets behave (how prices moved, how accurate they were, how people and AI agents trade)
          and publish what we find, in a blog post or a scientific paper. Anything published is aggregated or
          anonymised: never an email address, and never a name, handle or comment alias tied to what someone did. Market
          prices, volumes and outcomes, which are public already, may be shown as they are.
        </p>
        <p>
          The basis is our legitimate interest in research (GDPR Art. 6(1)(f) and Art. 89; Swiss FADP Art. 31(2)(e)).
          You may object to it, as below.
        </p>
      </div>

      <h2 id="rights" className={ui.groupHeading}>
        Your rights
      </h2>
      <div className={prose}>
        <p>
          You may ask for a copy of what we hold about you, have it corrected or deleted, restrict or object to its use,
          and take it with you. Write to{' '}
          <a href={`mailto:${CONTACT}`} className={ui.hyperref}>
            {CONTACT}
          </a>
          . You may also complain to a data-protection authority: in Switzerland the FDPIC, in the EU the one where you
          live. Trading on acceptodds is explained in <Link href="/about">How it works</Link>.
        </p>
      </div>
    </main>
  );
}
