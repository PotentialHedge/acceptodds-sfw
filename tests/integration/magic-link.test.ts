import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { user } from '@/db/auth-schema';
import { getAuth, missingFromUser, resetTokenEmail } from '@/server/better-auth';
import { clearDevOutbox, devOutbox } from '@/server/mail';
import { api, authCall, authPathOf, cookieFrom, signUp } from './api-client';
import { closePool, resetDatabase, seedMarket, STARTING_MICRO } from './helpers';

const db = getDb();
const LANDING = '/verify-email';

beforeEach(async () => {
  await resetDatabase();
  process.env.API_RATE_LIMIT_BURST = '1000';
  process.env.API_RATE_LIMIT_PER_SECOND = '1000';
  process.env.STARTING_BALANCE_MICRO = STARTING_MICRO.toString();
  clearDevOutbox();
  await seedMarket(0, 10);
}, 60_000);

afterAll(async () => {
  await closePool();
});

function requestLink(email: string) {
  return authCall('POST', '/sign-in/magic-link', {
    body: { email, callbackURL: LANDING, newUserCallbackURL: `${LANDING}?new=1`, errorCallbackURL: LANDING },
  });
}

/** Open the link in the newest mail to `email`: the session cookie and where it redirected. */
async function openLink(email: string) {
  const mail = devOutbox().findLast((m) => m.to === email);
  if (!mail) throw new Error('no mail');
  const link = new URL(/https?:\/\/\S+/.exec(mail.text)![0]);
  const res = await authCall('GET', `${authPathOf(link)}${link.search}`);
  const location = res.headers.get('location');
  const at = location ? new URL(location, 'http://test.local') : null;
  return { cookie: cookieFrom(res), location: at ? `${at.pathname}${at.search}` : null };
}

async function userRow(email: string) {
  const [row] = await db.select().from(user).where(eq(user.email, email));
  return row;
}

describe('sign-in links', () => {
  it('are mailed as the landing page, never the verify URL a mail scanner would spend', async () => {
    await requestLink('ada@example.org');
    const mail = devOutbox().findLast((m) => m.to === 'ada@example.org')!;
    expect(mail.text).not.toContain('/magic-link/verify');
    expect(mail.html).not.toContain('/magic-link/verify');
    const link = new URL(/https?:\/\/\S+/.exec(mail.text)![0]);
    expect(link.pathname).toBe('/signin/link');
    expect(link.searchParams.get('to')).toBe('magic-link');
    expect(link.searchParams.get('token')).toBeTruthy();
    expect(link.searchParams.get('callbackURL')).toBe(LANDING);
  });

  it('make an account for a new address, which then needs a name and a password', async () => {
    expect((await requestLink('ada@example.org')).status).toBe(200);
    expect(await userRow('ada@example.org')).toBeUndefined(); // nothing before the link is opened

    const { cookie, location } = await openLink('ada@example.org');
    expect(cookie).toContain('session_token');
    expect(location).toBe(`${LANDING}?new=1`);

    const me = await api('GET', '/me', { cookie });
    expect(me.body).not.toHaveProperty('wallets');
    const u = await userRow('ada@example.org');
    expect(await missingFromUser(u.id)).toEqual({ name: true, password: true });

    // No name yet: a placeholder handle, never the email's local part.
    expect(me.body.handle).toMatch(/^trader-[a-z0-9]{4}$/);

    const named = await api('PATCH', '/me', { cookie, body: { displayName: '  Ada Lovelace ' } });
    expect(named.status).toBe(200);
    expect(named.body.displayName).toBe('Ada Lovelace');
    expect(named.body.handle).toBe('ada-lovelace'); // the first name makes the handle, once
    const renamed = await api('PATCH', '/me', { cookie, body: { displayName: 'Augusta Ada King' } });
    expect(renamed.body.handle).toBe('ada-lovelace');
    expect((await userRow('ada@example.org')).name).toBe('Augusta Ada King');
    expect((await api('POST', '/me/password', { cookie, body: { password: 'correct horse battery' } })).status).toBe(
      200,
    );
    expect(await missingFromUser(u.id)).toEqual({ name: false, password: false });

    const signIn = await authCall('POST', '/sign-in/email', {
      body: { email: 'ada@example.org', password: 'correct horse battery' },
    });
    expect(signIn.status).toBe(200);
  });

  it('sign an existing account in, with nothing missing', async () => {
    await signUp('ada@example.org', 'Ada');
    clearDevOutbox();
    await requestLink('ada@example.org');
    const { cookie, location } = await openLink('ada@example.org');
    expect(cookie).toContain('session_token');
    expect(location).toBe(LANDING);
    expect(await missingFromUser((await userRow('ada@example.org')).id)).toEqual({ name: false, password: false });
  });

  it('work once', async () => {
    await requestLink('ada@example.org');
    await openLink('ada@example.org');
    const again = await openLink('ada@example.org');
    expect(again.cookie).not.toContain('session_token');
    expect(again.location).toContain('error=');
  });

  it('are refused to an unlisted address before any mail', async () => {
    const res = await requestLink('someone@gmail.com');
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('EMAIL_DOMAIN_NOT_ALLOWED');
    expect(devOutbox()).toEqual([]);
  });

  it('are mailed to one address at most five times a day', async () => {
    for (let i = 0; i < 5; i += 1) expect((await requestLink('ada@example.org')).status).toBe(200);
    expect((await requestLink('ada@example.org')).status).toBe(429);
    expect(devOutbox()).toHaveLength(5);
  });
});

describe('a password reset', () => {
  it('signs out every other session', async () => {
    const elsewhere = await signUp('ada@example.org', 'Ada');
    expect((await api('GET', '/me', { cookie: elsewhere })).status).toBe(200);
    clearDevOutbox();
    await getAuth().api.requestPasswordReset({ body: { email: 'ada@example.org', redirectTo: '/set-password' } });
    const link = /https?:\/\/\S+/.exec(devOutbox()[0].text)![0];
    const token = /reset-password\/([^?]+)/.exec(link)![1];
    expect(
      (await authCall('POST', '/reset-password', { body: { newPassword: 'a new horse battery', token } })).status,
    ).toBe(200);
    expect((await api('GET', '/me', { cookie: elsewhere })).status).toBe(401);
  });
});

describe('a password-reset token', () => {
  it('names the account it resets, whatever the URL says', async () => {
    await signUp('ada@example.org', 'Ada');
    await signUp('bob@example.org', 'Bob');
    clearDevOutbox();
    await getAuth().api.requestPasswordReset({
      body: { email: 'bob@example.org', redirectTo: '/set-password?email=ada%40example.org' },
    });
    const link = /https?:\/\/\S+/.exec(devOutbox()[0].text)![0];
    const token = /reset-password\/([^?]+)/.exec(link)![1];
    expect(await resetTokenEmail(token)).toBe('bob@example.org');
    expect(await resetTokenEmail('not-a-token')).toBeNull();
  });
});
