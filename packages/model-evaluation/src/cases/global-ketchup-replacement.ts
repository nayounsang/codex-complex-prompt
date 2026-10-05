import { globalReplacementApplied } from '../criteria/global-replacement-applied.js';
import { configureCriterion, type ModelEvaluationCase } from '../types.js';

const globalKetchupReplacement: ModelEvaluationCase = {
  id: 'global-ketchup-replacement',
  title: 'Global feedback replaces every ketchup mention with mustard',
  fixture: new URL('../../fixtures/hamburger-recipe.md', import.meta.url),
  annotations: [
    {
      id: 'global-ketchup-replacement-feedback',
      scope: 'global',
      feedback: 'Replace ketchup with mustard.',
    },
  ],
  criteria: [
    configureCriterion(globalReplacementApplied, {
      targetWord: 'ketchup',
      replacementWord: 'mustard',
    }),
  ],
};

export { globalKetchupReplacement };
