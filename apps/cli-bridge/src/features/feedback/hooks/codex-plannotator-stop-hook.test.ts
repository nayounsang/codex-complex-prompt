import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createFeedbackLoopStateStore } from '../state/feedback-loop-state.js';
import { runCodexPlannotatorStopHook } from './codex-plannotator-stop-hook.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Plannotator Stop 래퍼', () => {
  it('feedback loop가 활성화된 세션에서는 Plannotator를 건너뛴다', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codex-plannotator-test-'));
    temporaryDirectories.push(directory);
    const stateStore = createFeedbackLoopStateStore(directory);
    await stateStore.activate('active-session');
    let executed = false;

    const result = await runCodexPlannotatorStopHook(
      JSON.stringify({ hook_event_name: 'Stop', session_id: 'active-session' }),
      'plannotator hook stop',
      {
        feedbackLoopStateStore: stateStore,
        executeCommand: async () => {
          executed = true;
          return 0;
        },
      },
    );

    expect(result).toEqual({ skipped: true });
    expect(executed).toBe(false);
  });

  it('feedback loop가 비활성화된 세션에서는 원래 명령과 입력을 전달한다', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codex-plannotator-test-'));
    temporaryDirectories.push(directory);
    const stateStore = createFeedbackLoopStateStore(directory);
    const rawInput = JSON.stringify({ hook_event_name: 'Stop', session_id: 'inactive-session' });
    let received: { command: string; input: string } | undefined;

    const result = await runCodexPlannotatorStopHook(rawInput, 'plannotator hook stop --review', {
      feedbackLoopStateStore: stateStore,
      executeCommand: async (command, input) => {
        received = { command, input };
        return 7;
      },
    });

    expect(result).toEqual({ skipped: false, exitCode: 7 });
    expect(received).toEqual({ command: 'plannotator hook stop --review', input: rawInput });
  });
});
