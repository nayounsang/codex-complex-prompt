import type { CriterionContext, EvaluationCriterion } from '../types.js';

export interface HeadingSectionDecisionsOptions {
  readonly sectionIndex: number;
  readonly requiredTerms: readonly string[];
  readonly requiredAlternatives: readonly (readonly string[])[];
  readonly mustNotContain: readonly string[];
  readonly preservedText: readonly string[];
}

const headingSectionDecisionsApplied: EvaluationCriterion<HeadingSectionDecisionsOptions> = {
  id: 'heading-section-decisions-applied',
  evaluate(
    { revised }: CriterionContext,
    { sectionIndex, requiredTerms, requiredAlternatives, mustNotContain, preservedText },
  ) {
    const section = getLevelTwoSection(revised, sectionIndex);
    const normalizedSection = section.toLocaleLowerCase();
    const missingTerms = requiredTerms.filter(
      (term) => !normalizedSection.includes(term.toLocaleLowerCase()),
    );
    const missingAlternativeGroups = requiredAlternatives.filter(
      (alternatives) =>
        !alternatives.some((term) => normalizedSection.includes(term.toLocaleLowerCase())),
    );
    const unresolvedQuestions = mustNotContain.filter((phrase) => section.includes(phrase));
    const missingPreservedText = preservedText.filter((text) => !revised.includes(text));
    const passed =
      missingTerms.length === 0 &&
      missingAlternativeGroups.length === 0 &&
      unresolvedQuestions.length === 0 &&
      missingPreservedText.length === 0;

    return {
      passed,
      detail: passed
        ? 'The decisions in the selected section were resolved and the requested surrounding text was preserved.'
        : [
            ...(missingTerms.length === 0
              ? []
              : [`Missing decision terms: ${missingTerms.join(', ')}.`]),
            ...(missingAlternativeGroups.length === 0
              ? []
              : [
                  `Missing one of the expected policy terms: ${missingAlternativeGroups.map((group) => group.join(' or ')).join('; ')}.`,
                ]),
            ...(unresolvedQuestions.length === 0
              ? []
              : [`Unresolved questions remain: ${unresolvedQuestions.length}.`]),
            ...(missingPreservedText.length === 0
              ? []
              : [`Missing unchanged text: ${missingPreservedText.length} passage(s).`]),
          ].join(' '),
    };
  },
};

export { headingSectionDecisionsApplied };

function getLevelTwoSection(markdown: string, sectionIndex: number): string {
  const headings = [...markdown.matchAll(/^##[ \t]+.+$/gm)];
  const sectionStart = headings[sectionIndex]?.index;
  if (sectionStart === undefined) return '';

  const sectionEnd = headings[sectionIndex + 1]?.index ?? markdown.length;
  return markdown.slice(sectionStart, sectionEnd);
}
