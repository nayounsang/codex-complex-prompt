import { CodexStopHookInputSchema, type PromptSubmitMode } from '@codex-complex-prompt/protocol';

import {
  createFeedbackLoopStateStore,
  type FeedbackLoopStateStore,
} from './feedback-loop-state.js';
import { DEFAULT_BROWSER_WAIT_TIMEOUT_MS } from '../../codex-hook-timeouts.js';
import { startCliBridge, type CliBridgeOptions } from '../../index.js';

export type CodexStopHookOutput =
  | { readonly continue: true; readonly systemMessage?: string }
  | { readonly decision: 'block'; readonly reason: string };

export interface RunCodexStopHookOptions {
  readonly bridgeOptions?: Omit<
    CliBridgeOptions,
    'feedbackLoop' | 'initialMarkdown' | 'inputAdapter'
  >;
  readonly timeoutMs?: number;
  readonly feedbackLoopStateStore?: FeedbackLoopStateStore;
}

interface BrowserSubmission {
  readonly prompt: string;
  readonly mode: PromptSubmitMode;
}

export async function runCodexStopHook(
  rawInput: string,
  options: RunCodexStopHookOptions = {},
): Promise<CodexStopHookOutput> {
  let input: ReturnType<typeof CodexStopHookInputSchema.parse>;
  try {
    if (rawInput.trim() === '') throw new Error('Codex Stop hook input is empty.');
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawInput);
    } catch {
      throw new Error('Codex Stop hook input must be valid JSON.');
    }
    input = CodexStopHookInputSchema.parse(parsed);
  } catch (error) {
    return continueWithMessage(error instanceof Error ? error.message : 'Invalid Stop hook input.');
  }

  const stateStore = options.feedbackLoopStateStore ?? createFeedbackLoopStateStore();
  if (!(await stateStore.isActive(input.session_id))) return { continue: true };

  const markdown = input.last_assistant_message?.trim() ?? '';
  if (markdown === '') {
    await stateStore.clear(input.session_id);
    return continueWithMessage(
      'The feedback editor was not reopened because the latest response was empty.',
    );
  }
  const projectDirectory = await stateStore.getCwd?.(input.session_id);

  let resolveSubmission: ((submission: BrowserSubmission) => void) | undefined;
  let resolveBridgeSubmission: (() => void) | undefined;
  const browserSubmission = new Promise<BrowserSubmission>((resolve) => {
    resolveSubmission = resolve;
  });
  const bridgeSubmission = new Promise<void>((resolve) => {
    resolveBridgeSubmission = resolve;
  });
  const bridge = await startCliBridge({
    ...options.bridgeOptions,
    initialMarkdown: markdown,
    feedbackLoop: true,
    ...(projectDirectory === undefined || projectDirectory.trim() === ''
      ? {}
      : { projectDirectory }),
    inputAdapter: {
      submit: (prompt, context) => {
        resolveSubmission?.({ prompt, mode: context?.mode ?? 'edit' });
        return bridgeSubmission;
      },
    },
  });

  if (!bridge.browserOpened) {
    await stateStore.clear(input.session_id);
    await bridge.stop();
    return continueWithMessage('The feedback editor could not be reopened.');
  }

  try {
    const submission = await waitForSubmission(
      browserSubmission,
      options.timeoutMs ?? DEFAULT_BROWSER_WAIT_TIMEOUT_MS,
    );
    resolveBridgeSubmission?.();
    await flushBridgeSubmission();
    if (submission.mode === 'finish') {
      await stateStore.clear(input.session_id);
      if (submission.prompt.trim() === '') {
        return continueWithMessage('The feedback review ended without a final document.');
      }
      return {
        decision: 'block',
        reason:
          "The user submitted the final Markdown and ended the browser review. Execute the user's requested command using the complete accepted document below as its instructions and context. Do not reopen the browser editor.\n\n" +
          submission.prompt,
      };
    }
    return {
      decision: 'block',
      reason: buildContinuationPrompt(submission),
    };
  } catch (error) {
    await stateStore.clear(input.session_id);
    return continueWithMessage(
      error instanceof Error ? error.message : 'The feedback editor ended.',
    );
  } finally {
    await bridge.stop();
  }
}

function buildContinuationPrompt(submission: BrowserSubmission): string {
  if (submission.mode === 'feedback') {
    return (
      "Apply the user's browser feedback to the complete Current Markdown document included below. Preserve all unaffected content. Return the complete updated Markdown only, without an introduction, summary, or code fence. The browser editor will reopen after your response.\n\n" +
      submission.prompt
    );
  }
  return (
    'The user edited the complete Markdown document in the browser. Use this submitted version as the document to continue from and return the complete Markdown only, without an introduction, summary, or code fence. The browser editor will reopen after your response.\n\n' +
    submission.prompt
  );
}

function continueWithMessage(systemMessage: string): CodexStopHookOutput {
  return { continue: true, systemMessage };
}

async function waitForSubmission(
  submission: Promise<BrowserSubmission>,
  timeoutMs: number,
): Promise<BrowserSubmission> {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Browser feedback editor timeout must be a positive integer.');
  }
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      submission,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Browser feedback editor timed out.')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function flushBridgeSubmission(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
