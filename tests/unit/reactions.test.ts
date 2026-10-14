import { describe, expect, it } from 'vitest';
import { canonicalEmoji, displayEmoji, SUGGESTED_REACTIONS } from '@/lib/reactions';

describe('canonicalEmoji', () => {
  it('accepts every suggested reaction as it is stored', () => {
    for (const e of SUGGESTED_REACTIONS) expect(canonicalEmoji(e)).toBe(e);
  });

  it('treats a heart with and without the presentation selector as one', () => {
    expect(canonicalEmoji('❤️')).toBe('❤');
    expect(canonicalEmoji('❤')).toBe('❤');
  });

  it('accepts one emoji of any shape', () => {
    expect(canonicalEmoji('👩‍🔬')).toBe('👩‍🔬');
    expect(canonicalEmoji('👍🏽')).toBe('👍🏽');
    expect(canonicalEmoji('🇨🇭')).toBe('🇨🇭');
    expect(canonicalEmoji('1️⃣')).toBe('1⃣');
    expect(canonicalEmoji(' 🚀 ')).toBe('🚀');
  });

  it('refuses text, several emoji and nothing', () => {
    for (const s of ['', ' ', 'a', 'ok', '1', '🚀🚀', '👍 👍', '🚀a', '<script>']) expect(canonicalEmoji(s)).toBeNull();
  });
});

describe('displayEmoji', () => {
  it('puts the presentation selector back on a text-default emoji only', () => {
    expect(displayEmoji('❤')).toBe('❤️');
    expect(displayEmoji('🚀')).toBe('🚀');
    expect(displayEmoji('👩‍🔬')).toBe('👩‍🔬');
  });
});
