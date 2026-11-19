import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Share cards on disk (`CARD_CACHE_DIR`), so each is drawn once per content
 * rather than once per process and hour: a crawler walking thousands of papers
 * otherwise draws every card, and drawing holds the event loop for long
 * enough to fail the health check (2026-11-19). The directory is a volume the
 * app containers share, so one container's drawing serves the others and
 * outlives a deploy.
 *
 * A card's file is named by the hash of everything drawn on it, under a
 * directory per listing; a new hash replaces the listing's older files. Bump
 * `CARD_DESIGN` whenever the drawing changes without its inputs changing.
 * Unset `CARD_CACHE_DIR` (the tests, dev) keeps nothing on disk. Disk errors
 * are logged and fall back to drawing: the cache never fails a card.
 */
const CARD_DESIGN = 1;

/** Cards drawn at once in this process; the rest wait, so pages keep being served meanwhile. */
const DRAWING_AT_ONCE = 1;

let drawing = 0;
const waiting: (() => void)[] = [];

async function oneAtATime<T>(draw: () => Promise<T>): Promise<T> {
  if (drawing >= DRAWING_AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
  else drawing += 1;
  try {
    return await draw();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else drawing -= 1;
  }
}

export function cardKey(inputs: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([CARD_DESIGN, inputs]))
    .digest('hex')
    .slice(0, 32);
}

/** The card for `listingId` drawn from `inputs`: from disk if drawn before, else drawn (one at a time) and kept. */
export async function storedCard(
  listingId: string,
  inputs: unknown,
  draw: () => Promise<Uint8Array<ArrayBuffer>>,
  dir: string | undefined = process.env.CARD_CACHE_DIR,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!dir) return oneAtATime(draw);
  const key = cardKey(inputs);
  const folder = path.join(dir, encodeURIComponent(listingId));
  const file = path.join(folder, `${key}.png`);
  try {
    return new Uint8Array(await readFile(file));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error('reading a stored card failed', err);
  }
  const png = await oneAtATime(draw);
  try {
    await mkdir(folder, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, png);
    await rename(tmp, file);
    for (const name of await readdir(folder)) {
      if (name !== `${key}.png` && !name.endsWith('.tmp')) await rm(path.join(folder, name), { force: true });
    }
  } catch (err) {
    console.error('storing a card failed', err);
  }
  return png;
}
