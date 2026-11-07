import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { OUT_STATUSES, type VenueStatus } from '@/lib/venue-status';

/** `venue_status` as a SQL list of fixed literals, never input. */
export function statusList(statuses: readonly VenueStatus[]): SQL {
  return sql.raw(statuses.map((s) => `'${s}'`).join(', '));
}

/**
 * A paper with this `venue_status` is listed: under review, or decided. Withdrawn and desk-rejected
 * papers are not (`lib/venue-status.ts`). True for a row with no listing, whose column is null.
 */
export function listed(column: AnyColumn | SQL): SQL {
  return sql`(${column} is null or ${column} not in (${statusList(OUT_STATUSES)}))`;
}
