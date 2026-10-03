import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { FEEDBACK_EDIT_INSTRUCTION, serializeFeedback } from '@codex-complex-prompt/core/feedback';

import { isolateSelections } from './isolate-selections.js';
import { validateEvaluationCase } from './validate-case.js';
import type { CriterionContext, ModelEvaluationCase, ModelRunResult } from './types.js';

export interface CriterionEvaluationResult {
  readonly id: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface ModelEvaluationResult {
  readonly title: string;
  readonly fixturePath: string;
  readonly modelRun: ModelRunResult;
  readonly criteria: readonly CriterionEvaluationResult[];
  readonly passed: boolean;
}

export async function evaluateCase(
  testCase: ModelEvaluationCase,
  executeCodex: (prompt: string) => Promise<ModelRunResult>,
): Promise<ModelEvaluationResult> {
  const fixturePath = fileURLToPath(testCase.fixture);
  const original = await readFile(testCase.fixture, 'utf8');
  const selections = validateEvaluationCase(testCase, original, fixturePath);
  const prompt = FEEDBACK_EDIT_INSTRUCTION + serializeFeedback(original, testCase.annotations);
  const modelRun = await executeCodex(prompt);
  const isolation = isolateSelections(original, modelRun.output, selections);
  const context: CriterionContext = {
    original,
    revised: modelRun.output,
    selections,
    selectedOutputs: isolation.selectedOutputs,
    selectionIsolationSucceeded: isolation.succeeded,
  };
  const criteria = await Promise.all(
    testCase.criteria.map(async (criterion) => ({
      ...(await criterion.evaluate(context)),
      id: criterion.id,
    })),
  );

  return {
    title: testCase.title,
    fixturePath,
    modelRun,
    criteria,
    passed: criteria.every((criterion) => criterion.passed),
  };
}
