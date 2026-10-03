import assert from 'node:assert/strict';
import { test } from 'vitest';

import type { ModelEvaluationCase } from './types.js';
import { validateEvaluationCase } from './validate-case.js';

const validCriterion = {
  id: 'valid-criterion',
  evaluate: () => ({ passed: true, detail: 'Passed.' }),
};

function createCase(overrides: Partial<ModelEvaluationCase> = {}): ModelEvaluationCase {
  return {
    id: 'example',
    title: 'Example case',
    fixture: new URL('file:///fixture.md'),
    annotations: [],
    criteria: [validCriterion],
    ...overrides,
  };
}

test('rejects a case with no criteria before model execution', () => {
  assert.throws(
    () => validateEvaluationCase(createCase({ criteria: [] }), 'Original', '/fixture.md'),
    /Evaluation case has no criteria: example\./,
  );
});

test('rejects adjacent selection ranges that cannot be isolated independently', () => {
  assert.throws(
    () =>
      validateEvaluationCase(
        createCase({
          annotations: [
            {
              id: 'first',
              scope: 'selection',
              start: 0,
              end: 3,
              quote: 'One',
              feedback: 'Edit one.',
            },
            {
              id: 'second',
              scope: 'selection',
              start: 3,
              end: 6,
              quote: 'Two',
              feedback: 'Edit two.',
            },
          ],
        }),
        'OneTwo',
        '/fixture.md',
      ),
    /Selection ranges overlap, touch, or are invalid/,
  );
});

test('accepts separated selection ranges and returns them in annotation order', () => {
  const selections = [
    {
      id: 'first',
      scope: 'selection',
      start: 0,
      end: 3,
      quote: 'One',
      feedback: 'Edit one.',
    },
    {
      id: 'second',
      scope: 'selection',
      start: 4,
      end: 7,
      quote: 'Two',
      feedback: 'Edit two.',
    },
  ] as const;

  assert.deepEqual(
    validateEvaluationCase(createCase({ annotations: selections }), 'One Two', '/fixture.md'),
    selections,
  );
});

test('rejects a selection quote that differs from its fixture text', () => {
  assert.throws(
    () =>
      validateEvaluationCase(
        createCase({
          annotations: [
            {
              id: 'selection-1',
              scope: 'selection',
              start: 0,
              end: 3,
              quote: 'Wrong',
              feedback: 'Edit this text.',
            },
          ],
        }),
        'One',
        '/fixture.md',
      ),
    /Selection range does not match its quote/,
  );
});

test('rejects a selection range that extends past the fixture', () => {
  assert.throws(
    () =>
      validateEvaluationCase(
        createCase({
          annotations: [
            {
              id: 'selection-1',
              scope: 'selection',
              start: 0,
              end: 4,
              quote: 'One',
              feedback: 'Edit this text.',
            },
          ],
        }),
        'One',
        '/fixture.md',
      ),
    /Selection ranges overlap, touch, or are invalid/,
  );
});
