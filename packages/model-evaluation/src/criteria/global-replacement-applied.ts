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

    const originalTargetCount = countWholeWord(original, targetWord);
    const remainingTargetCount = countWholeWord(revised, targetWord);
    const expectedReplacementCount =
      countWholeWord(original, replacementWord) + originalTargetCount;
    const revisedReplacementCount = countWholeWord(revised, replacementWord);
    const passed =
      originalTargetCount > 0 &&
      remainingTargetCount === 0 &&
      revisedReplacementCount === expectedReplacementCount;

    return {
      passed,
      detail: passed
        ? `All ${originalTargetCount} ${targetWord} occurrence(s) were replaced with ${replacementWord}.`
        : `${remainingTargetCount} ${targetWord} occurrence(s) remain; expected ${expectedReplacementCount} ${replacementWord} occurrence(s), found ${revisedReplacementCount}.`,
    };
  },
};

function countWholeWord(text: string, word: string): number {
  const normalizedWord = word.toLowerCase();
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token === normalizedWord).length;
}

function isSingleWord(value: string): boolean {
  return /^[a-z0-9]+$/i.test(value);
}

export { globalReplacementApplied };
