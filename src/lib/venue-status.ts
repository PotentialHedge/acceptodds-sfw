/**
 * A paper's standing at its venue once it has left review early, as the creating client marks it
 * (`listings.venue_status`): withdrawn by its authors, or desk-rejected by the venue. Either way the
 * lists and the map leave it out unless asked. Shared by the server and the pages that label it.
 */
export const VENUE_STATUSES = ['withdrawn', 'desk_rejected'] as const;
export type VenueStatus = (typeof VENUE_STATUSES)[number];

/** The label a list puts on such a paper. */
export function venueStatusLabel(status: VenueStatus): string {
  return status === 'withdrawn' ? 'Withdrawn' : 'Desk rejected';
}

/** "Withdrawn from ICLR 2027", "Desk rejected at ICLR 2027": the paper page's running head. */
export function venueStatusLine(status: VenueStatus, kind: string): string {
  return status === 'withdrawn' ? `Withdrawn from ${kind}` : `Desk rejected at ${kind}`;
}
