import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { headingSectionDecisionsApplied } from '../criteria/heading-section-decisions-applied.js';
import { similarContentPreserved } from '../criteria/similar-content-preserved.js';
import { configureCriterion, type ModelEvaluationCase } from '../types.js';

const fixture = new URL('../../fixtures/webhook-delivery-decisions.md', import.meta.url);
const source = readFileSync(fileURLToPath(fixture), 'utf8');
const heading = 'Open decisions';
const start = source.indexOf(heading);

const headingSectionDecisions: ModelEvaluationCase = {
  id: 'heading-section-decisions',
  title: 'Feedback on a section heading resolves the decisions in that section',
  fixture,
  annotations: [
    {
      id: 'heading-section-decisions-feedback',
      scope: 'selection',
      quote: heading,
      start,
      end: start + heading.length,
      feedback:
        'Resolve each decision in this section using the delivery guarantees above. State the retry behavior for HTTP 429 and the replay retention period directly.',
    },
  ],
  criteria: [
    configureCriterion(headingSectionDecisionsApplied, {
      startAfterHeading: 'Delivery guarantees',
      endBeforeHeading: 'Rollout checklist',
      requiredTerms: ['429', 'seven days'],
      requiredStatements: [
        {
          description: 'HTTP 429 retry behavior is stated together',
          pattern:
            /^(?![^\n]*\b(?:not|never|permanent|unsupported|disabled|non-retryable)\b)(?=[^\n]*HTTP 429)(?=[^\n]*\b(?:retry|retries|retried)\b)(?=[^\n]*\b(?:same policy|transient|exponential backoff)\b)[^\n]*$/im,
        },
        {
          description: 'the seven-day replay period is tied to failed deliveries',
          pattern:
            /^(?![^\n]*\bnot\b[^\n]*\bavailable\b)(?=[^\n]*\b(?:failed deliveries|deliveries)\b)(?=[^\n]*(?:\b(?:keep|keeps|kept|remain|remains)\b[^\n]*\bavailable\b|\bretained\b[^\n]*\bfor (?:operator )?replay\b))(?=[^\n]*\breplay\b)(?=[^\n]*\bseven days\b)[^\n]*$/im,
        },
      ],
      mustNotContain: [
        'Should destination HTTP 429 responses be retried or treated as permanent failures?',
        'How long should failed deliveries remain available for replay?',
      ],
      preservedText: [
        '## Delivery guarantees',
        '## Rollout checklist\n\n- Enable the new delivery worker for five percent of tenants, then expand after one week of stable metrics.\n- Keep the current worker available for rollback during the pilot.',
      ],
    }),
    configureCriterion(similarContentPreserved, {
      passages: [
        'A slow destination must not block delivery to unrelated tenants.',
        'The delivery worker already records each attempt and its next scheduled retry time.',
      ],
    }),
  ],
};

export { headingSectionDecisions };
