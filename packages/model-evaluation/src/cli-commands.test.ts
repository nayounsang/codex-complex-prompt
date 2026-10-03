import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { runEvaluationCli } from './cli-commands.js';
import { configureCriterion } from './types.js';
import type { EvaluationCliOptions } from './cli-commands.js';
import type { CriterionContext, EvaluationCriterion, ModelEvaluationCase } from './types.js';

const fixture = new URL('../fixtures/feedback-scope-design-document.md', import.meta.url);
const resultCriterion: EvaluationCriterion<{ passed: boolean }> = {
  id: 'configured-result',
  evaluate: (_context: CriterionContext, { passed }) => ({
    passed,
    detail: `Configured result is ${String(passed)}.`,
  }),
};
const evaluationCase: ModelEvaluationCase = {
  id: 'cli-test-case',
  title: 'CLI test case',
  fixture,
  annotations: [],
  criteria: [configureCriterion(resultCriterion, { passed: true })],
};

describe('runEvaluationCli', () => {
  it('prints usage and returns an error code when no case is selected', async () => {
    const output: string[] = [];

    const exitCode = await runEvaluationCli(
      [],
      cliOptions({
        writeOutput: (line) => output.push(line),
      }),
    );

    expect(exitCode).toBe(2);
    expect(output).toEqual([
      'cli-test-case: CLI test case',
      '\nPass a case id to run its local model evaluation.',
    ]);
  });

  it('lists registered cases and returns success for the list option', async () => {
    const output: string[] = [];

    const exitCode = await runEvaluationCli(
      ['--list'],
      cliOptions({
        writeOutput: (line) => output.push(line),
      }),
    );

    expect(exitCode).toBe(0);
    expect(output).toEqual(['cli-test-case: CLI test case']);
  });

  it('reports an unknown case and returns an error code', async () => {
    const errors: string[] = [];

    const exitCode = await runEvaluationCli(
      ['missing-case'],
      cliOptions({
        cases: [],
        writeError: (line) => errors.push(line),
      }),
    );

    expect(exitCode).toBe(2);
    expect(errors).toEqual(['Unknown evaluation case: missing-case']);
  });

  it('prints criteria and output paths when the selected case passes', async () => {
    const output: string[] = [];

    const exitCode = await runEvaluationCli(
      ['cli-test-case'],
      cliOptions({
        writeOutput: (line) => output.push(line),
      }),
    );

    expect(exitCode).toBe(0);
    expect(output).toEqual([
      '[PASS] configured-result: Configured result is true.',
      '\nCLI test case: PASS',
      `Original: ${fileURLToPath(fixture)}`,
      'Output directory: /tmp/model-evaluation-output',
      'Model output: /tmp/model-evaluation-output/revised-document.md',
      'Codex trace: /tmp/model-evaluation-output/codex-trace.jsonl',
      `Compare: diff -u "${fileURLToPath(fixture)}" "/tmp/model-evaluation-output/revised-document.md"`,
    ]);
  });

  it('returns a failure code when the selected case criteria fail', async () => {
    const output: string[] = [];
    const failingCase: ModelEvaluationCase = {
      ...evaluationCase,
      criteria: [configureCriterion(resultCriterion, { passed: false })],
    };

    const exitCode = await runEvaluationCli(
      ['cli-test-case'],
      cliOptions({
        cases: [failingCase],
        writeOutput: (line) => output.push(line),
      }),
    );

    expect(exitCode).toBe(1);
    expect(output).toContain('[FAIL] configured-result: Configured result is false.');
    expect(output).toContain('\nCLI test case: FAIL');
  });
});

function modelResult(output: string) {
  return {
    output,
    outputDirectory: '/tmp/model-evaluation-output',
    outputPath: '/tmp/model-evaluation-output/revised-document.md',
    tracePath: '/tmp/model-evaluation-output/codex-trace.jsonl',
  };
}

function cliOptions(overrides: Partial<EvaluationCliOptions> = {}): EvaluationCliOptions {
  return {
    cases: [evaluationCase],
    executeCodex: async () => modelResult('Revised document'),
    writeOutput: () => undefined,
    writeError: () => undefined,
    ...overrides,
  };
}
