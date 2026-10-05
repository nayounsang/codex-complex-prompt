import type { CriterionContext, EvaluationCriterion } from '../types.js';

export interface GlobalReplacementOptions {
  /** A single ASCII word to remove from the revised document. */
  readonly targetWord: string;
  /** A single ASCII word expected to replace every target occurrence. */
  readonly replacementWord: string;
}

const globalReplacementApplied: EvaluationCriterion<GlobalReplacementOptions> = {
  id: 'global-replacement-applied',
  evaluate({ original, revised }: CriterionContext, { targetWord, replacementWord }) {
    if (!isSingleWord(targetWord) || !isSingleWord(replacementWord)) {
      return {
        passed: false,
        detail:
          'Global replacement criterion requires targetWord and replacementWord to be single ASCII words.',
      };
    }

    const normalizedTarget = targetWord.toLowerCase();
    const normalizedReplacement = replacementWord.toLowerCase();
    const originalWords = wholeWords(original);
    const revisedWords = wholeWords(revised);
    const originalTargetCount = originalWords.filter((word) => word === normalizedTarget).length;
    const remainingTargetCount = revisedWords.filter((word) => word === normalizedTarget).length;
    const expectedReplacementCount =
      originalWords.filter((word) => word === normalizedReplacement).length + originalTargetCount;
    const revisedReplacementCount = revisedWords.filter(
      (word) => word === normalizedReplacement,
    ).length;
    const expectedWords = originalWords.map((word) =>
      word === normalizedTarget ? normalizedReplacement : word,
    );
    const expectedWordsRetainedInOrder = isSubsequence(expectedWords, revisedWords);
    const passed =
      originalTargetCount > 0 &&
      remainingTargetCount === 0 &&
      revisedReplacementCount === expectedReplacementCount &&
      expectedWordsRetainedInOrder;

    return {
      passed,
      detail: passed
        ? `All ${originalTargetCount} ${targetWord} occurrence(s) were replaced with ${replacementWord}.`
        : `${remainingTargetCount} ${targetWord} occurrence(s) remain; expected ${expectedReplacementCount} ${replacementWord} occurrence(s), found ${revisedReplacementCount}; expected words retained in order: ${expectedWordsRetainedInOrder}.`,
    };
  },
};

function wholeWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function isSubsequence(expected: readonly string[], actual: readonly string[]): boolean {
  let expectedIndex = 0;

  for (const word of actual) {
    if (word === expected[expectedIndex]) {
      expectedIndex += 1;
    }

    if (expectedIndex === expected.length) {
      return true;
    }
  }

  return expectedIndex === expected.length;
}

function isSingleWord(value: string): boolean {
  return /^[a-z0-9]+$/i.test(value);
}

export { globalReplacementApplied };
