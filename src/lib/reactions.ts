/**
 * Emoji reactions to a paper (safe for work edition). Pure helpers shared by
 * the server (`server/reactions.ts`), the API and the paper page's picker.
 */

/** What the picker offers first: GitHub's reactions, in GitHub's order. Stored without U+FE0F (`canonicalEmoji`). */
export const SUGGESTED_REACTIONS = ['👍', '👎', '😄', '🎉', '😕', '❤', '🚀', '👀'] as const;

/** How many different emoji one account may put on one paper. */
export const MAX_REACTIONS_PER_ACCOUNT = 20;

/** The column's limit, in code points (`listing_reactions_emoji_length`). */
const MAX_CODE_POINTS = 16;

const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;
const VARIATION_SELECTOR = /️/g;

/**
 * One emoji, as it is stored and compared: a single grapheme that is an emoji
 * (a pictograph, a flag or a keycap), with every emoji-presentation selector
 * (U+FE0F) dropped, so "❤️" and "❤" are one reaction. `null` for anything
 * else: text, several emoji, or nothing.
 */
export function canonicalEmoji(raw: string): string | null {
  const s = raw.trim();
  if (s.length === 0) return null;
  const graphemes = [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)];
  if (graphemes.length !== 1 || !PICTOGRAPHIC.test(s)) return null;
  const bare = s.replace(VARIATION_SELECTOR, '');
  if ([...bare].length > MAX_CODE_POINTS) return null;
  return bare;
}

/**
 * How to draw a stored emoji: one whose single code point defaults to text
 * presentation ("❤") gets U+FE0F back, so it shows in colour.
 */
export function displayEmoji(emoji: string): string {
  const points = [...emoji];
  return points.length === 1 && !/\p{Emoji_Presentation}/u.test(emoji) ? `${emoji}️` : emoji;
}
