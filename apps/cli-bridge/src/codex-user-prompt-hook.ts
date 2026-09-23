import {
  CodexUserPromptSubmitInputSchema,
  type CodexUserPromptSubmitInput,
  type PromptSubmitMode,
} from '@codex-complex-prompt/protocol';

import { resolveInitialMarkdown } from './codex-prompt-input.js';
import { DEFAULT_BROWSER_WAIT_TIMEOUT_MS } from './codex-hook-timeouts.js';
import {
  createFeedbackLoopStateStore,
  type FeedbackLoopStateStore,
} from './feedback-loop-state.js';
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
  readonly bridgeOptions?: Omit<CliBridgeOptions, 'initialMarkdown' | 'inputAdapter'>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly feedbackLoopStateStore?: FeedbackLoopStateStore;
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

  const invocation = input.prompt.match(COMPLEX_PROMPT_INVOCATION);
  const initialMarkdown = await resolveInitialMarkdown(
    input.prompt.slice(invocation?.[0].length ?? 0),
  );
  let resolveCommand:
    ((submission: { command: string; mode: PromptSubmitMode }) => void) | undefined;
  let resolveSubmission: (() => void) | undefined;
  const commandResult = new Promise<{ command: string; mode: PromptSubmitMode }>((resolve) => {
    resolveCommand = resolve;
  });
  const submissionResult = new Promise<void>((resolve) => {
    resolveSubmission = resolve;
  });
  const feedbackLoopState = options.feedbackLoopStateStore ?? createFeedbackLoopStateStore();
  const bridge = await startCliBridge({
    ...options.bridgeOptions,
    initialMarkdown,
    inputAdapter: {
      submit: async (command: string, context) => {
        const mode = context?.mode ?? 'edit';
        if (mode === 'feedback' && command.trim() !== '') {
          await feedbackLoopState.activate(input.session_id);
        } else {
          await feedbackLoopState.clear(input.session_id);
        }
        resolveCommand?.({ command, mode });
        return submissionResult;
      },
    },
  });

  if (!bridge.browserOpened) {
    await bridge.stop();
    return continueWithMessage('The browser command editor could not be opened.');
  }

  try {
    const submission = await waitForCommand(
      commandResult,
      options.timeoutMs ?? DEFAULT_BROWSER_WAIT_TIMEOUT_MS,
      options.signal,
    );
    const command = submission.command.trim();
    if (command === '') {
      return continueWithMessage('The browser command editor returned an empty command.');
    }
    const result: CodexUserPromptHookOutput = {
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext:
          submission.mode === 'feedback'
            ? 'Apply the AI feedback to the complete Current Markdown document included below. Preserve all unaffected content. Return the complete updated Markdown only, without an introduction, summary, or code fence.\n\n' +
              command
            : 'Execute the following command supplied by the user through the Codex Complex Prompt editor:\n\n' +
              command,
      },
    };
    resolveSubmission?.();
    await flushBridgeSubmission();
    return result;
  } catch (error) {
    return continueWithMessage(
      error instanceof Error ? error.message : 'The browser command editor ended.',
    );
  } finally {
    await bridge.stop();
  }
}

function flushBridgeSubmission(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function continueWithMessage(systemMessage: string): CodexUserPromptHookOutput {
  return { continue: true, systemMessage };
}

async function waitForCommand(
  command: Promise<{ command: string; mode: PromptSubmitMode }>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<{ command: string; mode: PromptSubmitMode }> {
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
