import assert from 'node:assert/strict';
import { test } from 'vitest';

import { globalReplacementApplied } from './global-replacement-applied.js';
import type { CriterionContext } from '../types.js';

const context = (original: string, revised: string): CriterionContext => ({
  original,
  revised,
  selections: [],
  selectedOutputs: [],
  selectionIsolationSucceeded: true,
});

test('global replacement criterion requires every target to become a replacement', async () => {
  const options = { targetWord: 'ketchup', replacementWord: 'mustard' };
  const result = await globalReplacementApplied.evaluate(
    context('Ketchup on top, ketchup on the side.', 'Mustard on top, mustard on the side.'),
    options,
  );

  assert.deepEqual(result, {
    passed: true,
    detail: 'All 2 ketchup occurrence(s) were replaced with mustard.',
  });
});

test('global replacement criterion rejects leftover targets', async () => {
  const result = await globalReplacementApplied.evaluate(
    context('ketchup and ketchup', 'mustard and ketchup'),
    { targetWord: 'ketchup', replacementWord: 'mustard' },
  );

  assert.equal(result.passed, false);
});

test('global replacement criterion rejects an incomplete or extra replacement count', async () => {
  const options = { targetWord: 'ketchup', replacementWord: 'mustard' };

  assert.equal(
    (await globalReplacementApplied.evaluate(context('ketchup, ketchup', 'mustard'), options))
      .passed,
    false,
  );
  assert.equal(
    (
      await globalReplacementApplied.evaluate(
        context('ketchup, ketchup', 'mustard, mustard, mustard'),
        options,
      )
    ).passed,
    false,
  );
});

test('global replacement criterion rejects a replacement at an unrelated occurrence when counts match', async () => {
  const result = await globalReplacementApplied.evaluate(
    context('ketchup on bun. tomato on plate.', 'tomato on bun. mustard on plate.'),
    { targetWord: 'ketchup', replacementWord: 'mustard' },
  );

  assert.equal(result.passed, false);
});

test('global replacement criterion accepts an added prefix before the replaced text', async () => {
  const result = await globalReplacementApplied.evaluate(
    context(
      'ketchup on bun. tomato on plate.',
      'Here is the revision: mustard on bun. tomato on plate.',
    ),
    { targetWord: 'ketchup', replacementWord: 'mustard' },
  );

  assert.equal(result.passed, true);
});

test('global replacement criterion rejects values that are not single words', async () => {
  const result = await globalReplacementApplied.evaluate(
    context('ketchup on the side', 'mustard on the side'),
    { targetWord: 'ketchup sauce', replacementWord: 'mustard' },
  );

  assert.deepEqual(result, {
    passed: false,
    detail:
      'Global replacement criterion requires targetWord and replacementWord to be single ASCII words.',
  });
});
