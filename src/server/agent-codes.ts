import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { getDb, type Database } from '@/db';
import { user } from '@/db/auth-schema';
import { agentCodes, type Account } from '@/db/schema';
/** The name of the key an agent signs in for (market edition; its routes are 404s here). */
const AGENT_KEY_NAME = 'ai-agent';
import { agentCodeMail } from '@/lib/auth-mails';
import { ensureAccountForUser } from './accounts';
import { normalizeEmail } from './affiliations';
import { ApiError } from './api/errors';
import { revokeUnprovenAccess } from './better-auth';
import { institutionForEmail } from './institution-domains';
import { sendMail } from './mail';
import { userForEmail } from './onboarding';
import { consume, rateLimitHeaders, type RateLimitConfig } from './ratelimit';
import { siteUrl } from './share';
import { mintToken, type MintedToken } from './tokens';

/**
 * How an AI agent signs in for a person (`/agent/start`): it asks them for
 * their email, `requestAgentCode` mails that address a 6-digit code, the
 * person gives it to the agent, and `redeemAgentCode` trades address + code
 * for a `read` + `trade` API key named {@link AGENT_KEY_NAME}. The inbox is
 * the proof, as for every sign-in here; the agent never sees a password or
 * a session.
 *
 * An address with no account gets a code too: asking makes a Better Auth
 * user for it (no name, no credential, unconfirmed, as onboarding does), and
 * redeeming the code confirms the address — the inbox is proven exactly as
 * by a confirmation link — which makes the trader account and its starting
 * balance (`ensureAccountForUser`). So a person can start with their agent
 * alone, and there is still no account or reputation before confirmation.
 *
 * A signed-in person skips the mail: `issueAgentCode` puts a code straight
 * into the prompt they copy.
 *
 * A million codes, at most {@link MAX_ATTEMPTS} wrong guesses each, one
 * outstanding per account and only for {@link MAILED_TTL_MS} (mailed) or
 * {@link PROMPT_TTL_MS} (in a prompt): guessing one is 1 in 200,000.
 * Asking again replaces the code. `agent_codes` is written only here.
 */

/** How long a mailed code works. */
export const MAILED_TTL_MS = 30 * 60 * 1000;
/** How long a code in a signed-in person's prompt works. */
export const PROMPT_TTL_MS = 60 * 60 * 1000;
/** Wrong guesses allowed against one code; then it is gone. */
export const MAX_ATTEMPTS = 5;
/** Agent-code mails per address: 5, refilling over a day, like sign-in links. */
const MAIL_BUDGET: RateLimitConfig = { burst: 5, perSecond: 5 / 86_400 };

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

/**
 * Mails `email` a code for an agent, replacing any outstanding one. An
 * address with no user gets one made (unconfirmed), and its mail says the
 * code also makes the account; the answer is the same either way, so only
 * the inbox learns which. Unlisted domains are refused (the list is public),
 * and each address has a mail budget of its own.
 */
export async function requestAgentCode(rawEmail: string, database: Database = getDb()): Promise<void> {
  const email = normalizeEmail(rawEmail);
  if (!institutionForEmail(email)) {
    throw new ApiError(
      422,
      'email_domain_not_allowed',
      'accounts are open to approved institutional email domains only, without a +tag',
    );
  }
  const budget = await consume(`agent-code-mail:${email}`, MAIL_BUDGET);
  if (!budget.allowed) {
    throw new ApiError(
      429,
      'rate_limited',
      'too many agent codes mailed to this address; try again later',
      { retryAfterSeconds: budget.retryAfterSeconds },
      rateLimitHeaders(budget),
    );
  }

  const person = await userForEmail(email, database);
  const { code } = await storeCode(person.id, MAILED_TTL_MS, database);
  await sendMail({ to: email, ...agentCodeMail(code, siteUrl(), { newAccount: !person.emailVerified }) });
}

/**
 * A code for a signed-in person's own prompt (`[onboard your agent]`, by
 * session only), with their login address, which the agent redeems as it
 * would a mailed one. Shorter-lived than a mailed code: it sits on a
 * clipboard and in a chat log, not in an inbox.
 */
export async function issueAgentCode(
  account: Account,
  database: Database = getDb(),
): Promise<{ email: string; code: string; expiresAt: Date }> {
  const [login] = account.userId
    ? await database.select({ id: user.id, email: user.email }).from(user).where(eq(user.id, account.userId))
    : [];
  if (!login) throw new ApiError(403, 'session_required', 'this account has no sign-in');
  return { email: normalizeEmail(login.email), ...(await storeCode(login.id, PROMPT_TTL_MS, database)) };
}

/** A new code for this user, replacing any it had. */
async function storeCode(
  userId: string,
  ttlMs: number,
  database: Database,
): Promise<{ code: string; expiresAt: Date }> {
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const row = { codeHash: hashCode(code), expiresAt: new Date(Date.now() + ttlMs), attempts: 0, createdAt: new Date() };
  await database
    .insert(agentCodes)
    .values({ userId, ...row })
    .onConflictDoUpdate({ target: agentCodes.userId, set: row });
  return { code, expiresAt: row.expiresAt };
}

/**
 * The address's code for a new API key, used up by it. Every failure is the
 * same `invalid_code`, whether the address, the code or its age was wrong.
 * A wrong guess counts, committed.
 *
 * The right code for an unconfirmed address confirms it, as a confirmation
 * link would: first dropping any password or session set before the inbox
 * was proven (`revokeUnprovenAccess`), then making the trader account.
 */
export async function redeemAgentCode(
  input: { email: string; code: string },
  database: Database = getDb(),
): Promise<MintedToken & { accountId: string }> {
  const email = normalizeEmail(input.email);
  const person = await database.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(sql`lower(${user.email})`, email));
    if (!owner) return null;
    const [code] = await tx.select().from(agentCodes).where(eq(agentCodes.userId, owner.id)).for('update');
    if (!code) return null;
    if (code.expiresAt.getTime() <= Date.now() || code.attempts >= MAX_ATTEMPTS) {
      await tx.delete(agentCodes).where(eq(agentCodes.userId, owner.id));
      return null;
    }
    const given = Buffer.from(hashCode(input.code.trim()), 'hex');
    if (!timingSafeEqual(given, Buffer.from(code.codeHash, 'hex'))) {
      await tx
        .update(agentCodes)
        .set({ attempts: sql`${agentCodes.attempts} + 1` })
        .where(eq(agentCodes.userId, owner.id));
      return null;
    }
    // Used up before the key exists: a failed mint costs a new code, never a second key.
    await tx.delete(agentCodes).where(eq(agentCodes.userId, owner.id));
    if (!owner.emailVerified) {
      await revokeUnprovenAccess(owner.id, tx);
      await tx.update(user).set({ emailVerified: true }).where(eq(user.id, owner.id));
    }
    return owner;
  });
  if (!person) {
    throw new ApiError(422, 'invalid_code', 'that email and code do not match a live code; ask for a new one');
  }
  // After the commit, like Better Auth's `afterEmailVerification`; idempotent, and repeated lazily by any session.
  const account = await ensureAccountForUser(person, database);
  const minted = await mintToken({ account, name: AGENT_KEY_NAME, scopes: ['read', 'trade'] });
  return { ...minted, accountId: account.id };
}
