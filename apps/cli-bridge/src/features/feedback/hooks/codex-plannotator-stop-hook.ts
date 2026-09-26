import { execa } from 'execa';

import { CodexStopHookInputSchema } from '@codex-complex-prompt/protocol';

import {
  createFeedbackLoopStateStore,
  type FeedbackLoopStateStore,
} from '../state/feedback-loop-state.js';

export interface RunCodexPlannotatorStopHookOptions {
  readonly feedbackLoopStateStore?: FeedbackLoopStateStore;
  readonly executeCommand?: (command: string, rawInput: string) => Promise<number>;
}

export async function runCodexPlannotatorStopHook(
  rawInput: string,
  originalCommand: string,
  options: RunCodexPlannotatorStopHookOptions = {},
): Promise<{ readonly skipped: boolean; readonly exitCode?: number }> {
  let parsed: ReturnType<typeof CodexStopHookInputSchema.parse> | undefined;
  try {
    parsed = CodexStopHookInputSchema.parse(JSON.parse(rawInput));
  } catch {
    // Invalid or non-Codex input should retain the behavior of the configured command.
  }

  if (
    parsed !== undefined &&
    (await (options.feedbackLoopStateStore ?? createFeedbackLoopStateStore()).isActive(
      parsed.session_id,
    ))
  ) {
    return { skipped: true };
  }

  const exitCode = await (options.executeCommand ?? executeShellCommand)(originalCommand, rawInput);
  return { skipped: false, exitCode };
}

function executeShellCommand(command: string, rawInput: string): Promise<number> {
  return execa(command, {
    shell: true,
    input: rawInput,
    stdout: 'inherit',
    stderr: 'inherit',
    reject: false,
  }).then(({ exitCode }) => exitCode ?? 1);
}
