import assert from 'node:assert/strict';
import { test } from 'vitest';

import { headingSectionDecisionsApplied } from './heading-section-decisions-applied.js';
import type { CriterionContext } from '../types.js';

const options = {
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
  mustNotContain: ['Should HTTP 429 be retried?', 'How long should replay last?'],
  preservedText: ['## Rollout checklist'],
};

const context = (revised: string): CriterionContext => ({
  original: '',
  revised,
  selections: [],
  selectedOutputs: [],
  selectionIsolationSucceeded: true,
});

test('heading-section criterion accepts decisions stated with their outcomes', async () => {
  const result = await headingSectionDecisionsApplied.evaluate(
    context(
      [
        '## Delivery guarantees',
        '- HTTP 429 responses are transient failures and should be retried with exponential backoff.',
        '- Failed deliveries remain available for operator replay for seven days.',
        '## Rollout checklist',
      ].join('\n'),
    ),
    options,
  );

  assert.equal(result.passed, true, result.detail);
});

test('heading-section criterion accepts a direct statement that deliveries are retained for replay', async () => {
  const result = await headingSectionDecisionsApplied.evaluate(
    context(
      [
        '## Delivery guarantees',
        '- Retry HTTP 429 responses using the same policy as timeouts.',
        '- Failed deliveries are retained for replay for seven days.',
        '## Rollout checklist',
      ].join('\n'),
    ),
    options,
  );

  assert.equal(result.passed, true, result.detail);
});

test('heading-section criterion rejects decision terms that are not connected to their outcomes', async () => {
  const result = await headingSectionDecisionsApplied.evaluate(
    context(
      [
        '## Delivery guarantees',
        '- HTTP 429 responses are documented.',
        '- Retry uses exponential backoff for timeouts.',
        '- Failed deliveries are available for operator replay.',
        '- Seven days is the monitoring window.',
        '## Rollout checklist',
      ].join('\n'),
    ),
    options,
  );

  assert.equal(result.passed, false);
  assert.match(result.detail, /HTTP 429 retry behavior is stated together/);
  assert.match(result.detail, /seven-day replay period is tied to failed deliveries/);
});

test('heading-section criterion rejects negated decisions even when all decision terms appear', async () => {
  const result = await headingSectionDecisionsApplied.evaluate(
    context(
      [
        '## Delivery guarantees',
        '- HTTP 429 responses are not transient failures and should not be retried.',
        '- Failed deliveries are not available for operator replay for seven days.',
        '- Timeouts are transient failures and use exponential backoff.',
        '- HTTP 429 responses are permanent failures; retry is unsupported.',
        '## Rollout checklist',
      ].join('\n'),
    ),
    options,
  );

  assert.equal(result.passed, false);
  assert.match(result.detail, /HTTP 429 retry behavior is stated together/);
  assert.match(result.detail, /seven-day replay period is tied to failed deliveries/);
});
