import { randomUUID } from 'node:crypto';

import type { ReviewSubmit } from '@codex-complex-prompt/protocol';

import { startCliBridge, type CliBridgeOptions } from './index.js';

export interface CodexStopHookInput {
  readonly hook_event_name?: string;
  readonly stop_hook_active?: boolean;
  readonly last_assistant_message?: string | null;
  readonly plan?: string | null;
  readonly response?: string | null;
  readonly output?: string | null;
  readonly [key: string]: unknown;
}

export interface CodexHookOutput {
  readonly continue: true;
  readonly systemMessage?: string;
}

export interface CodexHookContinuation {
  readonly decision: 'block';
  readonly reason: string;
}

export type CodexStopHookResult = CodexHookOutput | CodexHookContinuation;

export interface RunCodexStopHookOptions {
  readonly bridgeOptions?: Omit<CliBridgeOptions, 'review' | 'onReview'>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export function parseCodexStopHookInput(input: string): CodexStopHookInput {
  if (input.trim() === '') throw new Error('Codex Stop hook input is empty.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(input) as unknown;
  } catch {
    throw new Error('Codex Stop hook input must be valid JSON.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Codex Stop hook input must be a JSON object.');
  }
  const record = parsed as Record<string, unknown>;
  if (record['hook_event_name'] !== undefined && record['hook_event_name'] !== 'Stop') {
    throw new Error('Codex Stop hook input has an unexpected event name.');
  }
  if (
    record['last_assistant_message'] !== undefined &&
    record['last_assistant_message'] !== null &&
    typeof record['last_assistant_message'] !== 'string'
  ) {
    throw new Error('last_assistant_message must be a string or null.');
  }
  return record;
}

export function extractReviewContent(input: CodexStopHookInput): string | undefined {
  const candidates: unknown[] = [
    input.plan,
    input.last_assistant_message,
    input.response,
    input.output,
  ];
  return candidates
    .find(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.trim() !== '',
    )
    ?.trim();
}

export async function runCodexStopHook(
  rawInput: string,
  options: RunCodexStopHookOptions = {},
): Promise<CodexStopHookResult> {
  let input: CodexStopHookInput;
  try {
    input = parseCodexStopHookInput(rawInput);
  } catch (error) {
    return continueWithMessage(error instanceof Error ? error.message : 'Invalid hook input.');
  }

  if (input.stop_hook_active === true) {
    return { continue: true };
  }
  const content = extractReviewContent(input);
  if (content === undefined) {
    return continueWithMessage('No assistant response was available for browser review.');
  }

  const reviewId = randomUUID();
  let resolveReview: ((result: ReviewSubmit) => void) | undefined;
  const reviewResult = new Promise<ReviewSubmit>((resolve) => {
    resolveReview = resolve;
  });
  const bridge = await startCliBridge({
    ...options.bridgeOptions,
    review: { reviewId, title: 'Review Codex response', content },
    onReview: (result) => {
      resolveReview?.(result);
      return Promise.resolve();
    },
  });

  if (!bridge.browserOpened) {
    await bridge.stop();
    return continueWithMessage('The browser could not be opened for review.');
  }

  try {
    const result = await waitForReview(reviewResult, options.timeoutMs ?? 120_000, options.signal);
    if (result.decision === 'approved') return { continue: true };
    const feedback = result.feedback?.trim();
    if (result.decision === 'feedback' && feedback !== undefined && feedback !== '') {
      return { decision: 'block', reason: `Browser review feedback: ${feedback}` };
    }
    return { decision: 'block', reason: 'The browser review was rejected.' };
  } catch (error) {
    return continueWithMessage(error instanceof Error ? error.message : 'Browser review ended.');
  } finally {
    await bridge.stop();
  }
}

function continueWithMessage(systemMessage: string): CodexHookOutput {
  return { continue: true, systemMessage };
}

async function waitForReview(
  review: Promise<ReviewSubmit>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<ReviewSubmit> {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Browser review timeout must be a positive integer.');
  }
  if (signal?.aborted === true) throw new Error('Browser review was cancelled.');
  let timeout: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      review,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Browser review timed out.')), timeoutMs);
        onAbort = () => reject(new Error('Browser review was cancelled.'));
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort);
  }
}
