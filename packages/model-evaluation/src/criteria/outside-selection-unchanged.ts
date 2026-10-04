import type { CriterionContext, EvaluationCriterion } from '../types.js';

const outsideSelectionUnchanged: EvaluationCriterion<Record<never, never>> = {
  id: 'outside-selection-unchanged',
  evaluate({ selectionIsolationSucceeded }: CriterionContext) {
    if (selectionIsolationSucceeded === undefined) {
      return {
        passed: false,
        detail: 'This criterion requires at least one selected-feedback range.',
      };
    }

    return {
      passed: selectionIsolationSucceeded,
      detail: selectionIsolationSucceeded
        ? 'Content outside every selected range is unchanged.'
        : 'Content outside one or more selected ranges changed.',
    };
  },
};

export { outsideSelectionUnchanged };
