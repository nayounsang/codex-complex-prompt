import {
  CodexUserPromptSubmitInputSchema,
  type CodexUserPromptSubmitInput,
} from '@codex-complex-prompt/protocol';

import { startCliBridge, type CliBridgeOptions } from './index.js';

export interface CodexUserPromptHookOutput {
  readonly continue: true;
  readonly systemMessage?: string;
  readonly hookSpecificOutput?: {
    readonly hookEventName: 'UserPromptSubmit';
    readonly additionalContext: string;
  };
}

export interface RunCodexUserPromptHookOptions {
  readonly bridgeOptions?: Omit<CliBridgeOptions, 'inputAdapter'>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

const COMPLEX_PROMPT_INVOCATION = /^\s*(?:\$|\/)complex-prompt(?:\s|$)/;

export function parseCodexUserPromptHookInput(rawInput: string): CodexUserPromptSubmitInput {
  if (rawInput.trim() === '') throw new Error('Codex UserPromptSubmit hook input is empty.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawInput);
  } catch {
    throw new Error('Codex UserPromptSubmit hook input must be valid JSON.');
  }
  const result = CodexUserPromptSubmitInputSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error('Codex UserPromptSubmit hook input does not match the JSON contract.');
  }
  return result.data;
}

export async function runCodexUserPromptHook(
  rawInput: string,
  options: RunCodexUserPromptHookOptions = {},
): Promise<CodexUserPromptHookOutput> {
  let input: CodexUserPromptSubmitInput;
  try {
    input = parseCodexUserPromptHookInput(rawInput);
  } catch (error) {
    return continueWithMessage(error instanceof Error ? error.message : 'Invalid hook input.');
  }

  if (!COMPLEX_PROMPT_INVOCATION.test(input.prompt)) return { continue: true };

  let resolveCommand: ((command: string) => void) | undefined;
  const commandResult = new Promise<string>((resolve) => {
    resolveCommand = resolve;
  });
  const bridge = await startCliBridge({
    ...options.bridgeOptions,
    inputAdapter: {
      submit: (command: string) => {
        resolveCommand?.(command);
        return Promise.resolve();
      },
    },
  });

  if (!bridge.browserOpened) {
    await bridge.stop();
    return continueWithMessage('The browser command editor could not be opened.');
  }

  try {
    const command = (
      await waitForCommand(commandResult, options.timeoutMs ?? 120_000, options.signal)
    ).trim();
    if (command === '') {
      return continueWithMessage('The browser command editor returned an empty command.');
    }
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext:
          'Execute the following command supplied by the user through the Codex Complex Prompt editor:\n\n' +
          command,
      },
    };
  } catch (error) {
    return continueWithMessage(
      error instanceof Error ? error.message : 'The browser command editor ended.',
    );
  } finally {
    await bridge.stop();
  }
}

function continueWithMessage(systemMessage: string): CodexUserPromptHookOutput {
  return { continue: true, systemMessage };
}

async function waitForCommand(
  command: Promise<string>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<string> {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Browser command editor timeout must be a positive integer.');
  }
  if (signal?.aborted === true) throw new Error('Browser command editor was cancelled.');
  let timeout: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      command,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Browser command editor timed out.')),
          timeoutMs,
        );
        onAbort = () => reject(new Error('Browser command editor was cancelled.'));
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort);
  }
}
