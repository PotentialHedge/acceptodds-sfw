'use client';

import { useEffect } from 'react';
import { track } from '@/lib/track';

/**
 * The split test's other half (`lib/split.ts`): a visitor who could have been sent to PotentialPaper and stayed. The
 * ones sent arrive there with `?ref=acceptodds`; these are counted here, so the two halves can be compared.
 */
export function SplitControl() {
  useEffect(() => track('split_stayed'), []);
  return null;
}
