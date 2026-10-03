import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { dirname } from 'node:path';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { spawn } from 'node:child_process';

import { runCodex } from './codex-exec.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

interface SimulatedRun {
  readonly output?: string;
  readonly trace?: string;
  readonly exitCode?: number;
  readonly spawnError?: Error;
  readonly stdinError?: Error;
}

const outputDirectories: string[] = [];
const spawnMock = vi.mocked(spawn);
let simulatedRun: SimulatedRun;

describe('runCodex', () => {
  beforeEach(() => {
    simulatedRun = {};
    spawnMock.mockReset();
    spawnMock.mockImplementation((_command, args) => {
      const outputOption = args?.indexOf('--output-last-message') ?? -1;
      const outputPath = args?.[outputOption + 1];
      if (outputPath === undefined) throw new Error('Codex output path was not provided.');
      outputDirectories.push(dirname(outputPath));

      const child = new EventEmitter() as unknown as ChildProcess;
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      Object.assign(child, { stdin, stdout });
      stdin.once('finish', () => {
        if (simulatedRun.spawnError !== undefined) return;
        setImmediate(async () => {
          if (simulatedRun.stdinError !== undefined) {
            stdin.emit('error', simulatedRun.stdinError);
            child.emit('close', 1, null);
            return;
          }
          await writeFile(outputPath, simulatedRun.output ?? 'Model response', 'utf8');
          if (simulatedRun.trace !== undefined) stdout.write(simulatedRun.trace);
          child.emit('close', simulatedRun.exitCode ?? 0, null);
        });
      });
      if (simulatedRun.spawnError !== undefined) {
        setImmediate(() => child.emit('error', simulatedRun.spawnError));
      }
      return child;
    });
  });

  afterEach(async () => {
    await Promise.all(
      outputDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('returns the final response and stores a nonempty JSONL trace', async () => {
    simulatedRun = { output: 'Updated document', trace: '{"type":"turn.completed"}\n' };

    const result = await runCodex('Apply feedback.');

    expect(result.output).toBe('Updated document\n');
    await expect(readFile(result.outputPath, 'utf8')).resolves.toBe('Updated document\n');
    await expect(readFile(result.tracePath, 'utf8')).resolves.toBe('{"type":"turn.completed"}\n');
    expect(result.outputDirectory).toBe(dirname(result.outputPath));
  });

  it('keeps an existing final newline and does not create an empty trace', async () => {
    simulatedRun = { output: 'Updated document\n' };

    const result = await runCodex('Apply feedback.');

    expect(result.output).toBe('Updated document\n');
    await expect(readFile(result.tracePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('throws with the output directory when Codex exits unsuccessfully', async () => {
    simulatedRun = { trace: '{"type":"error"}\n', exitCode: 7 };

    await expect(runCodex('Apply feedback.')).rejects.toThrow(
      /codex exec exited with status 7\. Output directory:/,
    );
  });

  it('throws with the output directory when the Codex process cannot start', async () => {
    simulatedRun = { spawnError: Object.assign(new Error('not found'), { code: 'ENOENT' }) };

    await expect(runCodex('Apply feedback.')).rejects.toThrow(
      /Could not start the Codex CLI\. Output directory:/,
    );
  });

  it('throws with the output directory when the prompt stream fails', async () => {
    simulatedRun = { stdinError: Object.assign(new Error('broken pipe'), { code: 'EPIPE' }) };

    await expect(runCodex('Apply feedback.')).rejects.toThrow(
      /Could not send the prompt to the Codex CLI\. Output directory:/,
    );
  });
});
