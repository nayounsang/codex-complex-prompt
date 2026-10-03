import type { CriterionContext, EvaluationCriterion } from '../types.js';

export interface SimilarContentOptions {
  readonly passages: readonly string[];
}

const similarContentPreserved: EvaluationCriterion<SimilarContentOptions> = {
  id: 'similar-content-preserved',
  evaluate({ revised }: CriterionContext, { passages }) {
    const missing = passages.filter((passage) => !revised.includes(passage));

    return {
      passed: missing.length === 0,
      detail:
        missing.length === 0
          ? `${passages.length} similar passage(s) remain unchanged.`
          : `${missing.length} expected similar passage(s) changed or disappeared.`,
    };
  },
};

export { similarContentPreserved };
