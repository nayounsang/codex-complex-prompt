import assert from 'node:assert/strict';
import { test } from 'vitest';

import { headingSectionDecisionsApplied } from './heading-section-decisions-applied.js';
import type { CriterionContext } from '../types.js';

const options = {
  startAfterHeading: 'Open decisions',
  endBeforeHeading: 'Rollout checklist',
  requiredTerms: ['429', 'seven days'],
  requiredStatements: [
    {
      description: 'HTTP 429 handling is stated directly',
      pattern:
        /^(?=[^\n]*HTTP 429)(?=[^\n]*\b(?:retry|retries|retried|permanent|transient)\b)(?![^\n]*\?\s*$)[^\n]*$/im,
    },
    {
      description: 'the replay period is stated directly for failed deliveries',
      pattern:
        /^(?=[^\n]*\b(?:failed deliveries|deliveries)\b)(?=[^\n]*\breplay\b)(?=[^\n]*\bseven days\b)(?![^\n]*\?\s*$)[^\n]*$/im,
    },
  ],
  mustNotContain: [
    'Should destination HTTP 429 responses be retried or treated as permanent failures?',
    'How long should failed deliveries remain available for replay?',
  ],
  preservedText: [
    '## Delivery guarantees',
    '## Rollout checklist\n\n- Keep the current worker available for rollback during the pilot.',
  ],
};

const context = (revised: string): CriterionContext => ({
  original: '',
  revised,
  selections: [],
  selectedOutputs: [],
  selectionIsolationSucceeded: true,
});

function revisedDocument(decisions: readonly string[]): string {
  return [
    '# Webhook Delivery Proposal',
    '',
    '## Delivery guarantees',
    '- HTTP 429 responses are transient failures and follow the same retry policy as timeouts.',
    '- Failed deliveries remain available for operator replay for seven days.',
    '',
    '## Open decisions',
    ...decisions,
    '',
    '## Rollout checklist',
    '',
    '- Keep the current worker available for rollback during the pilot.',
  ].join('\n');
}

test('heading-section criterion accepts direct decisions in the open decisions section', async () => {
  const result = await headingSectionDecisionsApplied.evaluate(
    context(
      revisedDocument([
        '- HTTP 429 responses are transient failures and should be retried with exponential backoff.',
        '- Failed deliveries remain available for operator replay for seven days.',
      ]),
    ),
    options,
  );

  assert.equal(result.passed, true, result.detail);
});

test('heading-section criterion accepts explicit decisions without enforcing their polarity', async () => {
  const result = await headingSectionDecisionsApplied.evaluate(
    context(
      revisedDocument([
        '- HTTP 429 responses are permanent failures and should not be retried.',
        '- Failed deliveries are not retained for replay for seven days.',
      ]),
    ),
    options,
  );

  assert.equal(result.passed, true, result.detail);
});

test('heading-section criterion rejects terms that do not state either decision directly', async () => {
  const result = await headingSectionDecisionsApplied.evaluate(
    context(
      revisedDocument([
        '- HTTP 429 is a documented status.',
        '- Retry uses exponential backoff for timeouts.',
        '- Failed deliveries matter.',
        '- Seven days is the monitoring window.',
      ]),
    ),
    options,
  );

  assert.equal(result.passed, false);
  assert.match(result.detail, /HTTP 429 handling is stated directly/);
  assert.match(result.detail, /the replay period is stated directly for failed deliveries/);
});

test('heading-section criterion rejects deleting the questions without adding decisions', async () => {
  const result = await headingSectionDecisionsApplied.evaluate(
    context(revisedDocument([])),
    options,
  );

  assert.equal(result.passed, false);
  assert.match(result.detail, /Missing decision terms: 429, seven days/);
  assert.match(result.detail, /Missing expected decision statements/);
});

test('heading-section criterion rejects unresolved questions in the open decisions section', async () => {
  const result = await headingSectionDecisionsApplied.evaluate(
    context(
      revisedDocument([
        '- Should destination HTTP 429 responses be retried or treated as permanent failures?',
        '- How long should failed deliveries remain available for replay?',
        '- HTTP 429 responses are transient failures and should be retried with exponential backoff.',
        '- Failed deliveries remain available for operator replay for seven days.',
      ]),
    ),
    options,
  );

  assert.equal(result.passed, false);
  assert.match(result.detail, /Unresolved questions remain: 2/);
});
