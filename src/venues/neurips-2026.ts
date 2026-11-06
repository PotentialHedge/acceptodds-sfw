import type { Venue } from './types';

/**
 * Papers accepted at NeurIPS 2026. The decisions were public before the venue opened, so its markets are on
 * citations: whether a paper is in the top quarter of its own track by Semantic Scholar citation count on
 * 1 December 2027. Each track (main, Evaluations & Datasets, position, journal) is its own cohort, so a
 * benchmark is never ranked against a method paper.
 */
export const NEURIPS_2026: Venue = {
  kind: 'NeurIPS 2026',

  runningHead: 'Published as a conference paper at NeurIPS 2026',
  headlineLabel: 'top 25%',
  chanceOf: 'this paper is in the top 25% most cited by December 2027',
  shareSuffix: ' top-cited @ NeurIPS 2026?',

  market: {
    question: 'Will this paper be in the top 25% most cited by December 2027',
    subtitle:
      'Ranked among the NeurIPS papers in its own track, by Semantic Scholar citation count on 1 December 2027.',
    contract: [
      "This market settles on the paper's Semantic Scholar citation count on 1 December 2027 (UTC), self-citations included, against every paper accepted to **this paper's track** of NeurIPS 2026 (main track, Evaluations & Datasets, position papers or journal track), as NeurIPS lists the track.",
      '',
      "- **Top 25%**: the paper's count is at or above the 75th percentile of its track's counts.",
      '- **Not top 25%**: it is below. This also covers a paper that is withdrawn or retracted.',
      '',
      "A paper's preprint and proceedings versions count as one paper.",
    ].join('\n'),
    outcomes: [
      // A quarter of each track is in its top 25%, by definition.
      { label: 'Top 25%', color: 'green', openingPrice: 0.25 },
      { label: 'Not top 25%', color: 'red', openingPrice: 0.75 },
    ],
    closesAt: new Date('2027-12-01T00:00:00Z'),
    expectedTraders: 6,
    // JEV is calibrated on acceptance, not citations: every paper opens at the base rate.
    jev: null,
    opensWithListing: false,
  },
};
