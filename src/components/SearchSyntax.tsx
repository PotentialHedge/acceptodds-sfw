import { FIELD_HELP } from '@/lib/query';

/** Filters that read a market: still parsed, never offered here (safe for work edition). */
const MARKET_FIELDS = new Set(['status', 'accept', 'volume', 'trades']);
import { ui } from './ui';

/**
 * Help for the search syntax (`lib/query.ts`), wherever it is spoken: the
 * home page's `?` and filter menu, and the map's search. `people`: words
 * alone also find traders there.
 */
export function SearchSyntax({ people = false }: { people?: boolean }) {
  return (
    <>
      <p>
        Words search titles, authors and abstracts; the last one may be half-typed. <code>&quot;a phrase&quot;</code>{' '}
        matches in order, <code>-word</code> excludes.{people && ' Words alone also find people.'} Terms are ANDed; use{' '}
        <code>OR</code> and <code>( )</code> to group, and <code>-</code> before a filter or group to negate it.
      </p>
      <table className={ui.table}>
        <thead>
          <tr>
            <th className={ui.th()}>Filter</th>
            <th className={ui.th()}>Means</th>
            <th className={`${ui.th()} narrow:hidden`}>Also</th>
          </tr>
        </thead>
        <tbody>
          {FIELD_HELP.filter((f) => !MARKET_FIELDS.has(f.field)).map((f) => (
            <tr key={f.field}>
              <td className={`${ui.td} font-mono text-ink`}>{f.example}</td>
              <td className={ui.td}>{f.means}</td>
              <td className={`${ui.td} text-faint narrow:hidden`}>{f.aliases.map((a) => `${a}:`).join(' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5">
        Filters take <code>:</code> and <code>!=</code>. Quote a value with spaces. For example:{' '}
        <code>(venue:iclr OR venue:neurips) diffusion -keyword:survey</code>
      </p>
    </>
  );
}
