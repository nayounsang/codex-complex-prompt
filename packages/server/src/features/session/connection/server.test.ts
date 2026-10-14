import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { startLocalBridgeServer } from '../../../index.js';
import {
  authenticate,
  closeTestSockets,
  nextClose,
  nextMessage,
  openSocket,
} from '../../../test-support/server.js';

afterEach(closeTestSockets);

describe('서버 세션 연결', () => {
  const feedbackModelCatalog = [
    {
      model: 'gpt-6.1-sol',
      displayName: 'GPT-6.1 Sol',
      supportedReasoningEfforts: [{ effort: 'high', description: 'High' }],
      defaultReasoningEffort: 'high',
    },
  ];

  it('인증된 준비 메시지에 초기 Markdown과 feedback 상태를 포함한다', async () => {
    const server = await startLocalBridgeServer({
      initialMarkdown: '# 초기 문서',
      feedbackLoop: true,
      feedbackModelCatalog,
      onPrompt: async () => undefined,
    });
    const session = server.createSession();

    try {
      const { ready } = await authenticate(server, session.token);

      expect(ready).toMatchObject({
        type: 'session.ready',
        initialMarkdown: '# 초기 문서',
        feedbackLoop: true,
        feedbackModelCatalog,
      });
    } finally {
      await server.close();
    }
  });

  it('feedback model 카탈로그를 비동기로 불러와 연결별로 재사용한다', async () => {
    let loadCount = 0;
    const server = await startLocalBridgeServer({
      loadFeedbackModelCatalog: async () => {
        loadCount += 1;
        return feedbackModelCatalog;
      },
      onPrompt: async () => undefined,
    });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);

      for (let request = 0; request < 2; request += 1) {
        const result = nextMessage(socket);
        socket.send(JSON.stringify({ type: 'feedback-model.catalog.request' }));

        await expect(result).resolves.toMatchObject({
          type: 'feedback-model.catalog.result',
          catalog: feedbackModelCatalog,
        });
      }

      expect(loadCount).toBe(1);
    } finally {
      await server.close();
    }
  });

  it('feedback model 카탈로그를 불러오지 못하면 빈 목록을 반환한다', async () => {
    const server = await startLocalBridgeServer({
      loadFeedbackModelCatalog: async () => {
        throw new Error('Codex model catalog is unavailable.');
      },
      onPrompt: async () => undefined,
    });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);
      const result = nextMessage(socket);
      socket.send(JSON.stringify({ type: 'feedback-model.catalog.request' }));

      await expect(result).resolves.toMatchObject({
        type: 'feedback-model.catalog.result',
        catalog: [],
      });
    } finally {
      await server.close();
    }
  });

  it('feedback loop 연결에서도 feedback model 카탈로그를 불러온다', async () => {
    const server = await startLocalBridgeServer({
      feedbackLoop: true,
      loadFeedbackModelCatalog: async () => feedbackModelCatalog,
      onPrompt: async () => undefined,
    });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);
      const result = nextMessage(socket);
      socket.send(JSON.stringify({ type: 'feedback-model.catalog.request' }));

      await expect(result).resolves.toMatchObject({
        type: 'feedback-model.catalog.result',
        catalog: feedbackModelCatalog,
      });
    } finally {
      await server.close();
    }
  });

  it('지원하지 않는 feedback model 선택을 거부한다', async () => {
    const server = await startLocalBridgeServer({ onPrompt: async () => undefined });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);
      socket.send(
        JSON.stringify({
          type: 'prompt.submit',
          submissionId: randomUUID(),
          prompt: 'Feedback',
          sendFeedbackToSubagent: true,
          feedbackModel: { model: 'unknown-model', reasoningEffort: 'high' },
        }),
      );

      expect(await nextMessage(socket)).toMatchObject({
        type: 'session.error',
        code: 'invalid_message',
        message: 'The selected feedback model is not supported.',
      });
    } finally {
      await server.close();
    }
  });

  it('비활성 feedback subagent에는 명시된 feedback model을 보내지 않는다', async () => {
    let receivedFeedbackModel: unknown;
    const server = await startLocalBridgeServer({
      onPrompt: async (_prompt, context) => {
        receivedFeedbackModel = context.feedbackModel;
      },
    });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);
      const result = nextMessage(socket);
      socket.send(
        JSON.stringify({
          type: 'prompt.submit',
          submissionId: randomUUID(),
          prompt: 'Feedback',
          sendFeedbackToSubagent: false,
          feedbackModel: { model: 'unknown-model', reasoningEffort: 'high' },
        }),
      );

      await expect(result).resolves.toMatchObject({
        type: 'prompt.result',
        status: 'accepted',
      });
      expect(receivedFeedbackModel).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it('지원되는 feedback model 선택을 prompt adapter에 전달한다', async () => {
    let receivedFeedbackModel: unknown;
    const server = await startLocalBridgeServer({
      feedbackModelCatalog,
      onPrompt: async (_prompt, context) => {
        receivedFeedbackModel = context.feedbackModel;
      },
    });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);
      const result = nextMessage(socket);
      socket.send(
        JSON.stringify({
          type: 'prompt.submit',
          submissionId: randomUUID(),
          prompt: 'Feedback',
          sendFeedbackToSubagent: true,
          feedbackModel: { model: 'gpt-6.1-sol', reasoningEffort: 'high' },
        }),
      );

      await expect(result).resolves.toMatchObject({
        type: 'prompt.result',
        status: 'accepted',
      });
      expect(receivedFeedbackModel).toEqual({ model: 'gpt-6.1-sol', reasoningEffort: 'high' });
    } finally {
      await server.close();
    }
  });

  it('핸드셰이크 전에 프롬프트를 제출하면 연결을 종료한다', async () => {
    const server = await startLocalBridgeServer({ onPrompt: async () => undefined });

    try {
      const socket = await openSocket(server);
      socket.send(
        JSON.stringify({
          type: 'prompt.submit',
          submissionId: randomUUID(),
          prompt: 'Not authenticated',
        }),
      );

      expect(await nextMessage(socket)).toMatchObject({
        type: 'session.error',
        code: 'invalid_token',
      });
      expect(await nextClose(socket)).toBe(1008);
    } finally {
      await server.close();
    }
  });

  it('유효하지 않은 세션 토큰을 거부한다', async () => {
    const server = await startLocalBridgeServer({ onPrompt: async () => undefined });

    try {
      const socket = await openSocket(server);
      socket.send(JSON.stringify({ type: 'session.handshake', token: 'b'.repeat(32) }));

      expect(await nextMessage(socket)).toMatchObject({
        type: 'session.error',
        code: 'invalid_token',
      });
    } finally {
      await server.close();
    }
  });

  it('인증 후 잘못된 JSON을 거부한다', async () => {
    const server = await startLocalBridgeServer({ onPrompt: async () => undefined });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);
      socket.send('{not-json');

      expect(await nextMessage(socket)).toMatchObject({
        type: 'session.error',
        code: 'invalid_message',
      });
    } finally {
      await server.close();
    }
  });

  it('유효한 세션 토큰으로 연결하면 준비 메시지를 보낸다', async () => {
    const server = await startLocalBridgeServer({ onPrompt: async () => undefined });
    const session = server.createSession();

    try {
      const { ready } = await authenticate(server, session.token);

      expect(ready).toMatchObject({ type: 'session.ready', sessionId: session.id });
    } finally {
      await server.close();
    }
  });

  it('사용 중인 포트로 브리지를 시작하면 실패한다', async () => {
    const firstServer = await startLocalBridgeServer({ onPrompt: async () => undefined });

    try {
      await expect(
        startLocalBridgeServer({ port: firstServer.port, onPrompt: async () => undefined }),
      ).rejects.toThrow();
    } finally {
      await firstServer.close();
    }
  });

  it('핸드셰이크 타임아웃이 지나면 인증 오류와 함께 연결을 종료한다', async () => {
    const server = await startLocalBridgeServer({
      handshakeTimeoutMs: 20,
      onPrompt: async () => undefined,
    });

    try {
      const socket = await openSocket(server);

      expect(await nextMessage(socket)).toMatchObject({
        type: 'session.error',
        code: 'invalid_token',
      });
      expect(await nextClose(socket)).toBe(1008);
    } finally {
      await server.close();
    }
  });

  it('최대 WebSocket 페이로드를 초과한 프레임을 종료한다', async () => {
    const server = await startLocalBridgeServer({ onPrompt: async () => undefined });

    try {
      const socket = await openSocket(server);
      const close = nextClose(socket);
      socket.send(JSON.stringify({ type: 'invalid', payload: 'x'.repeat(70 * 1024) }));

      expect(await close).toBe(1009);
    } finally {
      await server.close();
    }
  });

  it('이미 사용한 세션 토큰의 재사용을 거부한다', async () => {
    const server = await startLocalBridgeServer({ onPrompt: async () => undefined });
    const session = server.createSession();

    try {
      await authenticate(server, session.token);
      const socket = await openSocket(server);
      socket.send(JSON.stringify({ type: 'session.handshake', token: session.token }));

      expect(await nextMessage(socket)).toMatchObject({
        type: 'session.error',
        code: 'invalid_token',
      });
    } finally {
      await server.close();
    }
  });

  it('인증 후 다시 핸드셰이크를 보내면 잘못된 메시지를 반환한다', async () => {
    const server = await startLocalBridgeServer({ onPrompt: async () => undefined });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);
      socket.send(JSON.stringify({ type: 'session.handshake', token: session.token }));

      expect(await nextMessage(socket)).toMatchObject({
        type: 'session.error',
        code: 'invalid_message',
      });
    } finally {
      await server.close();
    }
  });

  it('프로토콜 스키마에 맞지 않는 메시지를 거부한다', async () => {
    const server = await startLocalBridgeServer({ onPrompt: async () => undefined });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);
      socket.send(JSON.stringify({ type: 'prompt.submit', prompt: 'missing submission ID' }));

      expect(await nextMessage(socket)).toMatchObject({
        type: 'session.error',
        code: 'invalid_message',
      });
    } finally {
      await server.close();
    }
  });

  it('세션 TTL이 지나면 연결을 종료한다', async () => {
    const server = await startLocalBridgeServer({
      ttlMs: 500,
      onPrompt: async () => undefined,
    });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);

      expect(await nextMessage(socket, 1_500)).toMatchObject({
        type: 'session.error',
        code: 'session_expired',
      });
    } finally {
      await server.close();
    }
  });

  it('최대 연결 수를 초과한 클라이언트를 거부한다', async () => {
    const server = await startLocalBridgeServer({
      maxConnections: 1,
      onPrompt: async () => undefined,
    });

    try {
      await openSocket(server);
      const second = await openSocket(server);

      expect(await nextClose(second)).toBe(1013);
    } finally {
      await server.close();
    }
  });
});
