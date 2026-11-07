import { ui } from './ui';

/** A search for papers at `kind` (any venue when null) whose `field` contains `value`. */
function searchFor(field: 'area' | 'keyword', value: string, kind: string | null): string {
  // A quote inside the value would end the search's own quotes early.
  const q = `${field}:"${value.replace(/["`]/g, '')}"`;
  return `/?${new URLSearchParams({ ...(kind ? { kind } : {}), q })}`;
}

/**
 * A paper's primary area and keywords, under its abstract as a paper sets
 * them, each a search for the papers at its venue that share it. Nothing
 * when the paper has neither.
 */
export function PaperTopics({
  area,
  keywords,
  kind,
}: {
  area: string | null;
  keywords: readonly string[];
  kind: string | null;
}) {
  // About one ICLR 2027 paper in eight has its keywords in one, joined by semicolons, as its authors typed them.
  const shown = [...new Set(keywords.flatMap((k) => k.split(';')).map((k) => k.trim()))].filter((k) => k !== '');
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
              <span key={k}>
                {i > 0 && ', '}
                <a href={searchFor('keyword', k, kind)} className={link}>
                  {k}
                </a>
              </span>
            ))}
          </dd>
        </div>
      )}
    </dl>
  );
}
