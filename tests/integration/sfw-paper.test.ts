/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are checked field by field */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { upsertListing } from '@/server/listings';
import { api, trader } from './api-client';
import { closePool, resetDatabase } from './helpers';

/** The safe for work edition's paper page: emoji reactions and the listing's own discussion. */

beforeEach(async () => {
  await resetDatabase();
  process.env.API_RATE_LIMIT_BURST = '1000';
  process.env.API_RATE_LIMIT_PER_SECOND = '1000';
}, 60_000);

afterAll(async () => {
  await closePool();
});

const paper = async (slug = 'p1') => (await upsertListing({ slug, title: `Paper ${slug}`, kind: 'ICLR 2027' })).listing;
const rocket = encodeURIComponent('🚀');

describe('reactions', () => {
  it('counts per emoji, anonymously, idempotently, with the caller’s own marked', async () => {
    const l = await paper();
    const a = await trader('ann', ['read']);
    const b = await trader('bob', ['read']);

    expect((await api('GET', `/listings/${l.id}/reactions`)).body.reactions).toEqual([]);
    expect((await api('PUT', `/listings/${l.id}/reactions/${rocket}`, { token: a.token })).status).toBe(200);
    await api('PUT', `/listings/${l.id}/reactions/${rocket}`, { token: a.token }); // again: no change
    await api('PUT', `/listings/${l.slug}/reactions/${rocket}`, { token: b.token });
    // ❤️ and ❤ are one reaction, stored without the selector.
    await api('PUT', `/listings/${l.id}/reactions/${encodeURIComponent('❤️')}`, { token: b.token });

    const anon = await api('GET', `/listings/${l.id}/reactions`);
    expect(anon.body.reactions).toEqual([
      { emoji: '🚀', count: 2, mine: false },
      { emoji: '❤', count: 1, mine: false },
    ]);
    expect(JSON.stringify(anon.body)).not.toContain('ann');
    const mine = await api('GET', `/listings/${l.id}/reactions`, { token: a.token });
    expect(mine.body.reactions.find((r: any) => r.emoji === '🚀').mine).toBe(true);

    const off = await api('DELETE', `/listings/${l.id}/reactions/${rocket}`, { token: a.token });
    expect(off.body.reactions).toEqual([
      { emoji: '🚀', count: 1, mine: false },
      { emoji: '❤', count: 1, mine: false },
    ]);
  });

  it('refuses anything but one emoji, and an anonymous caller', async () => {
    const l = await paper();
    const a = await trader('ann', ['read']);
    for (const bad of ['a', encodeURIComponent('🚀🚀'), encodeURIComponent('<b>')]) {
      const res = await api('PUT', `/listings/${l.id}/reactions/${bad}`, { token: a.token });
      expect(res.status).toBe(400);
    }
    expect((await api('PUT', `/listings/${l.id}/reactions/${rocket}`)).status).toBe(401);
  });

  it('caps the different emoji one account puts on one paper', async () => {
    const l = await paper();
    const a = await trader('ann', ['read']);
    const many = [...'😀😁😂🤣😃😄😅😆😉😊😋😎😍😘🥰😗😙🥲😚🙂🤗🤩'];
    const statuses = [];
    for (const e of many) {
      statuses.push(
        (await api('PUT', `/listings/${l.id}/reactions/${encodeURIComponent(e)}`, { token: a.token })).status,
      );
    }
    expect(statuses.filter((s) => s === 200)).toHaveLength(20);
    expect(statuses.at(-1)).toBe(409);
    // Repeating one already there is still fine.
    expect(
      (await api('PUT', `/listings/${l.id}/reactions/${encodeURIComponent('😀')}`, { token: a.token })).status,
    ).toBe(200);
  });
});

describe('a paper’s discussion', () => {
  it('posts and lists pseudonymous comments and replies with no stake or backing', async () => {
    const l = await paper();
    const a = await trader('ann', ['read']);
    const b = await trader('bob', ['read']);

    const top = await api('POST', `/listings/${l.id}/comments`, { token: a.token, body: { body: 'Nice result.' } });
    expect(top.status).toBe(201);
    expect(top.body.author.isYou).toBe(true);
    expect(top.body).not.toHaveProperty('backing');
    expect(top.body.author).not.toHaveProperty('stake');

    const reply = await api('POST', `/listings/${l.slug}/comments`, {
      token: b.token,
      body: { body: `@${top.body.author.alias} agreed`, parentId: top.body.id },
    });
    expect(reply.status).toBe(201);
    expect(reply.body.mentions).toEqual([top.body.author.alias]);

    const list = await api('GET', `/listings/${l.id}/comments?limit=20`, { token: a.token });
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    expect(list.body.comments.map((c: any) => c.id)).toEqual([top.body.id]);
    expect(list.body.replies.map((c: any) => c.id)).toEqual([reply.body.id]);
    expect(list.body.viewerAlias).toBe(top.body.author.alias);
    expect(JSON.stringify(list.body)).not.toMatch(/ann|bob/);

    const replies = await api('GET', `/listings/${l.id}/comments/${top.body.id}/replies`);
    expect(replies.body.replies.map((c: any) => c.id)).toEqual([reply.body.id]);
  });

  it('needs a confirmed institutional address, and a reply on the same paper', async () => {
    const l = await paper();
    const other = await paper('p2');
    const unverified = await trader('uma', ['read'], { verified: false });
    const res = await api('POST', `/listings/${l.id}/comments`, { token: unverified.token, body: { body: 'hi' } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('not_verified');

    const a = await trader('ann', ['read']);
    const top = await api('POST', `/listings/${l.id}/comments`, { token: a.token, body: { body: 'one' } });
    const elsewhere = await api('POST', `/listings/${other.id}/comments`, {
      token: a.token,
      body: { body: 'two', parentId: top.body.id },
    });
    expect(elsewhere.status).toBe(404);
  });
});
