import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { parseCodexUserPromptHookInput, runCodexUserPromptHook } from './codex-user-prompt-hook.js';

const sockets: WebSocket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
});

describe('Codex UserPromptSubmit 훅 어댑터', () => {
  it('zod 계약으로 UserPromptSubmit 입력을 파싱한다', () => {
    const input = parseCodexUserPromptHookInput(
      JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: '$complex-prompt 요청' }),
    );

    expect(input.prompt).toBe('$complex-prompt 요청');
  });

  it('빈 입력과 malformed JSON을 Codex를 막지 않는 결과로 변환한다', async () => {
    const empty = await runCodexUserPromptHook('');
    const malformed = await runCodexUserPromptHook('{not-json');

    expect(empty).toMatchObject({ continue: true });
    expect(empty.systemMessage).toContain('empty');
    expect(malformed).toMatchObject({ continue: true });
    expect(malformed.systemMessage).toContain('valid JSON');
  });

  it('복합 명령이 아니면 브라우저를 열지 않는다', async () => {
    const result = await runCodexUserPromptHook(
      JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: '일반 요청' }),
      { bridgeOptions: { openBrowser: () => Promise.reject(new Error('must not open')) } },
    );

    expect(result).toEqual({ continue: true });
  });

  it('복합 명령을 브라우저에서 입력하면 additionalContext로 반환한다', async () => {
    let browserUrl: string | undefined;
    const resultPromise = runCodexUserPromptHook(
      JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: '$complex-prompt 요청' }),
      {
        timeoutMs: 2_000,
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
    const url = new URL(browserUrl);
    const bridgeUrl = new URL(url.searchParams.get('bridge') ?? '');
    const socket = new WebSocket(
      `${bridgeUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${bridgeUrl.host}/ws`,
    );
    sockets.push(socket);
    await onceOpen(socket);
    const readyMessage = collectMessages(socket, 1);
    socket.send(
      JSON.stringify({ type: 'session.handshake', token: url.searchParams.get('token') }),
    );
    await readyMessage;
    socket.send(
      JSON.stringify({
        type: 'prompt.submit',
        submissionId: '00000000-0000-4000-8000-000000000010',
        prompt: '  테스트를 실행해줘  ',
      }),
    );

    await expect(resultPromise).resolves.toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext:
          'Execute the following command supplied by the user through the Codex Complex Prompt editor:\n\n테스트를 실행해줘',
      },
    });
  });

  it('브라우저를 열 수 없으면 systemMessage와 함께 계속 진행한다', async () => {
    const result = await runCodexUserPromptHook(
      JSON.stringify({ prompt: '$complex-prompt 요청' }),
      { bridgeOptions: { openBrowser: () => Promise.reject(new Error('browser unavailable')) } },
    );

    expect(result).toMatchObject({ continue: true });
    expect(result.systemMessage).toContain('could not be opened');
  });

  it('timeout과 취소를 systemMessage로 보고한다', async () => {
    const timeout = await runCodexUserPromptHook(
      JSON.stringify({ prompt: '$complex-prompt 요청' }),
      {
        timeoutMs: 20,
        bridgeOptions: { openBrowser: () => Promise.resolve() },
      },
    );
    const controller = new AbortController();
    const cancelledPromise = runCodexUserPromptHook(
      JSON.stringify({ prompt: '$complex-prompt 요청' }),
      {
        signal: controller.signal,
        timeoutMs: 2_000,
        bridgeOptions: { openBrowser: () => Promise.resolve() },
      },
    );
    controller.abort();
    const cancelled = await cancelledPromise;

    expect(timeout.systemMessage).toContain('timed out');
    expect(cancelled.systemMessage).toContain('cancelled');
  });

  it('잘못된 timeout과 이미 취소된 신호를 systemMessage로 보고한다', async () => {
    const timeout = await runCodexUserPromptHook(
      JSON.stringify({ prompt: '$complex-prompt 요청' }),
      {
        timeoutMs: 0,
        bridgeOptions: { openBrowser: () => Promise.resolve() },
      },
    );
    const controller = new AbortController();
    controller.abort();
    const cancelled = await runCodexUserPromptHook(
      JSON.stringify({ prompt: '$complex-prompt 요청' }),
      {
        signal: controller.signal,
        bridgeOptions: { openBrowser: () => Promise.resolve() },
      },
    );

    expect(timeout.systemMessage).toContain('positive integer');
    expect(cancelled.systemMessage).toContain('cancelled');
  });
});

function onceOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function collectMessages(socket: WebSocket, count: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const messages: unknown[] = [];
    const timeout = setTimeout(() => reject(new Error('WebSocket messages timed out.')), 1_000);
    const onMessage = (data: WebSocket.RawData): void => {
      messages.push(JSON.parse(data.toString()));
      if (messages.length === count) {
        clearTimeout(timeout);
        socket.off('message', onMessage);
        resolve(messages);
      }
    };
    socket.on('message', onMessage);
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
