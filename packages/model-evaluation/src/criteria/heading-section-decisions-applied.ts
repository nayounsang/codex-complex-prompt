import type { CriterionContext, EvaluationCriterion } from '../types.js';

export interface HeadingSectionDecisionsOptions {
  readonly startAfterHeading: string;
  readonly endBeforeHeading: string;
  readonly requiredTerms: readonly string[];
  readonly requiredAlternatives: readonly (readonly string[])[];
  readonly mustNotContain: readonly string[];
  readonly preservedText: readonly string[];
}

const headingSectionDecisionsApplied: EvaluationCriterion<HeadingSectionDecisionsOptions> = {
  id: 'heading-section-decisions-applied',
  evaluate(
    { revised }: CriterionContext,
    {
      startAfterHeading,
      endBeforeHeading,
      requiredTerms,
      requiredAlternatives,
      mustNotContain,
      preservedText,
    },
  ) {
    const section = getTextBetweenLevelTwoHeadings(revised, startAfterHeading, endBeforeHeading);
    const normalizedSection = section.toLocaleLowerCase();
    const missingTerms = requiredTerms.filter(
      (term) => !normalizedSection.includes(term.toLocaleLowerCase()),
    );
    const missingAlternativeGroups = requiredAlternatives.filter(
      (alternatives) =>
        !alternatives.some((term) => normalizedSection.includes(term.toLocaleLowerCase())),
    );
    const unresolvedQuestions = mustNotContain.filter((phrase) => revised.includes(phrase));
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

function getTextBetweenLevelTwoHeadings(
  markdown: string,
  startAfterHeading: string,
  endBeforeHeading: string,
): string {
  const startHeadingEnd = findLevelTwoHeadingEnd(markdown, startAfterHeading);
  const endHeadingStart = findLevelTwoHeadingStart(markdown, endBeforeHeading);
  if (
    startHeadingEnd === undefined ||
    endHeadingStart === undefined ||
    startHeadingEnd > endHeadingStart
  )
    return '';

  return markdown.slice(startHeadingEnd, endHeadingStart);
}

function findLevelTwoHeadingStart(markdown: string, title: string): number | undefined {
  let offset = 0;
  for (const line of markdown.split('\n')) {
    if (line.trim() === `## ${title}`) return offset;
    offset += line.length + 1;
  }

  return undefined;
}

function findLevelTwoHeadingEnd(markdown: string, title: string): number | undefined {
  const start = findLevelTwoHeadingStart(markdown, title);
  if (start === undefined) return undefined;

  const lineEnd = markdown.indexOf('\n', start);
  return lineEnd === -1 ? markdown.length : lineEnd + 1;
}
