import type { SelectionFeedbackAnnotation } from '@codex-complex-prompt/core/feedback';

import type { ModelEvaluationCase } from './types.js';

export function validateEvaluationCase(
  testCase: ModelEvaluationCase,
  original: string,
  fixturePath: string,
): readonly SelectionFeedbackAnnotation[] {
  if (testCase.criteria.length === 0) {
    throw new Error(`Evaluation case has no criteria: ${testCase.id}.`);
  }

  const selections = testCase.annotations.filter(
    (annotation): annotation is SelectionFeedbackAnnotation => annotation.scope === 'selection',
  );
  for (const { start, end, quote } of selections) {
    if (original.slice(start, end) !== quote) {
      throw new Error(
        `Selection range does not match its quote in ${fixturePath}: [${start}, ${end}).`,
      );
    }
  }
  validateSelectionRanges(selections, original.length, fixturePath);
  return selections;
}

function validateSelectionRanges(
  selections: readonly SelectionFeedbackAnnotation[],
  fixtureLength: number,
  fixturePath: string,
): void {
  let previousEnd = -1;
  for (const selection of [...selections].sort((left, right) => left.start - right.start)) {
    if (
      !Number.isInteger(selection.start) ||
      !Number.isInteger(selection.end) ||
      selection.start <= previousEnd ||
      selection.start < 0 ||
      selection.end <= selection.start ||
      selection.end > fixtureLength
    ) {
      throw new Error(`Selection ranges overlap, touch, or are invalid in ${fixturePath}.`);
    }
    previousEnd = selection.end;
  }
}
