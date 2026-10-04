import assert from 'node:assert/strict';
import { test } from 'vitest';

import { outsideSelectionUnchanged } from './criteria/outside-selection-unchanged.js';
import { selectedFeedbackApplied } from './criteria/selected-feedback-applied.js';
import { similarContentPreserved } from './criteria/similar-content-preserved.js';
import { isolateSelections } from './isolate-selections.js';
import type { CriterionContext } from './types.js';

const context = (overrides: Partial<CriterionContext>): CriterionContext => ({
  original: 'beforeTARGETmiddleOTHERafter',
  revised: 'beforeEDITmiddleUPDATEDafter',
  selections: [
    {
      id: 'selection-1',
      scope: 'selection',
      start: 6,
      end: 12,
      quote: 'TARGET',
      feedback: 'Edit the first selection.',
    },
    {
      id: 'selection-2',
      scope: 'selection',
      start: 18,
      end: 23,
      quote: 'OTHER',
      feedback: 'Edit the second selection.',
    },
  ],
  selectedOutputs: ['EDIT', 'UPDATED'],
  selectionIsolationSucceeded: true,
  ...overrides,
});

test('outside-selection criterion rejects changes outside every selected range', async () => {
  assert.equal((await outsideSelectionUnchanged.evaluate(context({}), {})).passed, true);
  assert.equal(
    (await outsideSelectionUnchanged.evaluate(context({ selectionIsolationSucceeded: false }), {}))
      .passed,
    false,
  );
  assert.equal(
    (await outsideSelectionUnchanged.evaluate({ original: '', revised: '' }, {})).passed,
    false,
  );
});

test('selected-feedback criterion checks each selected feedback result', async () => {
  const options = {
    selectionIndex: 0,
    mustNotContain: 'Retry-After: 30',
    mustContain: 'HTTP 429',
  };
  assert.equal(
    (
      await selectedFeedbackApplied.evaluate(
        context({ selectedOutputs: ['HTTP 429 without Retry-After: 30', 'UPDATED'] }),
        options,
      )
    ).passed,
    false,
  );
  assert.equal(
    (
      await selectedFeedbackApplied.evaluate(
        context({ selectedOutputs: ['Return HTTP 429.', 'UPDATED'] }),
        options,
      )
    ).passed,
    true,
  );
  assert.equal(
    (
      await selectedFeedbackApplied.evaluate(
        context({ selectedOutputs: [null, 'UPDATED'] }),
        options,
      )
    ).passed,
    false,
  );
});

test('similar-content criterion checks each configured decoy passage', async () => {
  const options = { passages: ['Retry-After: 60', 'delivery Retry-After header'] };
  assert.equal(
    (
      await similarContentPreserved.evaluate(
        context({ revised: 'Retry-After: 60; delivery Retry-After header' }),
        options,
      )
    ).passed,
    true,
  );
  assert.equal(
    (
      await similarContentPreserved.evaluate(
        context({ revised: 'delivery Retry-After header' }),
        options,
      )
    ).passed,
    false,
  );
});

test('selection isolation extracts every selected range and preserves the gaps', () => {
  const original = 'beforeTARGETmiddleOTHERafter';
  const revised = 'beforeEDITmiddleUPDATEDafter';
  const selections = [
    { start: 6, end: 12, quote: 'TARGET' },
    { start: 18, end: 23, quote: 'OTHER' },
  ];

  assert.deepEqual(isolateSelections(original, revised, selections), {
    selectedOutputs: ['EDIT', 'UPDATED'],
    succeeded: true,
  });
  assert.equal(
    isolateSelections(original, 'changed-beforeEDITmiddleUPDATEDafter', selections).succeeded,
    false,
  );
});

test('selection isolation rejects a response that makes an unchanged gap ambiguous', () => {
  const original = 'beforeTARGETmiddleOTHERafter';
  const revised = 'beforeMIDmiddleEDITmiddleafter';
  const selections = [
    { start: 6, end: 12, quote: 'TARGET' },
    { start: 18, end: 23, quote: 'OTHER' },
  ];

  assert.deepEqual(isolateSelections(original, revised, selections), {
    selectedOutputs: [null, null],
    succeeded: false,
  });
});
