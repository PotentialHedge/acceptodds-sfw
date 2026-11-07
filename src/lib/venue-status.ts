/**
 * A paper's outcome at its venue, as the creating client marks it (`listings.venue_status`); `null`
 * while it is under review. Two outcomes take it out of review early, withdrawn by its authors or
 * desk-rejected by the venue: the lists and the map leave those out unless asked. The rest are the
 * venue's decision, and leave the paper where it is. Shared by the server and the pages that label it.
 * Search spells it `outcome:` (`lib/query.ts`).
 */
export const VENUE_STATUSES = [
  'withdrawn',
  'desk_rejected',
  'rejected',
  'accepted',
  'poster',
  'spotlight',
  'oral',
] as const;
export type VenueStatus = (typeof VENUE_STATUSES)[number];

/** Out of review before a decision: hidden from the lists and the map unless asked. */
export const OUT_STATUSES = ['withdrawn', 'desk_rejected'] as const satisfies readonly VenueStatus[];

/** Accepted, at whichever tier the venue named; `accepted` when it named none. */
export const ACCEPTED_STATUSES = ['accepted', 'poster', 'spotlight', 'oral'] as const satisfies readonly VenueStatus[];

export function isOut(status: VenueStatus | null | undefined): boolean {
  return status != null && (OUT_STATUSES as readonly string[]).includes(status);
}

const LABEL: Record<VenueStatus, string> = {
  withdrawn: 'Withdrawn',
  desk_rejected: 'Desk rejected',
  rejected: 'Rejected',
  accepted: 'Accepted',
  poster: 'Accepted (poster)',
  spotlight: 'Accepted (spotlight)',
  oral: 'Accepted (oral)',
};

/** The label a list puts on such a paper. */
export function venueStatusLabel(status: VenueStatus): string {
  return LABEL[status];
}

/** "Withdrawn from ICLR 2027", "Accepted at ICLR 2027 (oral)": the paper page's running head. */
export function venueStatusLine(status: VenueStatus, kind: string): string {
  if (status === 'withdrawn') return `Withdrawn from ${kind}`;
  const tier = (['poster', 'spotlight', 'oral'] as const).find((t) => t === status);
  if (tier) return `Accepted at ${kind} (${tier})`;
  return `${LABEL[status]} at ${kind}`;
}
