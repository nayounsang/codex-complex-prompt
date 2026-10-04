import type { CriterionContext, EvaluationCriterion } from '../types.js';

export interface SelectedFeedbackOptions {
  readonly selectionIndex: number;
  readonly mustNotContain: string;
  readonly mustContain: string;
  readonly expectedSelectedOutput?: string;
}

const selectedFeedbackApplied: EvaluationCriterion<SelectedFeedbackOptions> = {
  id: 'selected-feedback-applied',
  evaluate(
    { selectedOutputs }: CriterionContext,
    { selectionIndex, mustNotContain, mustContain, expectedSelectedOutput },
  ) {
    const selectedOutput = selectedOutputs?.[selectionIndex] ?? null;
    if (selectedOutput === null) {
      return { passed: false, detail: 'The selected output could not be isolated.' };
    }

    const removedRequestedText = !selectedOutput.includes(mustNotContain);
    const retainedRequiredText = selectedOutput.includes(mustContain);
    const matchesExpectedOutput =
      expectedSelectedOutput === undefined || selectedOutput === expectedSelectedOutput;
    const expectedOutputDetail =
      expectedSelectedOutput === undefined
        ? ''
        : `; expected selected output matched: ${matchesExpectedOutput}`;

    return {
      passed: removedRequestedText && retainedRequiredText && matchesExpectedOutput,
      detail: `Requested text removed: ${removedRequestedText}; required text retained: ${retainedRequiredText}${expectedOutputDetail}.`,
    };
  },
};

export { selectedFeedbackApplied };
