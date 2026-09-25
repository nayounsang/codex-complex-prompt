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
  type AttachmentStore,
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

async function startAttachmentTestServer(
  attachmentStoreOverrides: Partial<AttachmentStore> = {},
): Promise<{ server: RunningLocalBridgeServer; token: string }> {
  const attachmentStore: AttachmentStore = {
    save: async () => '00000000-0000-4000-8000-000000000001',
    read: async () => undefined,
    hasSceneData: async () => false,
    delete: async () => false,
    ...attachmentStoreOverrides,
  };
  const server = await startLocalBridgeServer({
    attachmentStore,
    onPrompt: async () => undefined,
  });
  const session = server.createSession();
  const { ready } = await authenticate(server, session.token);
  return { server, token: (ready as { attachmentToken: string }).attachmentToken };
}

describe('로컬 브리지 서버', () => {
  it('첨부 컬렉션 경로에서 그림 저장 요청을 받는다', async () => {
    const id = '00000000-0000-4000-8000-000000000006';
    let saved = false;
    const server = await startLocalBridgeServer({
      attachmentStore: {
        save: async () => {
          saved = true;
          return id;
        },
        read: async () => undefined,
        hasSceneData: async () => false,
        delete: async () => false,
      },
      onPrompt: async () => undefined,
    });
    const session = server.createSession();
    const { ready } = await authenticate(server, session.token);
    const attachmentToken = (ready as { attachmentToken: string }).attachmentToken;

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments?token=${encodeURIComponent(attachmentToken)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ png: 'data:image/png;base64,AA==', scene: '{}' }),
        },
      );

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ id });
      expect(saved).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('그림과 편집 데이터가 함께 있으면 존재 확인 요청에 응답한다', async () => {
    const id = '00000000-0000-4000-8000-000000000007';
    const server = await startLocalBridgeServer({
      attachmentStore: {
        save: async () => id,
        read: async () => ({ png: Buffer.from('png'), scene: '{"elements":[]}' }),
        hasSceneData: async () => true,
        delete: async () => false,
      },
      onPrompt: async () => undefined,
    });
    const session = server.createSession();
    const { ready } = await authenticate(server, session.token);
    const attachmentToken = (ready as { attachmentToken: string }).attachmentToken;

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/${id}.json?token=${encodeURIComponent(attachmentToken)}`,
        { method: 'HEAD' },
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('');
    } finally {
      await server.close();
    }
  });

  it('편집 데이터가 없는 이미지는 존재 확인 요청에서 찾을 수 없다고 응답한다', async () => {
    const id = '00000000-0000-4000-8000-000000000008';
    const server = await startLocalBridgeServer({
      attachmentStore: {
        save: async () => id,
        read: async () => undefined,
        hasSceneData: async () => false,
        delete: async () => false,
      },
      onPrompt: async () => undefined,
    });
    const session = server.createSession();
    const { ready } = await authenticate(server, session.token);
    const attachmentToken = (ready as { attachmentToken: string }).attachmentToken;

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/${id}.json?token=${encodeURIComponent(attachmentToken)}`,
        { method: 'HEAD' },
      );

      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('인증된 그림 URL에서 PNG 첨부 파일을 반환한다', async () => {
    const png = Buffer.from('png-data');
    const { server, token } = await startAttachmentTestServer({
      read: async () => ({ png, scene: '{"elements":[]}' }),
    });

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/00000000-0000-4000-8000-000000000009.png?token=${encodeURIComponent(token)}`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    } finally {
      await server.close();
    }
  });

  it('인증된 그림 URL에서 편집 장면 JSON을 반환한다', async () => {
    const scene = '{"elements":[{"id":"shape"}]}';
    const { server, token } = await startAttachmentTestServer({
      read: async () => ({ png: Buffer.from('png-data'), scene }),
    });

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/00000000-0000-4000-8000-000000000010.json?token=${encodeURIComponent(token)}`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(await response.text()).toBe(scene);
    } finally {
      await server.close();
    }
  });

  it('그림 저장소 읽기가 실패하면 500 응답을 반환한다', async () => {
    const { server, token } = await startAttachmentTestServer({
      read: async () => {
        throw new Error('disk unavailable');
      },
    });

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/00000000-0000-4000-8000-000000000011.png?token=${encodeURIComponent(token)}`,
      );

      expect(response.status).toBe(500);
    } finally {
      await server.close();
    }
  });

  it('그림 존재 확인 저장소가 실패하면 500 응답을 반환한다', async () => {
    const { server, token } = await startAttachmentTestServer({
      hasSceneData: async () => {
        throw new Error('disk unavailable');
      },
    });

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/00000000-0000-4000-8000-000000000036.json?token=${encodeURIComponent(token)}`,
        { method: 'HEAD' },
      );

      expect(response.status).toBe(500);
    } finally {
      await server.close();
    }
  });

  it('그림 삭제에 성공하면 204 응답을 반환한다', async () => {
    let deletedId = '';
    const { server, token } = await startAttachmentTestServer({
      delete: async (id) => {
        deletedId = id;
        return true;
      },
    });
    const id = '00000000-0000-4000-8000-000000000012';

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/${id}?token=${encodeURIComponent(token)}`,
        { method: 'DELETE' },
      );

      expect(response.status).toBe(204);
      expect(deletedId).toBe(id);
    } finally {
      await server.close();
    }
  });

  it('그림 저장소 삭제가 실패하면 500 응답을 반환한다', async () => {
    const { server, token } = await startAttachmentTestServer({
      delete: async () => {
        throw new Error('disk unavailable');
      },
    });

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/00000000-0000-4000-8000-000000000013.png?token=${encodeURIComponent(token)}`,
        { method: 'DELETE' },
      );

      expect(response.status).toBe(500);
    } finally {
      await server.close();
    }
  });

  it('그림 요청의 OPTIONS 사전 요청에 loopback CORS 헤더를 반환한다', async () => {
    const { server, token } = await startAttachmentTestServer();

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments?token=${encodeURIComponent(token)}`,
        { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } },
      );

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
      expect(response.headers.get('access-control-allow-methods')).toContain('DELETE');
    } finally {
      await server.close();
    }
  });

  it('저장소에 없는 그림 조회 요청에 404 응답을 반환한다', async () => {
    const { server, token } = await startAttachmentTestServer();

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/00000000-0000-4000-8000-000000000014.png?token=${encodeURIComponent(token)}`,
      );

      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('확장자가 없는 그림 조회 URL에 400 응답을 반환한다', async () => {
    const { server, token } = await startAttachmentTestServer({
      read: async () => ({ png: Buffer.from('png-data'), scene: '{}' }),
    });

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/00000000-0000-4000-8000-000000000015?token=${encodeURIComponent(token)}`,
      );

      expect(response.status).toBe(400);
    } finally {
      await server.close();
    }
  });

  it('이미 없는 그림을 삭제하면 404 응답을 반환한다', async () => {
    const { server, token } = await startAttachmentTestServer({ delete: async () => false });

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/00000000-0000-4000-8000-000000000016?token=${encodeURIComponent(token)}`,
        { method: 'DELETE' },
      );

      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('그림 ID 경로에 지원하지 않는 HTTP 메서드는 405 응답을 반환한다', async () => {
    const { server, token } = await startAttachmentTestServer();

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/00000000-0000-4000-8000-000000000037.png?token=${encodeURIComponent(token)}`,
        { method: 'POST' },
      );

      expect(response.status).toBe(405);
    } finally {
      await server.close();
    }
  });

  it('첨부 토큰이 없으면 403 응답을 반환한다', async () => {
    const { server } = await startAttachmentTestServer();

    try {
      const response = await fetch(`${server.url}/_complex-prompt/attachments`);

      expect(response.status).toBe(403);
      expect(await response.text()).toBe('Invalid attachment token.');
    } finally {
      await server.close();
    }
  });

  it('길이가 같은 잘못된 첨부 토큰은 거부한다', async () => {
    const { server, token } = await startAttachmentTestServer();
    const invalidToken = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments?token=${encodeURIComponent(invalidToken)}`,
      );

      expect(response.status).toBe(403);
    } finally {
      await server.close();
    }
  });

  it('첨부 저장소가 설정되지 않으면 첨부 경로에 404 응답을 반환한다', async () => {
    const server = await startLocalBridgeServer({ onPrompt: async () => undefined });

    try {
      const response = await fetch(`${server.url}/_complex-prompt/attachments`);

      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('등록되지 않은 첨부 경로에 404 응답을 반환한다', async () => {
    const { server, token } = await startAttachmentTestServer();

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/not-a-uuid.png?token=${encodeURIComponent(token)}`,
      );

      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('잘못된 JSON 그림 저장 요청에 400 응답을 반환한다', async () => {
    const { server, token } = await startAttachmentTestServer();

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments?token=${encodeURIComponent(token)}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: expect.stringContaining('JSON is invalid'),
      });
    } finally {
      await server.close();
    }
  });

  it('필수 그림 데이터가 문자열이 아니면 400 응답을 반환한다', async () => {
    const { server, token } = await startAttachmentTestServer();

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments?token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ png: 1, scene: '{}' }),
        },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid attachment request.' });
    } finally {
      await server.close();
    }
  });

  it('잘못된 그림 ID로 첨부 저장을 요청하면 400 응답을 반환한다', async () => {
    const { server, token } = await startAttachmentTestServer();

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments?token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: 1, png: 'data:image/png;base64,AA==', scene: '{}' }),
        },
      );

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'Invalid attachment request.' });
    } finally {
      await server.close();
    }
  });

  it('첨부 저장소가 PNG 크기 제한 오류를 반환하면 413 응답을 반환한다', async () => {
    const { server, token } = await startAttachmentTestServer({
      save: async () => {
        throw new Error('PNG attachment exceeds the 25 MB limit.');
      },
    });

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments?token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ png: 'data:image/png;base64,AA==', scene: '{}' }),
        },
      );

      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining('25 MB') });
    } finally {
      await server.close();
    }
  });

  it('localhost 외부 출처의 첨부 요청에는 CORS 허용 헤더를 주지 않는다', async () => {
    const { server, token } = await startAttachmentTestServer();

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments?token=${encodeURIComponent(token)}`,
        { method: 'OPTIONS', headers: { Origin: 'https://example.com' } },
      );

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await server.close();
    }
  });

  it('잘못된 출처 형식의 첨부 요청은 CORS 허용 헤더 없이 응답한다', async () => {
    const { server, token } = await startAttachmentTestServer();

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments?token=${encodeURIComponent(token)}`,
        { method: 'OPTIONS', headers: { Origin: 'not a URL' } },
      );

      expect(response.status).toBe(204);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    } finally {
      await server.close();
    }
  });

  it('인증된 세션 준비 메시지에 초기 Markdown과 feedback 상태를 포함한다', async () => {
    const server = await startLocalBridgeServer({
      initialMarkdown: '# 초기 문서',
      feedbackLoop: true,
      onPrompt: async () => undefined,
    });
    const session = server.createSession();

    try {
      const { ready } = await authenticate(server, session.token);

      expect(ready).toMatchObject({
        type: 'session.ready',
        initialMarkdown: '# 초기 문서',
        feedbackLoop: true,
      });
    } finally {
      await server.close();
    }
  });

  it('프로젝트 템플릿 저장소의 목록을 세션 준비 메시지에 포함한다', async () => {
    const templates = [
      {
        id: randomUUID(),
        name: 'PRD',
        description: '요구사항 초안',
        body: '# 요구사항',
      },
    ];
    const server = await startLocalBridgeServer({
      templateStore: {
        list: async () => templates,
        save: async () => templates,
        delete: async () => [],
      },
      onPrompt: async () => undefined,
    });
    const session = server.createSession();

    try {
      const { ready } = await authenticate(server, session.token);

      expect(ready).toMatchObject({ type: 'session.ready', templates });
    } finally {
      await server.close();
    }
  });

  it('템플릿 목록 로드가 실패하면 세션 준비 메시지에 이유를 포함한다', async () => {
    const server = await startLocalBridgeServer({
      templateStore: {
        list: async () => {
          throw new Error('read failed');
        },
        save: async () => [],
        delete: async () => [],
      },
      onPrompt: async () => undefined,
    });
    const session = server.createSession();

    try {
      const { ready } = await authenticate(server, session.token);

      expect(ready).toMatchObject({
        type: 'session.ready',
        templatesError: 'Project templates could not be loaded from this directory.',
      });
    } finally {
      await server.close();
    }
  });

  it('템플릿 저장소 없이 목록을 요청하면 사용할 수 없다는 응답을 보낸다', async () => {
    const server = await startLocalBridgeServer({ onPrompt: async () => undefined });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);
      socket.send(JSON.stringify({ type: 'template.list', requestId: randomUUID() }));

      expect(await nextMessage(socket)).toMatchObject({
        type: 'template.result',
        status: 'failed',
        error: 'Project templates are unavailable.',
      });
    } finally {
      await server.close();
    }
  });

  it('템플릿 저장 요청에 저장된 목록을 반환한다', async () => {
    const template = {
      id: randomUUID(),
      name: 'PRD',
      description: '요구사항 초안',
      body: '# 요구사항',
    };
    const server = await startLocalBridgeServer({
      templateStore: {
        list: async () => [],
        save: async (saved) => [saved],
        delete: async () => [],
      },
      onPrompt: async () => undefined,
    });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);
      const requestId = randomUUID();
      socket.send(JSON.stringify({ type: 'template.save', requestId, template }));

      expect(await nextMessage(socket)).toMatchObject({
        type: 'template.result',
        requestId,
        status: 'accepted',
        templates: [template],
      });
    } finally {
      await server.close();
    }
  });

  it('심볼릭 링크 오류가 난 템플릿 삭제 요청에 구체적인 이유를 반환한다', async () => {
    const server = await startLocalBridgeServer({
      templateStore: {
        list: async () => [],
        save: async () => [],
        delete: async () => {
          throw Object.assign(new Error('symlink'), { code: 'ERR_TEMPLATE_SYMLINK' });
        },
      },
      onPrompt: async () => undefined,
    });
    const session = server.createSession();

    try {
      const { socket } = await authenticate(server, session.token);
      socket.send(
        JSON.stringify({ type: 'template.delete', requestId: randomUUID(), id: randomUUID() }),
      );

      expect(await nextMessage(socket)).toMatchObject({
        type: 'template.result',
        status: 'failed',
        error:
          'Project template storage does not allow symbolic links. Replace them with regular files and directories.',
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
