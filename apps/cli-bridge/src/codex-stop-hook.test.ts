import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCodexStopHook } from './codex-stop-hook.js';
import { createFeedbackLoopStateStore } from './feedback-loop-state.js';

const sockets: WebSocket[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Codex Stop hook feedback editor', () => {
  it('빈 stdin을 받으면 Codex를 계속 진행하고 진단 메시지를 반환한다', async () => {
    const result = await runCodexStopHook('');

    expect(result).toMatchObject({ continue: true });
    if (!('systemMessage' in result)) throw new Error('Expected a diagnostic message.');
    expect(result.systemMessage).toContain('empty');
  });

  it('잘못된 JSON을 받으면 Codex를 계속 진행하고 진단 메시지를 반환한다', async () => {
    const result = await runCodexStopHook('{invalid');

    expect(result).toMatchObject({ continue: true });
    if (!('systemMessage' in result)) throw new Error('Expected a diagnostic message.');
    expect(result.systemMessage).toContain('valid JSON');
  });

  it('Stop 이벤트 계약에 맞지 않는 JSON을 받으면 편집기를 열지 않는다', async () => {
    let browserOpened = false;
    const result = await runCodexStopHook('{}', {
      bridgeOptions: {
        openBrowser: () => {
          browserOpened = true;
          return Promise.resolve();
        },
      },
    });

    expect(result).toMatchObject({ continue: true });
    expect(browserOpened).toBe(false);
  });

  it('feedback loop 상태가 없으면 브라우저를 열지 않고 Codex를 계속 진행한다', async () => {
    const directory = await createDirectory();
    const stateStore = createFeedbackLoopStateStore(directory);
    let browserOpened = false;
    const result = await runCodexStopHook(
      JSON.stringify({
        hook_event_name: 'Stop',
        session_id: 'inactive-session',
        last_assistant_message: '# Response',
      }),
      {
        feedbackLoopStateStore: stateStore,
        bridgeOptions: {
          openBrowser: () => {
            browserOpened = true;
            return Promise.resolve();
          },
        },
      },
    );

    expect(result).toEqual({ continue: true });
    expect(browserOpened).toBe(false);
  });

  it('세션 ID가 없으면 기본 상태 저장소에서 비활성으로 처리한다', async () => {
    const result = await runCodexStopHook(
      JSON.stringify({ hook_event_name: 'Stop', last_assistant_message: '# Response' }),
    );

    expect(result).toEqual({ continue: true });
  });

  it('마지막 응답이 비어 있으면 feedback loop 상태를 지우고 편집기를 건너뛴다', async () => {
    const directory = await createDirectory();
    const stateStore = createFeedbackLoopStateStore(directory);
    const sessionId = 'empty-response-session';
    await stateStore.activate(sessionId);

    const result = await runCodexStopHook(
      JSON.stringify({
        hook_event_name: 'Stop',
        session_id: sessionId,
        last_assistant_message: '  ',
      }),
      { feedbackLoopStateStore: stateStore },
    );

    expect(result).toMatchObject({
      continue: true,
      systemMessage: expect.stringContaining('empty'),
    });
    expect(await stateStore.isActive(sessionId)).toBe(false);
  });

  it('브라우저를 열 수 없으면 feedback loop 상태를 지우고 진단 메시지를 반환한다', async () => {
    const directory = await createDirectory();
    const stateStore = createFeedbackLoopStateStore(directory);
    const sessionId = 'browser-error-session';
    await stateStore.activate(sessionId);

    const result = await runCodexStopHook(
      JSON.stringify({
        hook_event_name: 'Stop',
        session_id: sessionId,
        last_assistant_message: '# Response',
      }),
      {
        feedbackLoopStateStore: stateStore,
        bridgeOptions: { openBrowser: () => Promise.reject(new Error('Browser unavailable')) },
      },
    );

    expect(result).toMatchObject({
      continue: true,
      systemMessage: 'The feedback editor could not be reopened.',
    });
    expect(await stateStore.isActive(sessionId)).toBe(false);
  });

  it('사용자가 다시 feedback을 보내면 feedback continuation을 반환한다', async () => {
    const directory = await createDirectory();
    const stateStore = createFeedbackLoopStateStore(directory);
    const sessionId = 'feedback-continuation-session';
    await stateStore.activate(sessionId);
    let browserUrl: string | undefined;
    const resultPromise = runCodexStopHook(
      JSON.stringify({
        hook_event_name: 'Stop',
        session_id: sessionId,
        last_assistant_message: '# Current Markdown',
      }),
      {
        timeoutMs: 2_000,
        feedbackLoopStateStore: stateStore,
        bridgeOptions: {
          openBrowser: (url) => {
            browserUrl = url;
            return Promise.resolve();
          },
        },
      },
    );

    await waitFor(() => browserUrl !== undefined);
    if (browserUrl === undefined) throw new Error('Browser URL was not captured.');
    const socket = await connectToEditor(browserUrl);
    socket.send(
      JSON.stringify({
        type: 'prompt.submit',
        submissionId: '00000000-0000-4000-8000-000000000024',
        prompt: 'Clarify the introduction.',
        mode: 'feedback',
      }),
    );

    await expect(resultPromise).resolves.toMatchObject({
      decision: 'block',
      reason: expect.stringContaining("Apply the user's browser feedback"),
    });
  });

  it('브라우저 제출이 timeout을 넘으면 상태를 지우고 Codex를 계속 진행한다', async () => {
    const directory = await createDirectory();
    const stateStore = createFeedbackLoopStateStore(directory);
    const sessionId = 'timeout-session';
    await stateStore.activate(sessionId);

    const result = await runCodexStopHook(
      JSON.stringify({
        hook_event_name: 'Stop',
        session_id: sessionId,
        last_assistant_message: '# Response',
      }),
      {
        timeoutMs: 1,
        feedbackLoopStateStore: stateStore,
        bridgeOptions: { openBrowser: () => Promise.resolve() },
      },
    );

    expect(result).toMatchObject({
      continue: true,
      systemMessage: 'Browser feedback editor timed out.',
    });
    expect(await stateStore.isActive(sessionId)).toBe(false);
  });

  it('마지막 Markdown을 새 편집기에 열고 브라우저 수정을 Codex continuation으로 전달한다', async () => {
    const directory = await createDirectory();
    const stateStore = createFeedbackLoopStateStore(directory);
    const sessionId = 'stop-loop-session';
    await stateStore.activate(sessionId);
    expect(await stateStore.isActive(sessionId)).toBe(true);
    const markdown = '# Revised document\n\nUpdated paragraph.';
    let browserUrl: string | undefined;
    const resultPromise = runCodexStopHook(
      JSON.stringify({
        hook_event_name: 'Stop',
        session_id: sessionId,
        last_assistant_message: markdown,
      }),
      {
        timeoutMs: 2_000,
        feedbackLoopStateStore: stateStore,
        bridgeOptions: {
          openBrowser: (url) => {
            browserUrl = url;
            return Promise.resolve();
          },
        },
      },
    );

    await waitFor(() => browserUrl !== undefined);
    if (browserUrl === undefined) throw new Error('Browser URL was not captured.');
    expect(new URL(browserUrl).searchParams.has('markdown')).toBe(false);
    expect(new URL(browserUrl).searchParams.has('feedbackLoop')).toBe(false);
    const socket = await connectToEditor(browserUrl);
    socket.send(
      JSON.stringify({
        type: 'prompt.submit',
        submissionId: '00000000-0000-4000-8000-000000000021',
        prompt: '# Browser revision\n\nUser-edited paragraph.',
      }),
    );

    await expect(resultPromise).resolves.toMatchObject({
      decision: 'block',
      reason: expect.stringContaining('# Browser revision'),
    });
    expect(await stateStore.isActive(sessionId)).toBe(true);
  });

  it('최종 Submit은 변경이 없어도 최종 Markdown의 명령을 실행하도록 이어간다', async () => {
    const directory = await createDirectory();
    const stateStore = createFeedbackLoopStateStore(directory);
    const sessionId = 'finish-loop-session';
    const markdown = '# Final document';
    await stateStore.activate(sessionId);
    expect(await stateStore.isActive(sessionId)).toBe(true);
    let browserUrl: string | undefined;
    const resultPromise = runCodexStopHook(
      JSON.stringify({
        hook_event_name: 'Stop',
        session_id: sessionId,
        last_assistant_message: markdown,
      }),
      {
        timeoutMs: 2_000,
        feedbackLoopStateStore: stateStore,
        bridgeOptions: {
          openBrowser: (url) => {
            browserUrl = url;
            return Promise.resolve();
          },
        },
      },
    );

    await waitFor(() => browserUrl !== undefined);
    if (browserUrl === undefined) throw new Error('Browser URL was not captured.');
    const socket = await connectToEditor(browserUrl);
    socket.send(
      JSON.stringify({
        type: 'prompt.submit',
        submissionId: '00000000-0000-4000-8000-000000000022',
        prompt: markdown,
        mode: 'finish',
      }),
    );

    const result = await resultPromise;

    if (!('decision' in result)) throw new Error('Expected a command continuation.');
    expect(result.decision).toBe('block');
    expect(result.reason).toContain("Execute the user's requested command");
    expect(result.reason).toContain(markdown);
    expect(await stateStore.isActive(sessionId)).toBe(false);
  });

  it('최종 Submit 전에 편집한 Markdown을 명령 실행 continuation에 전달한다', async () => {
    const directory = await createDirectory();
    const stateStore = createFeedbackLoopStateStore(directory);
    const sessionId = 'finish-edited-loop-session';
    const markdown = '# Latest response';
    const finalMarkdown = '# Final edited document';
    await stateStore.activate(sessionId);
    let browserUrl: string | undefined;
    const resultPromise = runCodexStopHook(
      JSON.stringify({
        hook_event_name: 'Stop',
        session_id: sessionId,
        last_assistant_message: markdown,
      }),
      {
        timeoutMs: 2_000,
        feedbackLoopStateStore: stateStore,
        bridgeOptions: {
          openBrowser: (url) => {
            browserUrl = url;
            return Promise.resolve();
          },
        },
      },
    );

    await waitFor(() => browserUrl !== undefined);
    if (browserUrl === undefined) throw new Error('Browser URL was not captured.');
    const socket = await connectToEditor(browserUrl);
    socket.send(
      JSON.stringify({
        type: 'prompt.submit',
        submissionId: '00000000-0000-4000-8000-000000000023',
        prompt: finalMarkdown,
        mode: 'finish',
      }),
    );

    await expect(resultPromise).resolves.toEqual({
      decision: 'block',
      reason: expect.stringContaining(finalMarkdown),
    });
    expect(await stateStore.isActive(sessionId)).toBe(false);
  });

  it('사용자가 확인 후 빈 최종 문서를 제출하면 Codex를 계속 진행하지 않는다', async () => {
    const directory = await createDirectory();
    const stateStore = createFeedbackLoopStateStore(directory);
    const sessionId = 'empty-finish-session';
    await stateStore.activate(sessionId);
    let browserUrl: string | undefined;
    const resultPromise = runCodexStopHook(
      JSON.stringify({
        hook_event_name: 'Stop',
        session_id: sessionId,
        last_assistant_message: '# Previously drafted document',
      }),
      {
        timeoutMs: 2_000,
        feedbackLoopStateStore: stateStore,
        bridgeOptions: {
          openBrowser: (url) => {
            browserUrl = url;
            return Promise.resolve();
          },
        },
      },
    );

    await waitFor(() => browserUrl !== undefined);
    if (browserUrl === undefined) throw new Error('Browser URL was not captured.');
    const socket = await connectToEditor(browserUrl);
    socket.send(
      JSON.stringify({
        type: 'prompt.submit',
        submissionId: '00000000-0000-4000-8000-000000000025',
        prompt: '',
        mode: 'finish',
      }),
    );

    await expect(resultPromise).resolves.toEqual({
      continue: true,
      systemMessage: 'The feedback review ended without a final document.',
    });
    expect(await stateStore.isActive(sessionId)).toBe(false);
  });
});

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codex-stop-hook-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function connectToEditor(url: string): Promise<WebSocket> {
  const pageUrl = new URL(url);
  const bridgeUrl = new URL(pageUrl.searchParams.get('bridge') ?? '');
  const socket = new WebSocket(
    `${bridgeUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${bridgeUrl.host}/ws`,
  );
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  const readyMessage = nextMessage(socket);
  socket.send(
    JSON.stringify({ type: 'session.handshake', token: pageUrl.searchParams.get('token') }),
  );
  await readyMessage;
  return socket;
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket message timed out.')), 1_000);
    socket.once('message', (data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()) as unknown);
    });
    socket.once('error', reject);
  });
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Condition timed out.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
