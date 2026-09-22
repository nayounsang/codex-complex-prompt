import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import {
  resolveStaticPath,
  startLocalBridgeServer,
  type RunningLocalBridgeServer,
} from './index.js';

const sockets: WebSocket[] = [];

afterEach(async () => {
  await Promise.all(sockets.splice(0).map(closeSocket));
});

function nextMessage(socket: WebSocket, timeoutMs = 1_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('WebSocket message timed out.'));
    }, timeoutMs);
    const onMessage = (value: WebSocket.RawData): void => {
      cleanup();
      resolve(JSON.parse(rawDataToString(value)) as unknown);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error('WebSocket closed before the expected message.'));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    socket.once('message', onMessage);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

function nextClose(socket: WebSocket, timeoutMs = 1_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('WebSocket close timed out.'));
    }, timeoutMs);
    const onClose = (code: number): void => {
      cleanup();
      resolve(code);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off('close', onClose);
      socket.off('error', onError);
    };
    socket.once('close', onClose);
    socket.once('error', onError);
  });
}

async function openSocket(server: RunningLocalBridgeServer): Promise<WebSocket> {
  const socket = new WebSocket(`${server.url}/ws`);
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return socket;
}

async function authenticate(
  server: RunningLocalBridgeServer,
  token: string,
): Promise<{ socket: WebSocket; ready: unknown }> {
  const socket = await openSocket(server);
  socket.send(JSON.stringify({ type: 'session.handshake', token }));
  return { socket, ready: await nextMessage(socket) };
}

function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    socket.once('close', () => resolve());
    socket.close();
  });
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function rawDataToString(data: WebSocket.RawData): string {
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  return Buffer.from(data).toString();
}

function getHttp(url: string): Promise<{ statusCode: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({ statusCode: response.statusCode, body: Buffer.concat(chunks).toString() });
      });
    });
    request.once('error', reject);
  });
}

describe('로컬 브리지 서버', () => {
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

  it('feedback 제출에 최신 Markdown과 새 세션을 응답한다', async () => {
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

      const result = (await nextMessage(socket)) as {
        type: string;
        prompt?: string;
        nextSession?: { token: string };
      };
      expect(result).toMatchObject({ type: 'prompt.result', prompt: '# Updated Markdown' });
      expect(result.nextSession?.token).toHaveLength(43);
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
      ttlMs: 20,
      onPrompt: async () => undefined,
    });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);

      expect(await nextMessage(socket, 500)).toMatchObject({
        type: 'session.error',
        code: 'session_expired',
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

  it('WebSocket이 아닌 경로의 upgrade 요청을 종료한다', async () => {
    const server = await startLocalBridgeServer({ onPrompt: async () => undefined });

    try {
      const socket = new WebSocket(`${server.url}/not-ws`);
      sockets.push(socket);

      const termination = await new Promise<'error' | 'close'>((resolve) => {
        socket.once('error', () => resolve('error'));
        socket.once('close', () => resolve('close'));
      });

      expect(['error', 'close']).toContain(termination);
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

  it('정적 디렉터리가 없으면 브리지 상태를 HTTP로 반환한다', async () => {
    const server = await startLocalBridgeServer({ onPrompt: async () => undefined });

    try {
      const response = await getHttp(server.url);

      expect(response).toEqual({
        statusCode: 200,
        body: 'Codex Complex Prompt bridge is running.',
      });
    } finally {
      await server.close();
    }
  });

  it('정적 디렉터리의 색인 문서를 제공한다', async () => {
    const staticDir = await mkdtemp(join(tmpdir(), 'codex-complex-prompt-'));
    await writeFile(join(staticDir, 'index.html'), '<h1>bridge</h1>');
    const server = await startLocalBridgeServer({
      staticDir: `${staticDir}/`,
      onPrompt: async () => undefined,
    });

    try {
      const response = await getHttp(`${server.url}/`);

      expect(response).toEqual({ statusCode: 200, body: '<h1>bridge</h1>' });
    } finally {
      await server.close();
      await rm(staticDir, { recursive: true, force: true });
    }
  });

  it('정적 디렉터리에 없는 문서 요청에 404를 반환한다', async () => {
    const staticDir = await mkdtemp(join(tmpdir(), 'codex-complex-prompt-'));
    const server = await startLocalBridgeServer({
      staticDir,
      onPrompt: async () => undefined,
    });

    try {
      const response = await getHttp(`${server.url}/missing.js`);

      expect(response).toEqual({ statusCode: 404, body: 'Not found' });
    } finally {
      await server.close();
      await rm(staticDir, { recursive: true, force: true });
    }
  });

  it('정적 경로가 루트 밖을 가리키면 경로를 반환하지 않는다', () => {
    expect(resolveStaticPath('/tmp/codex-static', '/../../secret')).toBeUndefined();
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
});
