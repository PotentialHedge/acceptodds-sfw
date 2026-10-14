import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { groupReadingList, listingReads, listings } from '@/db/schema';
import { readingGroupIdsForListing } from '@/server/reading';
import { upsertListing } from '@/server/listings';
import { api, signUp, trader } from './api-client';
import { closePool, resetDatabase, seedMarket } from './helpers';

beforeEach(async () => {
  await resetDatabase();
  process.env.API_RATE_LIMIT_BURST = '1000';
  process.env.API_RATE_LIMIT_PER_SECOND = '1000';
  await seedMarket(0, 10);
});
afterAll(closePool);

async function fixture() {
  const alice = await trader('alice', ['read']);
  const bob = await trader('bob', ['read']);
  const outsider = await trader('outsider', ['read']);
  const group = (await api('POST', '/groups', { token: alice.token, body: { name: 'Reading together' } })).body;
  await api('POST', '/groups/join', { token: bob.token, body: { inviteCode: group.inviteCode } });
  const { listing } = await upsertListing({ slug: 'read-me', title: 'Read me', authors: [], links: [] });
  return { alice, bob, outsider, group, listing };
}

describe('reading lists', () => {
  it('gives each paper’s venue, never a price', async () => {
    const { alice, group } = await fixture();
    const { listing: venued } = await upsertListing({ slug: 'venued', title: 'Venued', kind: 'ICLR 2027' });
    await api('PUT', `/groups/${group.id}/reading-list/${venued.id}`, { token: alice.token });
    const [entry] = (await api('GET', `/groups/${group.id}/reading-list`)).body.entries;
    expect(entry.venue).toBe('ICLR 2027');
    expect(entry).not.toHaveProperty('headline');
  });

  it('lets any member add and remove, idempotently; excludes outsiders and institutions', async () => {
    const { alice, bob, outsider, group, listing } = await fixture();
    const path = `/groups/${group.id}/reading-list/${listing.id}`;
    expect(await readingGroupIdsForListing(bob.id, listing.id)).toEqual(new Set());
    expect((await api('PUT', path)).status).toBe(401);
    expect((await api('PUT', path, { token: outsider.token })).status).toBe(403);
    for (let i = 0; i < 2; i++) expect((await api('PUT', path, { token: bob.token })).status).toBe(200);
    expect(await readingGroupIdsForListing(bob.id, listing.id)).toEqual(new Set([group.id]));
    expect(await readingGroupIdsForListing(outsider.id, listing.id)).toEqual(new Set());
    const res = await api('GET', `/groups/${group.id}/reading-list`);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    expect(res.body.entries[0]).toMatchObject({ listingId: listing.id, slug: listing.slug, title: listing.title });
    expect(res.body.entries[0].status).toMatchObject({ readers: [], memberCount: 2 });
    expect((await api('DELETE', path, { token: outsider.token })).status).toBe(403);
    for (let i = 0; i < 2; i++) expect((await api('DELETE', path, { token: alice.token })).status).toBe(200);
    expect((await api('GET', `/groups/${group.id}/reading-list`)).body.entries).toEqual([]);
    expect(await readingGroupIdsForListing(bob.id, listing.id)).toEqual(new Set());
    expect(
      (await api('PUT', `/groups/Test%20University/reading-list/${listing.id}`, { token: alice.token })).status,
    ).toBe(400);
    expect(
      (
        await api('PUT', `/groups/00000000-0000-4000-8000-000000000000/reading-list/${listing.id}`, {
          token: alice.token,
        })
      ).status,
    ).toBe(404);
    expect((await api('PUT', `/groups/${group.id}/reading-list/unknown`, { token: alice.token })).status).toBe(404);
    await api('DELETE', `/groups/${group.id}/members/bob`, { token: bob.token });
    expect((await api('PUT', path, { token: bob.token })).status).toBe(403);
  });

  it('keeps read markers global and shows only each group’s current members', async () => {
    const { alice, bob, outsider, group, listing } = await fixture();
    const other = (await api('POST', '/groups', { token: bob.token, body: { name: 'Second reading group' } })).body;
    for (const id of [group.id, other.id]) {
      expect((await api('PUT', `/groups/${id}/reading-list/${listing.id}`, { token: bob.token })).status).toBe(200);
    }
    const readPath = `/listings/${listing.id}/read`;
    expect((await api('PUT', readPath)).status).toBe(401);
    for (let i = 0; i < 2; i++) expect((await api('PUT', readPath, { token: bob.token })).status).toBe(200);
    await api('PUT', readPath, { token: outsider.token });
    for (const id of [group.id, other.id]) {
      const status = (await api('GET', `/groups/${id}/reading-list`, { token: bob.token })).body.entries[0].status;
      expect(status.read).toBe(true);
      expect(status.readers.map((p: { handle: string }) => p.handle)).toEqual(['bob']);
      expect(status.memberCount).toBe(id === group.id ? 2 : 1);
    }
    // Even the personal read endpoint never exposes unrelated readers.
    expect((await api('GET', readPath)).body.readers).toEqual([]);
    expect(
      (await api('GET', readPath, { token: alice.token })).body.readers.map((p: { handle: string }) => p.handle),
    ).toEqual(['bob']);
    for (let i = 0; i < 2; i++) expect((await api('DELETE', readPath, { token: bob.token })).status).toBe(200);
    expect(
      (await api('GET', `/groups/${other.id}/reading-list`, { token: bob.token })).body.entries[0].status.read,
    ).toBe(false);
    await api('PUT', readPath, { token: bob.token });
    await api('DELETE', `/groups/${group.id}/members/bob`, { token: bob.token });
    const status = (await api('GET', `/groups/${group.id}/reading-list`)).body.entries[0].status;
    expect(status.readers).toEqual([]);
    expect(status.memberCount).toBe(1);
    expect((await api('GET', readPath, { token: bob.token })).body.read).toBe(true);
    await api('DELETE', `/groups/${other.id}`, { token: bob.token });
    expect(await getDb().select().from(groupReadingList).where(eq(groupReadingList.groupId, other.id))).toEqual([]);
    expect((await api('GET', readPath, { token: bob.token })).body.read).toBe(true);
    await getDb().delete(listings).where(eq(listings.id, listing.id));
    expect(await getDb().select().from(listingReads)).toEqual([]);
    expect(await getDb().select().from(groupReadingList)).toEqual([]);
  });

  it('enforces read scope and same-origin browser writes', async () => {
    const { group, listing, alice } = await fixture();
    const noRead = await trader('no-read', ['trade']);
    expect((await api('PUT', `/listings/${listing.id}/read`, { token: noRead.token })).status).toBe(403);
    expect((await api('PUT', `/groups/${group.id}/reading-list/${listing.id}`, { token: noRead.token })).status).toBe(
      403,
    );
    expect((await api('GET', `/groups/${group.id}/reading-list`, { token: 'invalid' })).status).toBe(401);
    const cookie = await signUp('reader@example.org');
    const readPath = `/listings/${listing.id}/read`;
    expect((await api('PUT', readPath, { cookie, origin: null })).status).toBe(403);
    expect((await api('PUT', readPath, { cookie, origin: 'https://elsewhere.invalid' })).status).toBe(403);
    expect((await api('PUT', readPath, { cookie })).status).toBe(200);
    await api('PUT', `/groups/${group.id}/reading-list/${listing.id}`, { token: alice.token });
    expect((await api('DELETE', `/groups/${group.id}/reading-list/${listing.id}`, { cookie })).status).toBe(403);
  });
});
