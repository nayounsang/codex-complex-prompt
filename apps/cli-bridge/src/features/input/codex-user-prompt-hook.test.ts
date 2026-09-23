import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseCodexUserPromptHookInput, runCodexUserPromptHook } from './codex-user-prompt-hook.js';
import { createFeedbackLoopStateStore } from '../feedback/feedback-loop-state.js';

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

  it('프롬프트 중간에 포함된 호출 문자열은 브라우저를 열지 않는다', async () => {
    const result = await runCodexUserPromptHook(
      JSON.stringify({ prompt: '설명에 $complex-prompt 문자열이 포함된 일반 요청' }),
      { bridgeOptions: { openBrowser: () => Promise.reject(new Error('must not open')) } },
    );

    expect(result).toEqual({ continue: true });
  });

  it('/complex-prompt 호출도 브라우저 명령으로 연결한다', async () => {
    let browserUrl: string | undefined;
    const resultPromise = runCodexUserPromptHook(
      JSON.stringify({ prompt: '/complex-prompt 요청' }),
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
    expect(url.searchParams.has('markdown')).toBe(false);
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
    await expect(readyMessage).resolves.toMatchObject([
      expect.objectContaining({ type: 'session.ready', initialMarkdown: '요청' }),
    ]);
    socket.send(
      JSON.stringify({
        type: 'prompt.submit',
        submissionId: '00000000-0000-4000-8000-000000000011',
        prompt: '  slash command 테스트  ',
      }),
    );

    await expect(resultPromise).resolves.toMatchObject({
      continue: true,
      hookSpecificOutput: { hookEventName: 'UserPromptSubmit' },
    });
  });

  it('로컬 Markdown 파일 경로를 받으면 파일 내용을 브라우저 초기값으로 전달한다', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codex-complex-prompt-hook-'));
    temporaryDirectories.push(directory);
    const filePath = join(directory, 'prompt input.md');
    const markdown = '# 파일 입력\n\n한글과 특수문자: &?#';
    await writeFile(filePath, markdown, 'utf8');

    let browserUrl: string | undefined;
    const resultPromise = runCodexUserPromptHook(
      JSON.stringify({ prompt: `$complex-prompt ${filePath}` }),
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
    expect(url.searchParams.has('markdown')).toBe(false);

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
    await expect(readyMessage).resolves.toMatchObject([
      expect.objectContaining({ type: 'session.ready', initialMarkdown: markdown }),
    ]);
    socket.send(
      JSON.stringify({
        type: 'prompt.submit',
        submissionId: '00000000-0000-4000-8000-000000000012',
        prompt: '파일을 바탕으로 작업해줘',
      }),
    );

    await expect(resultPromise).resolves.toEqual({
      continue: true,
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext:
          'Execute the following command supplied by the user through the Codex Complex Prompt editor:\n\n파일을 바탕으로 작업해줘',
      },
    });
    await expect(readFile(filePath, 'utf8')).resolves.toBe(markdown);
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
    const resultMessage = collectMessages(socket, 1);
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
    await expect(resultMessage).resolves.toEqual([
      {
        type: 'prompt.result',
        submissionId: '00000000-0000-4000-8000-000000000010',
        status: 'accepted',
      },
    ]);
  });

  it('AI Feedback 제출에 편집본을 포함하고 후속 브라우저 검토를 예약한다', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'codex-feedback-loop-'));
    temporaryDirectories.push(directory);
    const feedbackLoopStateStore = createFeedbackLoopStateStore(directory);
    const sessionId = 'feedback-loop-session';
    let browserUrl: string | undefined;
    const resultPromise = runCodexUserPromptHook(
      JSON.stringify({
        hook_event_name: 'UserPromptSubmit',
        session_id: sessionId,
        prompt: '$complex-prompt # 초안',
      }),
      {
        timeoutMs: 2_000,
        feedbackLoopStateStore,
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
        submissionId: '00000000-0000-4000-8000-000000000013',
        prompt:
          '## AI Feedback\n\n### Global feedback\n\nMake the language professional.\n\n### Current Markdown\n\n# Edited draft',
        mode: 'feedback',
      }),
    );

    const result = await resultPromise;

    expect(result.hookSpecificOutput?.additionalContext).toContain('# Edited draft');
    expect(result.hookSpecificOutput?.additionalContext).toContain(
      'Return the complete updated Markdown only',
    );
    expect(await feedbackLoopStateStore.isActive(sessionId)).toBe(true);
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
