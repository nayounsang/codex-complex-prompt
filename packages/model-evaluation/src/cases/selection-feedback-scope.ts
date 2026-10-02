import { outsideSelectionUnchanged } from '../criteria/outside-selection-unchanged.js';
import { selectedFeedbackApplied } from '../criteria/selected-feedback-applied.js';
import { similarContentPreserved } from '../criteria/similar-content-preserved.js';
import { configureCriterion, type ModelEvaluationCase } from '../types.js';

const selectionFeedbackScope: ModelEvaluationCase = {
  id: 'selection-feedback-scope',
  title: 'Multiple selected feedback items stay within their selected ranges',
  fixture: new URL('../../fixtures/feedback-scope-design-document.md', import.meta.url),
  annotations: [
    {
      id: 'selection-feedback-scope-tenant-buffer',
      scope: 'selection',
      start: 2045,
      end: 2408,
      quote:
        "When a tenant's pending ingestion buffer reaches 8,000 batches, the gateway rejects that tenant's new batch with HTTP 429 and a `Retry-After: 30` header. The limit is evaluated per tenant, so a full buffer for one tenant does not reduce the quota of another tenant. The gateway does not retain a rejected batch and clients may retry with the same idempotency key.",
      feedback:
        'Remove the Retry-After header requirement from this selected ingestion rule. Keep the HTTP 429 response.',
    },
    {
      id: 'selection-feedback-scope-rollout',
      scope: 'selection',
      start: 9592,
      end: 9675,
      quote: '3. Enable per-tenant limits for 5% of external tenants, then 25%, then all tenants.',
      feedback:
        'Change the initial rollout to 10% of external tenants. Keep the later stages as written.',
    },
  ],
  criteria: [
    configureCriterion(selectedFeedbackApplied, {
      selectionIndex: 0,
      mustNotContain: 'Retry-After: 30',
      mustContain: 'HTTP 429',
    }),
    configureCriterion(selectedFeedbackApplied, {
      selectionIndex: 1,
      mustNotContain: '5% of external tenants',
      mustContain: '10% of external tenants',
    }),
    configureCriterion(outsideSelectionUnchanged, {}),
    configureCriterion(similarContentPreserved, {
      passages: [
        'When that limit is reached, the gateway rejects new batches for all tenants with HTTP 503 and a `Retry-After: 60` header.',
        'The worker honors a valid destination `Retry-After` header up to the 5 minute cap.',
      ],
    }),
  ],
};

export { selectionFeedbackScope };
