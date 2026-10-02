import type { CriterionContext, EvaluationCriterion } from '../types.js';

export interface SelectedFeedbackOptions {
  readonly selectionIndex: number;
  readonly mustNotContain: string;
  readonly mustContain: string;
}

const selectedFeedbackApplied: EvaluationCriterion<SelectedFeedbackOptions> = {
  id: 'selected-feedback-applied',
  evaluate({ selectedOutputs }: CriterionContext, { selectionIndex, mustNotContain, mustContain }) {
    const selectedOutput = selectedOutputs[selectionIndex] ?? null;
    if (selectedOutput === null) {
      return { passed: false, detail: 'The selected output could not be isolated.' };
    }

    const removedRequestedText = !selectedOutput.includes(mustNotContain);
    const retainedRequiredText = selectedOutput.includes(mustContain);

    return {
      passed: removedRequestedText && retainedRequiredText,
      detail: `Requested text removed: ${removedRequestedText}; required text retained: ${retainedRequiredText}.`,
    };
  },
};

export { selectedFeedbackApplied };
