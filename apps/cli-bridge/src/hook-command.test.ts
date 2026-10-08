import { Readable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runCodexPlannotatorStopHook } from './features/feedback/hooks/codex-plannotator-stop-hook.js';
import { runCodexStopHook } from './features/feedback/hooks/codex-stop-hook.js';
import { runCodexUserPromptHook } from './features/input/hooks/codex-user-prompt-hook.js';
import {
  hookPlannotatorStopCommand,
  hookPromptCommand,
  hookStopCommand,
  hookWindowsCommand,
  runHookCommand,
} from './hook-command.js';

vi.mock('./features/input/hooks/codex-user-prompt-hook.js', () => ({
  runCodexUserPromptHook: vi.fn(),
}));
vi.mock('./features/feedback/hooks/codex-stop-hook.js', () => ({ runCodexStopHook: vi.fn() }));
vi.mock('./features/feedback/hooks/codex-plannotator-stop-hook.js', () => ({
  runCodexPlannotatorStopHook: vi.fn(),
}));

const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin');
const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const originalEntrypoint = process.argv[1];
let originalExitCode = process.exitCode;

function setStdin(input: string): void {
  setStdinChunks([input]);
}

function setStdinChunks(chunks: readonly (string | Buffer)[]): void {
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    value: Readable.from(chunks),
  });
}

function encodePayload(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

beforeEach(() => {
  vi.clearAllMocks();
  originalExitCode = process.exitCode;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalStdin === undefined) Reflect.deleteProperty(process, 'stdin');
  else Object.defineProperty(process, 'stdin', originalStdin);
  Reflect.set(process.argv, '1', originalEntrypoint);
  if (originalPlatform === undefined) Reflect.deleteProperty(process, 'platform');
  else Object.defineProperty(process, 'platform', originalPlatform);
  process.exitCode = originalExitCode;
});

describe('hook command dispatch', () => {
  it('routes prompt input to the prompt hook and prints its response', async () => {
    setStdin('{"hook_event_name":"UserPromptSubmit"}');
    vi.mocked(runCodexUserPromptHook).mockResolvedValue({ continue: true });
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(runHookCommand(['hook', 'prompt'])).resolves.toBe(true);

    expect(runCodexUserPromptHook).toHaveBeenCalledWith('{"hook_event_name":"UserPromptSubmit"}');
    expect(write).toHaveBeenCalledWith('{"continue":true}\n');
  });

  it('routes stop input to the stop hook and prints its response', async () => {
    setStdinChunks([Buffer.from('{"hook_event_name":"'), 'Stop"}']);
    vi.mocked(runCodexStopHook).mockResolvedValue({ continue: true });
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await expect(runHookCommand(['hook', 'stop'])).resolves.toBe(true);

    expect(runCodexStopHook).toHaveBeenCalledWith('{"hook_event_name":"Stop"}');
    expect(write).toHaveBeenCalledWith('{"continue":true}\n');
  });

  it('selects the Windows Plannotator command and emits the continue response when skipped', async () => {
    setStdin('{"hook_event_name":"Stop"}');
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    vi.mocked(runCodexPlannotatorStopHook).mockResolvedValue({ skipped: true });
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const command = 'plannotator hook stop --flag';
    const payload = encodePayload({ command, commandWindows: 'plannotator.cmd hook stop' });

    await expect(runHookCommand(['hook', 'plannotator-stop', payload])).resolves.toBe(true);

    expect(runCodexPlannotatorStopHook).toHaveBeenCalledWith(
      '{"hook_event_name":"Stop"}',
      'plannotator.cmd hook stop',
    );
    expect(write).toHaveBeenCalledWith('{"continue":true}\n');
  });

  it('sets the original command exit code when Plannotator is not skipped', async () => {
    setStdin('{"hook_event_name":"Stop"}');
    vi.mocked(runCodexPlannotatorStopHook).mockResolvedValue({ skipped: false, exitCode: 7 });
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const payload = encodePayload({ command: 'plannotator hook stop' });

    await expect(runHookCommand(['hook', 'plannotator-stop', payload])).resolves.toBe(true);

    expect(process.exitCode).toBe(7);
    expect(write).not.toHaveBeenCalled();
  });

  it('leaves the process exit code unchanged when the wrapped command returns none', async () => {
    setStdin('{"hook_event_name":"Stop"}');
    vi.mocked(runCodexPlannotatorStopHook).mockResolvedValue({ skipped: false });
    process.exitCode = 0;
    const payload = encodePayload({ command: 'plannotator hook stop' });

    await expect(runHookCommand(['hook', 'plannotator-stop', payload])).resolves.toBe(true);

    expect(process.exitCode).toBe(0);
  });

  it('rejects malformed Plannotator payload JSON', async () => {
    await expect(runHookCommand(['hook', 'plannotator-stop', 'not-json'])).rejects.toThrow();
  });

  it.each([
    ['an unknown command', ['version']],
    ['prompt with an extra argument', ['hook', 'prompt', 'extra']],
    ['stop with an extra argument', ['hook', 'stop', 'extra']],
    ['Plannotator stop without its payload', ['hook', 'plannotator-stop']],
  ])('leaves %s unhandled', async (_label, args) => {
    await expect(runHookCommand(args)).resolves.toBe(false);
  });
});

describe('hook command serialization', () => {
  it('uses the executable name when no entrypoint is available', () => {
    Reflect.set(process.argv, '1', undefined);

    expect(hookPromptCommand()).toBe('complex-prompt hook prompt');
    expect(hookStopCommand()).toBe('complex-prompt hook stop');
    expect(hookPlannotatorStopCommand()).toBe('complex-prompt hook plannotator-stop');
    expect(hookWindowsCommand('prompt')).toBe('complex-prompt hook prompt');
  });

  it('quotes shell entrypoints containing a single quote', () => {
    Reflect.set(process.argv, '1', "cli's entry.js");

    expect(hookPromptCommand()).toBe("'cli'\\''s entry.js' hook prompt");
    expect(hookStopCommand()).toBe("'cli'\\''s entry.js' hook stop");
    expect(hookPlannotatorStopCommand()).toBe("'cli'\\''s entry.js' hook plannotator-stop");
  });

  it('quotes Windows entrypoints and executables containing double quotes', () => {
    Reflect.set(process.argv, '1', "cli's entry.js");
    const originalExecPath = Object.getOwnPropertyDescriptor(process, 'execPath');
    Object.defineProperty(process, 'execPath', { configurable: true, value: 'C:\\node"path.exe' });
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' });
    try {
      expect(hookWindowsCommand('prompt')).toBe(
        '"C:\\node""path.exe" "cli\'s entry.js" hook prompt',
      );
    } finally {
      if (originalExecPath !== undefined)
        Object.defineProperty(process, 'execPath', originalExecPath);
    }
  });
});
