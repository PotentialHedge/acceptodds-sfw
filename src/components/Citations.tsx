import Link from 'next/link';
import { bibOrder } from '@/lib/bibliography';
import type { CitedListing, ListingCitations } from '@/server/views';
import { AuthorList } from './AuthorList';
import { MathText } from './MathText';
import { Bibliography } from './References';

/**
 * A paper's back matter (#38): its bibliography, as `../research` supplied
 * it, and the papers here that cite it, both set as ICLR sets references
 * (`lib/bibliography.ts`). An entry that is a paper here links to its page.
 */
export function Citations({ citations }: { citations: ListingCitations }) {
  const { citedBy, citedByTotal } = citations;
  const references = bibOrder(
    citations.references.map(({ reference: r, cited }) => ({
      key: r.position,
      authors: r.authors.length > 0 ? r.authors : (cited?.listing.authors ?? []),
      title: r.title,
      year: r.year,
      venue: r.venue,
      url: r.url,
      cited,
    })),
  );
  const citing = bibOrder(
    citedBy.map((c) => ({
      key: c.listing.id,
      authors: c.listing.authors,
      title: c.listing.title,
      year: null,
      venue: c.listing.kind,
      url: null,
      cited: c,
    })),
  );
  return (
    <>
      {citing.length > 0 && (
        <Bibliography
          heading={citedByTotal > citedBy.length ? `Cited by (${citedBy.length} of ${citedByTotal} shown)` : 'Cited by'}
          items={citing.map(({ key, ...e }) => (
            <Entry key={key} {...e} />
          ))}
        />
      )}
      {references.length > 0 && (
        <Bibliography
          items={references.map(({ key, ...e }) => (
            <Entry key={key} {...e} />
          ))}
        />
      )}
    </>
  );
}

/** "Title. Authors. <i>Venue</i>, year." — "Title. Authors. year." with no venue. */
export function Entry({
  authors,
  title,
  year,
  venue,
  url,
  cited,
}: {
  authors: readonly string[];
  title: string;
  year: number | null;
  venue: string | null;
  url: string | null;
  cited: CitedListing | null;
}) {
  const name = <MathText text={title} />;
  return (
    <>
      {cited ? (
        <Link href={`/papers/${encodeURIComponent(cited.listing.slug)}`}>{name}</Link>
      ) : url ? (
        <a href={url} rel="noopener noreferrer" target="_blank">
          {name}
        </a>
      ) : (
        name
      )}
      .
      <span className="text-muted">
        {authors.length > 0 && (
          <>
            {' '}
            <AuthorList names={authors} />.
          </>
        )}
        {venue ? (
          <>
            {' '}
            <i>{venue}</i>
            {year !== null && `, ${year}`}.
          </>
        ) : (
          year !== null && <> {year}.</>
        )}
      </span>
      {cited && url && (
        <>
          {' '}
          <a href={url} className="font-sans text-[13px] text-accent" rel="noopener noreferrer" target="_blank">
            [link]
          </a>
        </>
      )}
    </>
  );
}
