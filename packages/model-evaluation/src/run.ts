import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { FEEDBACK_EDIT_INSTRUCTION, serializeFeedback } from '@codex-complex-prompt/core';

import { runCodex } from './codex-exec.js';
import { evaluationCases } from './cases/index.js';
import { isolateSelections } from './isolate-selections.js';
import { validateEvaluationCase } from './validate-case.js';
import type { CriterionContext, ModelEvaluationCase } from './types.js';

const cases = new Map(evaluationCases.map((evaluationCase) => [evaluationCase.id, evaluationCase]));
const caseId = process.argv[2];

if (caseId === undefined || caseId === '--list') {
  for (const evaluationCase of cases.values())
    console.log(`${evaluationCase.id}: ${evaluationCase.title}`);
  if (caseId === undefined) console.log('\nPass a case id to run its local model evaluation.');
  process.exit(caseId === '--list' ? 0 : 2);
}

const evaluationCase = cases.get(caseId);
if (evaluationCase === undefined) {
  console.error(`Unknown evaluation case: ${caseId}`);
  process.exit(2);
}

await evaluateCase(evaluationCase);

async function evaluateCase(testCase: ModelEvaluationCase): Promise<void> {
  const fixturePath = fileURLToPath(testCase.fixture);
  const original = await readFile(testCase.fixture, 'utf8');
  const selections = validateEvaluationCase(testCase, original, fixturePath);
  const prompt = FEEDBACK_EDIT_INSTRUCTION + serializeFeedback(original, testCase.annotations);
  const modelRun = await runCodex(prompt);
  const isolation = isolateSelections(original, modelRun.output, selections);
  const context: CriterionContext = {
    original,
    revised: modelRun.output,
    selections,
    selectedOutputs: isolation.selectedOutputs,
    selectionIsolationSucceeded: isolation.succeeded,
  };
  const results = await Promise.all(
    testCase.criteria.map(async (criterion) => ({
      ...(await criterion.evaluate(context)),
      id: criterion.id,
    })),
  );

  for (const result of results) {
    console.log(`[${result.passed ? 'PASS' : 'FAIL'}] ${result.id}: ${result.detail}`);
  }

  const passed = results.every((result) => result.passed);
  console.log(`\n${testCase.title}: ${passed ? 'PASS' : 'FAIL'}`);
  console.log(`Original: ${fixturePath}`);
  console.log(`Model output: ${modelRun.outputPath}`);
  console.log(`Codex trace: ${modelRun.tracePath}`);
  console.log(`Compare: diff -u "${fixturePath}" "${modelRun.outputPath}"`);
  if (!passed) process.exitCode = 1;
}
