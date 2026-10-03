import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { evaluationCases } from './cases/index.js';
import { outsideSelectionUnchanged } from './criteria/outside-selection-unchanged.js';
import { evaluateCase } from './run.js';
import { configureCriterion } from './types.js';
import type { EvaluationCriterion, ModelEvaluationCase } from './types.js';

const fixtureDirectories: string[] = [];

describe('evaluateCase', () => {
  afterEach(async () => {
    await Promise.all(
      fixtureDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('sends the serialized product feedback to the model and evaluates its response', async () => {
    const original = 'Before Original after\n';
    const selection = {
      id: 'selection-1',
      scope: 'selection' as const,
      start: 7,
      end: 15,
      quote: 'Original',
      feedback: 'Replace this word.',
    };
    const testCase = await createCase(original, {
      annotations: [selection],
      criteria: [
        configureCriterion(
          {
            id: 'selected-output',
            evaluate: ({ selectedOutputs }) => ({
              passed: selectedOutputs[0] === 'Rewritten',
              detail: 'Checks the rewritten selected text.',
            }),
          } as EvaluationCriterion<Record<never, never>>,
          {},
        ),
      ],
    });
    let prompt = '';

    const result = await evaluateCase(testCase, async (modelPrompt) => {
      prompt = modelPrompt;
      return modelResult('Before Rewritten after\n');
    });

    expect(prompt).toContain('### Selected feedback');
    expect(prompt).toContain('Replace this word.');
    expect(prompt).toContain(`### Current Markdown\n\n${original}`);
    expect(result.criteria[0]?.passed).toBe(true);
    expect(result.passed).toBe(true);
  });

  it('reports a failed criterion when content outside the selection changes', async () => {
    const original = 'Before Original after\n';
    const testCase = await createCase(original, {
      annotations: [
        {
          id: 'selection-1',
          scope: 'selection',
          start: 7,
          end: 15,
          quote: 'Original',
          feedback: 'Replace this word.',
        },
      ],
      criteria: [configureCriterion(outsideSelectionUnchanged, {})],
    });

    const result = await evaluateCase(testCase, async () =>
      modelResult('Changed Before Rewritten after\n'),
    );

    expect(result.criteria[0]?.passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('evaluates a document with global feedback and no selected ranges', async () => {
    const original = 'Original document.\n';
    const testCase = await createCase(original, {
      annotations: [{ id: 'global-1', scope: 'global', feedback: 'Make it concise.' }],
      criteria: [configureCriterion(outsideSelectionUnchanged, {})],
    });

    const result = await evaluateCase(testCase, async () => modelResult(original));

    expect(result.passed).toBe(true);
    expect(result.criteria[0]?.passed).toBe(true);
  });

  it('registers the scoped feedback evaluation case', () => {
    expect(evaluationCases.map(({ id }) => id)).toContain('selection-feedback-scope');
  });
});

async function createCase(
  original: string,
  overrides: Pick<ModelEvaluationCase, 'annotations' | 'criteria'>,
): Promise<ModelEvaluationCase> {
  const directory = await mkdtemp(join(tmpdir(), 'model-evaluation-test-'));
  fixtureDirectories.push(directory);
  const fixturePath = join(directory, 'fixture.md');
  await writeFile(fixturePath, original, 'utf8');
  const fixture = pathToFileURL(fixturePath);
  expect(await readFile(fixture, 'utf8')).toBe(original);

  return {
    id: 'test-case',
    title: 'Test case',
    fixture,
    ...overrides,
  };
}

function modelResult(output: string) {
  return {
    output,
    outputDirectory: '/tmp/model-evaluation-output',
    outputPath: '/tmp/model-evaluation-output/revised-document.md',
    tracePath: '/tmp/model-evaluation-output/codex-trace.jsonl',
  };
}
