/**
 * Small inline icons, drawn in `currentColor` so they take the text colour
 * of whatever they sit in. Decorative: the control carries the label.
 */

/** The "more" menu trigger: three dots, larger than the text `⋯`. */
export function MoreIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className}>
      <circle cx="4" cy="10" r="1.75" />
      <circle cx="10" cy="10" r="1.75" />
      <circle cx="16" cy="10" r="1.75" />
    </svg>
  );
}

/** Share: an arrow leaving a tray. */
export function ShareIcon({ className = 'size-3.5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 10V2M5 5l3-3 3 3" />
      <path d="M3 8v5.5h10V8" />
    </svg>
  );
}

/** Up: an arrow pointing up, for a link to something above. `1em` square, so the text size sets it. */
export function ArrowUpIcon({ className = 'size-[1em]' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 13.5V2.5M3.5 7 8 2.5 12.5 7" />
    </svg>
  );
}

/** Follow: a star, filled when following. `1em` square, so the text size sets it. */
export function StarIcon({ filled = false, className = 'size-[1em]' }: { filled?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M8 1.5l1.9 4.1 4.5.5-3.4 3 1 4.4L8 11.3l-3.9 2.2 1-4.4-3.4-3 4.5-.5z" />
    </svg>
  );
}

/** Filter: a funnel. */
export function FilterIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M2 3h12l-4.5 5.5V13l-3 1.5v-6z" />
    </svg>
  );
}

/** Copy: two sheets, one behind the other. */
export function CopyIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
      <path d="M10.5 5.5v-3a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </svg>
  );
}

/** Done: a tick. */
export function CheckIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M3 8.5l3.25 3.25L13 4.5" />
    </svg>
  );
}

/** Permalink: two links of a chain. */
export function LinkIcon({ className = 'size-[1em]' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2.5-2.5a2.5 2.5 0 0 0-3.54-3.54l-.75.75" />
      <path d="M9.25 6.75a2.5 2.5 0 0 0-3.54 0l-2.5 2.5a2.5 2.5 0 0 0 3.54 3.54l.75-.75" />
    </svg>
  );
}

/** Remove an item: a trash can. The button supplies its accessible label. */
export function TrashIcon({ className = 'size-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6M12 8v6" />
    </svg>
  );
}

/** A deliberate read marker: reading glasses, with tinted lenses when read. */
export function ReadingGlassesIcon({ read = false }: { read?: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 15 4 6h3M21.5 15 20 6h-3M10.5 14c1-1 2-1 3 0" />
      <circle cx="6.5" cy="15" r="4" fill={read ? 'currentColor' : 'none'} fillOpacity="0.2" />
      <circle cx="17.5" cy="15" r="4" fill={read ? 'currentColor' : 'none'} fillOpacity="0.2" />
    </svg>
  );
}
