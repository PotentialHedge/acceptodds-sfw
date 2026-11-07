import { ui } from './ui';

/** A search for papers at `kind` (any venue when null) whose `field` contains `value`. */
function searchFor(field: 'area' | 'keyword', value: string, kind: string | null): string {
  // A quote inside the value would end the search's own quotes early.
  const q = `${field}:"${value.replace(/["`]/g, '')}"`;
  return `/?${new URLSearchParams({ ...(kind ? { kind } : {}), q })}`;
}

/**
 * A paper's keywords as shown: each one split at semicolons (about one ICLR 2027 paper in eight has all
 * of them in one, as its authors typed them), as written, with what to search for it. With `tags` (one
 * per keyword, `listings.tags`) that is its tag, which its other spellings share, and a keyword whose
 * tag an earlier one has is left out ("LLMs" after "Large Language Models"); without, it is the
 * keyword itself, and only exact repeats go.
 */
export function shownKeywords(
  keywords: readonly string[],
  tags: readonly string[],
): { text: string; search: string }[] {
  const parts = keywords
    .flatMap((k) => k.split(';'))
    .map((k) => k.trim())
    .filter((k) => k !== '');
  // Tags line up with the parts, or are stale (the keywords changed since): then they are not used.
  const aligned = tags.length === parts.length;
  const seen = new Set<string>();
  return parts.flatMap((text, i) => {
    const search = aligned ? tags[i] : text;
    const key = search.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ text, search }];
  });
}

/**
 * A paper's primary area and keywords, under its abstract as a paper sets
 * them, each a search for the papers at its venue that share it: the
 * keywords as the authors wrote them, each searching for its other
 * spellings too (`shownKeywords`). Nothing when the paper has neither.
 */
export function PaperTopics({
  area,
  keywords,
  tags,
  kind,
}: {
  area: string | null;
  keywords: readonly string[];
  tags: readonly string[];
  kind: string | null;
}) {
  const shown = shownKeywords(keywords, tags);
  if (!area && shown.length === 0) return null;
  const link = 'text-accent hover:underline';
  return (
    <dl className="mx-auto mt-4 max-w-[min(680px,85%)] space-y-1 text-left text-[14px] leading-[1.55]">
      {area && (
        <div>
          <dt className={`${ui.runIn} inline`}>Primary area:</dt>{' '}
          <dd className="inline">
            <a href={searchFor('area', area, kind)} className={link}>
              {area}
            </a>
          </dd>
        </div>
      )}
      {shown.length > 0 && (
        <div>
          <dt className={`${ui.runIn} inline`}>Keywords:</dt>{' '}
          <dd className="inline">
            {shown.map((k, i) => (
              <span key={k.search}>
                {i > 0 && ', '}
                <a href={searchFor('keyword', k.search, kind)} className={link}>
                  {k.text}
                </a>
              </span>
            ))}
          </dd>
        </div>
      )}
    </dl>
  );
}
