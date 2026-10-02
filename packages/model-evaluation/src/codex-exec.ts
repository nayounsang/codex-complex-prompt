import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ModelRunResult } from './types.js';

export async function runCodex(prompt: string): Promise<ModelRunResult> {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'complex-prompt-model-eval-'));
  const outputPath = join(outputDirectory, 'revised-document.md');
  const tracePath = join(outputDirectory, 'codex-trace.jsonl');
  const child = spawn(
    'codex',
    [
      'exec',
      '--json',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      '--cd',
      tmpdir(),
      '--output-last-message',
      outputPath,
      '-',
    ],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  const traceChunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => traceChunks.push(chunk));
  child.stdin.end(prompt);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', (error: Error) =>
      reject(
        new Error(`Could not start the Codex CLI. Output directory: ${outputDirectory}.`, {
          cause: error,
        }),
      ),
    );
    child.once('close', resolve);
  });
  const trace = Buffer.concat(traceChunks).toString('utf8');
  if (trace !== '') await writeFile(tracePath, trace, 'utf8');
  if (exitCode !== 0) {
    throw new Error(
      `codex exec exited with status ${String(exitCode)}. Output directory: ${outputDirectory}.`,
    );
  }

  const rawOutput = await readFile(outputPath, 'utf8');
  const output = rawOutput.endsWith('\n') ? rawOutput : `${rawOutput}\n`;
  if (rawOutput !== output) await writeFile(outputPath, output, 'utf8');

  return { output, outputDirectory, outputPath, tracePath };
}
