import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cardKey, storedCard } from '@/server/card-store';

describe('storedCard', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'cards-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('draws a card once per content and serves it from disk after', async () => {
    let draws = 0;
    const draw = async () => {
      draws += 1;
      return new Uint8Array([draws]);
    };
    expect(await storedCard('l1', { title: 'A' }, draw, dir)).toEqual(new Uint8Array([1]));
    expect(await storedCard('l1', { title: 'A' }, draw, dir)).toEqual(new Uint8Array([1]));
    expect(draws).toBe(1);
  });

  it('replaces a listing’s older card when its content changes', async () => {
    const draw = async () => new Uint8Array([7]);
    await storedCard('l1', { title: 'A' }, draw, dir);
    await storedCard('l1', { title: 'B' }, draw, dir);
    expect(await readdir(path.join(dir, 'l1'))).toEqual([`${cardKey({ title: 'B' })}.png`]);
  });

  it('draws one card at a time', async () => {
    let running = 0;
    let most = 0;
    const draw = async () => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, 5));
      running -= 1;
      return new Uint8Array([1]);
    };
    await Promise.all(['a', 'b', 'c'].map((id) => storedCard(id, {}, draw, dir)));
    expect(most).toBe(1);
  });

  it('still draws when the directory cannot be written', async () => {
    const notADir = path.join(dir, 'file');
    await writeFile(notADir, '');
    const png = await storedCard('l1', {}, async () => new Uint8Array([3]), notADir);
    expect(png).toEqual(new Uint8Array([3]));
  });
});
