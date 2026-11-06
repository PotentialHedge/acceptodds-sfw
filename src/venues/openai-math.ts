import type { Venue } from './types';

/**
 * The manuscripts of OpenAI's math release (github.com/openai/math), each a
 * claimed proof written by a model. A market settles Verified as soon as a
 * result is verified; otherwise Not verified when trading closes.
 */
export const OPENAI_MATH: Venue = {
  kind: 'OpenAI Math',

  runningHead: 'Preprint in the OpenAI Math release',
  headlineLabel: 'verified',
  chanceOf: 'this result is independently verified by the end of 2027',
  shareSuffix: ' verified by 2027?',

  market: {
    question: 'Will this result be independently verified by the end of 2027',
    contract: [
      'This market settles **Verified** if, before 1 January 2028 (UTC), the main result of this manuscript is independently verified by any of:',
      '',
      '- publication of the result in a peer-reviewed journal or conference proceedings;',
      '- a Lean formalization of the main theorem whose formal statement someone outside OpenAI has publicly confirmed matches the paper;',
      '- a public written confirmation (a paper, review or post) by a mathematician working in the field who is not at OpenAI.',
      '',
      'It settles **Not verified** otherwise, including when the manuscript is withdrawn, or a gap or error in the proof is publicly identified and not repaired before the close. A corrected revision in the same repository counts as the same manuscript.',
    ].join('\n'),
    outcomes: [
      { label: 'Verified', color: 'green', openingPrice: 0.5 },
      { label: 'Not verified', color: 'red', openingPrice: 0.5 },
    ],
    closesAt: new Date('2028-01-01T00:00:00Z'),
    expectedTraders: 6,
    // Every result opens at even odds, with no model asked, and every listing has its market from the start.
    jev: null,
    opensWithListing: true,
  },
};
