import reference from './iclr-2027.jev-reference.json';
import type { Venue } from './types';

/** Submissions under review at ICLR 2027. Decisions are released on 2026-12-15; the markets close the day before. */
export const ICLR_2027: Venue = {
  kind: 'ICLR 2027',

  runningHead: 'Under review as a conference paper at ICLR 2027',
  headlineLabel: 'accept',
  chanceOf: 'this paper gets accepted at ICLR 2027',
  shareSuffix: ' @ ICLR 2027?',

  market: {
    question: 'Will this paper get accepted to ICLR 2027',
    // Reject is every way a paper can fail to appear (#19): the client that
    // settles the market settles a withdrawal as Reject.
    contract: [
      "This market settles on the venue's final decision for the paper.",
      '',
      '- **Accept**: the paper is accepted to ICLR 2027 in any form (oral, spotlight or poster).',
      '- **Reject**: the paper is rejected. This also covers a paper that is withdrawn or desk-rejected before the decision.',
    ].join('\n'),
    outcomes: [
      // ICLR's oral, spotlight and poster rates combined: about 32% of submissions are accepted.
      { label: 'Accept', color: 'green', openingPrice: 0.32 },
      { label: 'Reject', color: 'red', openingPrice: 0.68 },
    ],
    closesAt: new Date('2026-12-14T00:00:00Z'),
    expectedTraders: 6,
    opensWithListing: false,
    // The prior and the reviewing guidelines, so the answer starts from the base rate and moves only on the
    // paper's merits as reviewers judge them, not on whether it reads like a paper.
    jev: {
      instructions: [
        'This paper is under review at ICLR 2027. Predict its final decision.',
        '',
        'Start from the base rate: about 32% of ICLR submissions are accepted (oral, spotlight and poster ' +
          'combined), so most papers are rejected, and a competent, well-written paper is not by itself ' +
          'above the base rate. Move away from it only as far as the paper gives you reason to.',
        '',
        'Judge it as ICLR reviewers and area chairs do, by its guidelines for a good paper:',
        '- Significance and interest: does it address a problem the ICLR community cares about, and would ' +
          'people build on it?',
        '- Novelty: is the idea, method or finding new, or an incremental variation on prior work?',
        '- Soundness: do the claims follow from the theory and experiments, with appropriate baselines, ' +
          'ablations and evaluation?',
        '- Clarity: is it clearly written, with its contributions stated and supported?',
        '- Reproducibility: are the methods, data and settings described well enough to reproduce?',
        '',
        'Weigh the paper as a whole, as a meta-review would: a clear, significant contribution outweighs ' +
          'minor flaws, while a serious flaw in soundness or a lack of novelty usually means rejection.',
      ].join('\n'),
      criteria: ['accepted in any form (oral, spotlight or poster)', 'rejected, withdrawn or desk-rejected'],
      // JEV's answers to 800 random ICLR 2027 listings (255 read in full, 545 by abstract), measured 2026-10-09
      // by `npm run jev:reference`. It ignores the base rate it is told (its median answer is about 80% Accept),
      // so only a paper's rank among these is used (`jev.ranked`). Re-measure when the question changes.
      reference: { fullText: reference.fullText, abstract: reference.abstract },
      // Narrow on purpose: JEV's rank is weak evidence, and the price is the traders' to find. Ten to ninety
      // per cent of papers open between about 16% and 41% at the default JEV_TARGET_MEAN of 28%.
      spread: 0.5,
    },
  },
};
