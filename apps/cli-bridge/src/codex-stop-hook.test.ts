import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import {
  extractReviewContent,
  parseCodexStopHookInput,
  runCodexStopHook,
} from './codex-stop-hook.js';

const sockets: WebSocket[] = [];

afterEach(() => {
  for (const socket of sockets.splice(0)) socket.close();
});

describe('Codex Stop 훅 어댑터', () => {
  it('Stop 이벤트에서 어시스턴트 응답을 추출한다', () => {
    const input = parseCodexStopHookInput(
      JSON.stringify({ hook_event_name: 'Stop', last_assistant_message: 'Plan text' }),
    );

    expect(extractReviewContent(input)).toBe('Plan text');
  });

  it('대체 응답 필드보다 계획 필드를 우선한다', () => {
    const input = parseCodexStopHookInput(
      JSON.stringify({ plan: 'Plan field', response: 'Response field', output: 'Output field' }),
    );

    expect(extractReviewContent(input)).toBe('Plan field');
  });

  it('예상하지 않은 이벤트 이름의 Stop 이벤트를 거부한다', () => {
    expect(() =>
      parseCodexStopHookInput(JSON.stringify({ hook_event_name: 'UserPromptSubmit' })),
    ).toThrow('unexpected event name');
  });

  it('JSON 객체가 아닌 Stop 이벤트를 거부한다', () => {
    expect(() => parseCodexStopHookInput('[]')).toThrow('must be a JSON object');
  });

  it('문자열이 아닌 어시스턴트 메시지의 Stop 이벤트를 거부한다', () => {
    expect(() => parseCodexStopHookInput(JSON.stringify({ last_assistant_message: 42 }))).toThrow(
      'must be a string or null',
    );
  });

  it('잘못된 형식의 Stop 이벤트가 리뷰 없이 계속 진행되도록 한다', async () => {
    const result = await runCodexStopHook('{not-json');

    expect(result).toMatchObject({ continue: true });
    expect((result as { systemMessage?: string }).systemMessage).toContain('valid JSON');
  });

  it('빈 Stop 이벤트가 리뷰 없이 계속 진행되도록 한다', async () => {
    const result = await runCodexStopHook('');

    expect(result).toMatchObject({ continue: true });
    expect((result as { systemMessage?: string }).systemMessage).toContain('empty');
  });

  it('응답이 없는 Stop 이벤트가 리뷰 없이 계속 진행되도록 한다', async () => {
    const result = await runCodexStopHook(JSON.stringify({ hook_event_name: 'Stop' }));

    expect(result).toMatchObject({ continue: true });
    expect((result as { systemMessage?: string }).systemMessage).toContain('No assistant response');
  });

  it('Codex가 이미 계속 진행한 훅은 다시 리뷰하지 않는다', async () => {
    const result = await runCodexStopHook(
      JSON.stringify({ stop_hook_active: true, last_assistant_message: 'Plan text' }),
    );

    expect(result).toEqual({ continue: true });
  });

  it('브라우저 리뷰가 도착하지 않으면 타임아웃 메시지와 함께 계속 진행한다', async () => {
    const result = await runCodexStopHook(JSON.stringify({ last_assistant_message: 'Plan text' }), {
      timeoutMs: 20,
      bridgeOptions: { openBrowser: () => Promise.resolve() },
    });

    expect(result).toMatchObject({ continue: true });
    expect((result as { systemMessage?: string }).systemMessage).toContain('timed out');
  });

  it('브라우저가 승인 결과를 제출하면 승인을 반환한다', async () => {
    let browserUrl: string | undefined;
    const resultPromise = runCodexStopHook(
      JSON.stringify({ last_assistant_message: 'Plan text' }),
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
    const url = new URL(browserUrl as string);
    const bridgeUrl = new URL(url.searchParams.get('bridge') as string);
    const socket = new WebSocket(
      `${bridgeUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${bridgeUrl.host}/ws`,
    );
    sockets.push(socket);
    await onceOpen(socket);
    const initialMessages = collectMessages(socket, 2);
    socket.send(
      JSON.stringify({ type: 'session.handshake', token: url.searchParams.get('token') }),
    );
    const [, reviewReady] = (await initialMessages) as [unknown, { reviewId: string }];
    socket.send(
      JSON.stringify({
        type: 'review.submit',
        reviewId: reviewReady.reviewId,
        decision: 'approved',
      }),
    );

    await expect(resultPromise).resolves.toEqual({ continue: true });
  });

  it('브라우저가 리뷰를 거부하면 계속 진행할 피드백을 반환한다', async () => {
    let browserUrl: string | undefined;
    const resultPromise = runCodexStopHook(
      JSON.stringify({ last_assistant_message: 'Plan text' }),
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
    const url = new URL(browserUrl as string);
    const bridgeUrl = new URL(url.searchParams.get('bridge') as string);
    const socket = new WebSocket(
      `${bridgeUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${bridgeUrl.host}/ws`,
    );
    sockets.push(socket);
    await onceOpen(socket);
    const initialMessages = collectMessages(socket, 2);
    socket.send(
      JSON.stringify({ type: 'session.handshake', token: url.searchParams.get('token') }),
    );
    const [, reviewReady] = (await initialMessages) as [unknown, { reviewId: string }];
    socket.send(
      JSON.stringify({
        type: 'review.submit',
        reviewId: reviewReady.reviewId,
        decision: 'feedback',
        feedback: 'Please revise the plan',
      }),
    );

    await expect(resultPromise).resolves.toEqual({
      decision: 'block',
      reason: 'Browser review feedback: Please revise the plan',
    });
  });

  it('브라우저가 피드백 없이 거부하면 거부 사유를 반환한다', async () => {
    let browserUrl: string | undefined;
    const resultPromise = runCodexStopHook(
      JSON.stringify({ last_assistant_message: 'Plan text' }),
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
    const url = new URL(browserUrl as string);
    const bridgeUrl = new URL(url.searchParams.get('bridge') as string);
    const socket = new WebSocket(
      `${bridgeUrl.protocol === 'https:' ? 'wss:' : 'ws:'}//${bridgeUrl.host}/ws`,
    );
    sockets.push(socket);
    await onceOpen(socket);
    const initialMessages = collectMessages(socket, 2);
    socket.send(
      JSON.stringify({ type: 'session.handshake', token: url.searchParams.get('token') }),
    );
    const [, reviewReady] = (await initialMessages) as [unknown, { reviewId: string }];
    socket.send(
      JSON.stringify({
        type: 'review.submit',
        reviewId: reviewReady.reviewId,
        decision: 'rejected',
      }),
    );

    await expect(resultPromise).resolves.toEqual({
      decision: 'block',
      reason: 'The browser review was rejected.',
    });
  });

  it('양수가 아닌 리뷰 타임아웃 설정에 오류를 반환한다', async () => {
    const result = await runCodexStopHook(JSON.stringify({ last_assistant_message: 'Plan text' }), {
      timeoutMs: 0,
      bridgeOptions: { openBrowser: () => Promise.resolve() },
    });

    expect(result).toMatchObject({ continue: true });
    expect((result as { systemMessage?: string }).systemMessage).toContain('positive integer');
  });

  it('브라우저를 열 수 없으면 브라우저 오류와 함께 계속 진행한다', async () => {
    const result = await runCodexStopHook(JSON.stringify({ last_assistant_message: 'Plan text' }), {
      bridgeOptions: {
        openBrowser: () => Promise.reject(new Error('browser unavailable')),
      },
    });

    expect(result).toMatchObject({ continue: true });
    expect((result as { systemMessage?: string }).systemMessage).toContain('could not be opened');
  });

  it('리뷰가 취소되면 취소 메시지와 함께 계속 진행한다', async () => {
    const controller = new AbortController();
    const resultPromise = runCodexStopHook(
      JSON.stringify({ last_assistant_message: 'Plan text' }),
      {
        signal: controller.signal,
        timeoutMs: 2_000,
        bridgeOptions: { openBrowser: () => Promise.resolve() },
      },
    );
    controller.abort();

    await expect(resultPromise).resolves.toMatchObject({
      continue: true,
      systemMessage: expect.stringContaining('cancelled'),
    });
  });
});

function onceOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

function collectMessages(socket: WebSocket, count: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const messages: unknown[] = [];
    const timeout = setTimeout(() => reject(new Error('WebSocket messages timed out.')), 1_000);
    const onMessage = (data: WebSocket.RawData): void => {
      messages.push(JSON.parse(data.toString()) as unknown);
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
    if (Date.now() >= deadline) throw new Error('Condition timed out.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
