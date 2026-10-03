import { evaluateCase } from './run.js';
import type { ModelEvaluationCase, ModelRunResult } from './types.js';

export interface EvaluationCliOptions {
  readonly cases: readonly ModelEvaluationCase[];
  readonly executeCodex: (prompt: string) => Promise<ModelRunResult>;
  readonly writeOutput: (line: string) => void;
  readonly writeError: (line: string) => void;
}

export async function runEvaluationCli(
  args: readonly string[],
  options: EvaluationCliOptions,
): Promise<number> {
  const cases = new Map(options.cases.map((item) => [item.id, item]));
  const caseId = args[0];

  if (caseId === undefined || caseId === '--list') {
    for (const evaluationCase of cases.values())
      options.writeOutput(`${evaluationCase.id}: ${evaluationCase.title}`);
    if (caseId === undefined)
      options.writeOutput('\nPass a case id to run its local model evaluation.');
    return caseId === '--list' ? 0 : 2;
  }

  const evaluationCase = cases.get(caseId);
  if (evaluationCase === undefined) {
    options.writeError(`Unknown evaluation case: ${caseId}`);
    return 2;
  }

  const result = await evaluateCase(evaluationCase, options.executeCodex);
  for (const criterion of result.criteria) {
    options.writeOutput(
      `[${criterion.passed ? 'PASS' : 'FAIL'}] ${criterion.id}: ${criterion.detail}`,
    );
  }

  options.writeOutput(`\n${result.title}: ${result.passed ? 'PASS' : 'FAIL'}`);
  options.writeOutput(`Original: ${result.fixturePath}`);
  options.writeOutput(`Output directory: ${result.modelRun.outputDirectory}`);
  options.writeOutput(`Model output: ${result.modelRun.outputPath}`);
  options.writeOutput(`Codex trace: ${result.modelRun.tracePath}`);
  options.writeOutput(`Compare: diff -u "${result.fixturePath}" "${result.modelRun.outputPath}"`);
  return result.passed ? 0 : 1;
}
