import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { startLocalBridgeServer } from '../../../index.js';
import { authenticate, closeTestSockets, nextMessage, wait } from '../../../test-support/server.js';

afterEach(closeTestSockets);

describe('서버 프롬프트 입력', () => {
  it('feedback 제출에 최신 Markdown을 응답한다', async () => {
    const server = await startLocalBridgeServer({
      onPrompt: async (_prompt, context) => {
        expect(context.mode).toBe('feedback');
        return '# Updated Markdown';
      },
    });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);
      socket.send(
        JSON.stringify({
          type: 'prompt.submit',
          submissionId: randomUUID(),
          prompt: '## AI Feedback\n\nPlease update it.',
          mode: 'feedback',
        }),
      );

      expect(await nextMessage(socket)).toMatchObject({
        type: 'prompt.result',
        status: 'accepted',
        prompt: '# Updated Markdown',
      });
    } finally {
      await server.close();
    }
  });

  it('어댑터가 실패하면 실패 결과를 보낸다', async () => {
    const server = await startLocalBridgeServer({
      onPrompt: async () => {
        throw new Error('adapter unavailable');
      },
    });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);
      socket.send(
        JSON.stringify({
          type: 'prompt.submit',
          submissionId: randomUUID(),
          prompt: 'Fail this prompt',
        }),
      );

      expect(await nextMessage(socket)).toMatchObject({
        type: 'prompt.result',
        status: 'failed',
        error: 'The Codex session could not accept this prompt.',
      });
    } finally {
      await server.close();
    }
  });

  it('인증된 클라이언트의 프롬프트를 어댑터로 전달하고 승인 결과를 보낸다', async () => {
    const received: string[] = [];
    const server = await startLocalBridgeServer({
      onPrompt: async (prompt) => {
        received.push(prompt);
      },
    });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);
      socket.send(
        JSON.stringify({
          type: 'prompt.submit',
          submissionId: randomUUID(),
          prompt: 'Forward me',
        }),
      );

      expect(await nextMessage(socket)).toMatchObject({
        type: 'prompt.result',
        status: 'accepted',
      });
      expect(received).toEqual(['Forward me']);
    } finally {
      await server.close();
    }
  });

  it('동시에 도착한 프롬프트를 어댑터에 제출 순서대로 전달한다', async () => {
    const received: string[] = [];
    let releaseFirst!: () => void;
    const firstPromptFinished = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const server = await startLocalBridgeServer({
      onPrompt: async (prompt) => {
        received.push(prompt);
        if (prompt === 'first') await firstPromptFinished;
      },
    });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);
      socket.send(
        JSON.stringify({ type: 'prompt.submit', submissionId: randomUUID(), prompt: 'first' }),
      );
      socket.send(
        JSON.stringify({ type: 'prompt.submit', submissionId: randomUUID(), prompt: 'second' }),
      );
      await wait(20);

      expect(received).toEqual(['first']);
      const firstResult = nextMessage(socket);
      const secondResult = nextMessage(socket);
      releaseFirst();
      await expect(firstResult).resolves.toMatchObject({ status: 'accepted' });
      await expect(secondResult).resolves.toMatchObject({ status: 'accepted' });
      expect(received).toEqual(['first', 'second']);
    } finally {
      await server.close();
    }
  });

  it('동일한 제출 ID를 두 번 제출하면 두 번째 요청을 거부한다', async () => {
    const received: string[] = [];
    const server = await startLocalBridgeServer({
      onPrompt: async (prompt) => {
        received.push(prompt);
      },
    });
    const session = server.createSession();
    const submissionId = randomUUID();

    try {
      const { socket } = await authenticate(server, session.token);
      const submission = (prompt: string): string =>
        JSON.stringify({ type: 'prompt.submit', submissionId, prompt });
      socket.send(submission('Forward me'));
      await nextMessage(socket);
      socket.send(submission('Forward me twice'));

      expect(await nextMessage(socket)).toMatchObject({
        type: 'session.error',
        code: 'duplicate_submission',
      });
      expect(received).toEqual(['Forward me']);
    } finally {
      await server.close();
    }
  });

  it('어댑터 응답이 타임아웃을 초과하면 실패 결과를 보낸다', async () => {
    const server = await startLocalBridgeServer({
      promptTimeoutMs: 20,
      onPrompt: async () => new Promise<void>(() => undefined),
    });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);
      socket.send(
        JSON.stringify({
          type: 'prompt.submit',
          submissionId: randomUUID(),
          prompt: 'This will time out',
        }),
      );

      expect(await nextMessage(socket)).toMatchObject({
        type: 'prompt.result',
        status: 'failed',
      });
    } finally {
      await server.close();
    }
  });
});
