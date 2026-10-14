import { randomBytes, randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { startLocalBridgeServer as startNodeServer, SessionStore } from '../../../index.js';
import { AttachmentTokenStore } from '../../attachments/attachment-token-store.js';
import { createBridgeNestApplication } from '../../../runtime/create-bridge-nest-application.js';
import type { LocalBridgeServerOptions, RunningLocalBridgeServer } from '../../../shared/types.js';
import {
  authenticate,
  closeTestSockets,
  nextClose,
  nextMessage,
  openSocket,
  trackSocket,
} from '../../../test-support/server.js';

afterEach(closeTestSockets);

async function startNestServer(
  options: LocalBridgeServerOptions,
): Promise<RunningLocalBridgeServer> {
  const application = await createBridgeNestApplication(options);
  const host = options.host ?? '127.0.0.1';

  try {
    await application.listen(options.port ?? 0, host);
    const address = application.getHttpServer().address();
    if (address === null || typeof address === 'string') {
      throw new Error('The Nest connection test server did not expose a TCP address.');
    }
    const sessionStore = application.get(SessionStore, { strict: false });
    const attachmentTokens = application.get(AttachmentTokenStore, { strict: false });

    return {
      host,
      port: address.port,
      url: `http://${host}:${address.port}`,
      createSession: () => {
        const session = sessionStore.create();
        if (options.attachmentStore !== undefined) {
          attachmentTokens.set(session.id, randomBytes(32).toString('base64url'));
        }
        return { id: session.id, token: session.token, expiresAt: session.expiresAt };
      },
      close: () => application.close(),
    };
  } catch (error) {
    await application.close();
    throw error;
  }
}

const connectionServerFactories = [
  ['Node', startNodeServer],
  ['Nest', startNestServer],
] as const;

describe.each(connectionServerFactories)(
  '%s 세션 WebSocket 계약',
  (_runtime, startLocalBridgeServer) => {
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

    it('같은 포트에서 HTTP 상태 응답과 WebSocket 핸드셰이크를 제공한다', async () => {
      const server = await startLocalBridgeServer({ onPrompt: async () => undefined });
      const session = server.createSession();

      try {
        const response = await fetch(server.url);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('Codex Complex Prompt bridge is running.');

        const { ready } = await authenticate(server, session.token);
        expect(ready).toMatchObject({ type: 'session.ready', sessionId: session.id });
      } finally {
        await server.close();
      }
    });

    it('핸드셰이크에 같은 앱의 첨부 URL과 토큰을 포함한다', async () => {
      const server = await startLocalBridgeServer({
        attachmentStore: {
          save: async () => 'id',
          read: async () => undefined,
          hasSceneData: async () => false,
          delete: async () => false,
        },
        onPrompt: async () => undefined,
      });
      const session = server.createSession();

      try {
        const { ready } = await authenticate(server, session.token);

        expect(ready).toMatchObject({
          type: 'session.ready',
          attachmentUrl: `${server.url}/_complex-prompt/attachments`,
          attachmentToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
        });
      } finally {
        await server.close();
      }
    });

    it('허용하지 않는 WebSocket upgrade 경로를 종료한다', async () => {
      const server = await startLocalBridgeServer({ onPrompt: async () => undefined });

      try {
        const socket = new WebSocket(`${server.url}/not-ws`);
        trackSocket(socket);
        const termination = await new Promise<'error' | 'close'>((resolve) => {
          socket.once('error', () => resolve('error'));
          socket.once('close', () => resolve('close'));
        });

        expect(['error', 'close']).toContain(termination);
      } finally {
        await server.close();
      }
    });

    it('두 앱은 세션 인증 저장소를 공유하지 않는다', async () => {
      const first = await startLocalBridgeServer({
        maxConnections: 2,
        onPrompt: async () => undefined,
      });
      let second: RunningLocalBridgeServer | undefined;

      try {
        second = await startLocalBridgeServer({
          maxConnections: 2,
          onPrompt: async () => undefined,
        });
        const firstSession = first.createSession();
        const secondSession = second.createSession();
        const firstConnection = await authenticate(first, firstSession.token);

        const foreignSocket = await openSocket(second);
        foreignSocket.send(
          JSON.stringify({ type: 'session.handshake', token: firstSession.token }),
        );
        expect(await nextMessage(foreignSocket)).toMatchObject({
          type: 'session.error',
          code: 'invalid_token',
        });

        const secondConnection = await authenticate(second, secondSession.token);
        expect(firstConnection.ready).toMatchObject({
          type: 'session.ready',
          sessionId: firstSession.id,
        });
        expect(secondConnection.ready).toMatchObject({
          type: 'session.ready',
          sessionId: secondSession.id,
        });
      } finally {
        await Promise.all([first.close(), second?.close()]);
      }
    });

    it('두 앱은 각자의 연결 제한을 적용한다', async () => {
      const first = await startLocalBridgeServer({
        maxConnections: 1,
        onPrompt: async () => undefined,
      });
      let second: RunningLocalBridgeServer | undefined;

      try {
        second = await startLocalBridgeServer({
          maxConnections: 1,
          onPrompt: async () => undefined,
        });
        const firstSession = first.createSession();
        const secondSession = second.createSession();
        const firstConnection = await authenticate(first, firstSession.token);
        const secondConnection = await authenticate(second, secondSession.token);

        expect(firstConnection.ready).toMatchObject({
          type: 'session.ready',
          sessionId: firstSession.id,
        });
        expect(secondConnection.ready).toMatchObject({
          type: 'session.ready',
          sessionId: secondSession.id,
        });
      } finally {
        await Promise.all([first.close(), second?.close()]);
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

    it('서버 시작 제한값은 양의 정수만 허용한다', async () => {
      for (const options of [
        { promptTimeoutMs: 0 },
        { promptTimeoutMs: 1.5 },
        { maxConnections: 0 },
        { maxConnections: 1.5 },
        { handshakeTimeoutMs: 0 },
        { handshakeTimeoutMs: 1.5 },
      ]) {
        await expect(
          startLocalBridgeServer({ ...options, onPrompt: async () => undefined }),
        ).rejects.toThrow('positive integer');
      }
    });

    it('기본 주소로 임시 포트에서 시작하고 세션 자격 증명을 발급한다', async () => {
      const server = await startLocalBridgeServer({ onPrompt: async () => undefined });

      try {
        expect(server.host).toBe('127.0.0.1');
        expect(server.port).toBeGreaterThan(0);
        expect(server.url).toBe(`http://127.0.0.1:${server.port}`);

        const session = server.createSession();
        expect(session.id).toMatch(/^[0-9a-f-]{36}$/i);
        expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
      } finally {
        await server.close();
      }
    });

    it('종료할 때 연결을 닫고 같은 포트를 다시 사용할 수 있다', async () => {
      const first = await startLocalBridgeServer({ onPrompt: async () => undefined });
      let closeFirstPromise: Promise<void> | undefined;
      const closeFirst = (): Promise<void> => (closeFirstPromise ??= first.close());

      try {
        const socket = await openSocket(first);
        const socketClosed = nextClose(socket);
        const port = first.port;

        await closeFirst();

        expect(await socketClosed).toBe(1006);

        const second = await startLocalBridgeServer({
          host: first.host,
          port,
          onPrompt: async () => undefined,
        });
        try {
          expect(second.port).toBe(port);
          const response = await fetch(second.url);
          expect(response.status).toBe(200);
          await response.text();
        } finally {
          await second.close();
        }
      } finally {
        await closeFirst();
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
  },
);
