import { AttachmentTooLargeError } from '@codex-complex-prompt/protocol';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  startLocalBridgeServer,
  type AttachmentStore,
  type RunningLocalBridgeServer,
} from '../../../index.js';

async function authenticate(
  server: RunningLocalBridgeServer,
  token: string,
): Promise<{ ready: unknown }> {
  const socket = new WebSocket(`${server.url}/ws`);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  const ready = new Promise<unknown>((resolve, reject) => {
    socket.once('message', (data) => resolve(JSON.parse(data.toString()) as unknown));
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'session.handshake', token }));
  return { ready: await ready };
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
  it('video 첨부를 편집 장면 없이 저장한다', async () => {
    let savedInput: Parameters<NonNullable<AttachmentStore['save']>>[0] | undefined;
    const id = '00000000-0000-4000-8000-000000000038';
    const { server, token } = await startAttachmentTestServer({
      save: async (input) => {
        savedInput = input;
        return id;
      },
    });

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments?token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video: 'data:video/mp4;base64,AA==', extension: 'mp4' }),
        },
      );

      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ id });
      expect(savedInput).toEqual({ video: 'data:video/mp4;base64,AA==', extension: 'mp4' });
    } finally {
      await server.close();
    }
  });

  it('video 업로드에 편집 장면이나 잘못된 확장자를 주면 거부한다', async () => {
    const { server, token } = await startAttachmentTestServer();

    try {
      for (const body of [
        { video: 'data:video/mp4;base64,AA==', scene: '{}' },
        { video: 'data:video/mp4;base64,AA==', extension: 1 },
      ]) {
        const response = await fetch(
          `${server.url}/_complex-prompt/attachments?token=${encodeURIComponent(token)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );

        expect(response.status).toBe(400);
      }
    } finally {
      await server.close();
    }
  });

  it('video 저장소의 HEAD 요청에 전체 및 부분 응답 정보를 반환한다', async () => {
    const { server, token } = await startAttachmentTestServer({
      getVideoInfo: async () => ({ size: 10, mimeType: 'video/mp4' }),
    });
    const url = `${server.url}/_complex-prompt/attachments/00000000-0000-4000-8000-000000000039.mp4?token=${encodeURIComponent(token)}`;

    try {
      const full = await fetch(url, { method: 'HEAD' });
      expect(full.status).toBe(200);
      expect(full.headers.get('content-length')).toBe('10');
      expect(full.headers.get('accept-ranges')).toBe('bytes');

      const partial = await fetch(url, { method: 'HEAD', headers: { Range: 'bytes=2-4' } });
      expect(partial.status).toBe(206);
      expect(partial.headers.get('content-range')).toBe('bytes 2-4/10');
      expect(partial.headers.get('content-length')).toBe('3');

      const suffix = await fetch(url, { method: 'HEAD', headers: { Range: 'bytes=-2' } });
      expect(suffix.status).toBe(206);
      expect(suffix.headers.get('content-range')).toBe('bytes 8-9/10');

      const invalid = await fetch(url, { method: 'HEAD', headers: { Range: 'bytes=40-' } });
      expect(invalid.status).toBe(416);

      const missingServer = await startAttachmentTestServer({
        getVideoInfo: async () => undefined,
      });
      try {
        const missing = await fetch(
          `${missingServer.server.url}/_complex-prompt/attachments/00000000-0000-4000-8000-000000000040.mp4?token=${encodeURIComponent(missingServer.token)}`,
          { method: 'HEAD' },
        );
        expect(missing.status).toBe(404);
      } finally {
        await missingServer.server.close();
      }
    } finally {
      await server.close();
    }
  });

  it('video 저장소에서 GET range를 읽고 누락 및 오류를 처리한다', async () => {
    const id = '00000000-0000-4000-8000-000000000041';
    const bytes = Buffer.from('0123456789');
    const { server, token } = await startAttachmentTestServer({
      getVideoInfo: async () => ({ size: bytes.length, mimeType: 'video/mp4' }),
      readVideoRange: async (_id, _extension, start, end) => bytes.subarray(start, end + 1),
    });
    const url = `${server.url}/_complex-prompt/attachments/${id}.mp4?token=${encodeURIComponent(token)}`;

    try {
      const partial = await fetch(url, { headers: { Range: 'bytes=2-4' } });
      expect(partial.status).toBe(206);
      expect(partial.headers.get('content-range')).toBe('bytes 2-4/10');
      expect(Buffer.from(await partial.arrayBuffer())).toEqual(Buffer.from('234'));

      const invalid = await fetch(url, { headers: { Range: 'bytes=-' } });
      expect(invalid.status).toBe(416);

      const missingChunkServer = await startAttachmentTestServer({
        getVideoInfo: async () => ({ size: 10, mimeType: 'video/mp4' }),
        readVideoRange: async () => undefined,
      });
      try {
        const missingChunk = await fetch(
          `${missingChunkServer.server.url}/_complex-prompt/attachments/${id}.mp4?token=${encodeURIComponent(missingChunkServer.token)}`,
        );
        expect(missingChunk.status).toBe(404);
      } finally {
        await missingChunkServer.server.close();
      }

      const failureServer = await startAttachmentTestServer({
        getVideoInfo: async () => {
          throw new Error('disk unavailable');
        },
        readVideoRange: async () => undefined,
      });
      try {
        const failure = await fetch(
          `${failureServer.server.url}/_complex-prompt/attachments/${id}.mp4?token=${encodeURIComponent(failureServer.token)}`,
        );
        expect(failure.status).toBe(500);
      } finally {
        await failureServer.server.close();
      }
    } finally {
      await server.close();
    }
  });

  it('메모리 video 첨부의 전체 및 부분 GET 요청을 처리한다', async () => {
    const video = Buffer.from('0123456789');
    const { server, token } = await startAttachmentTestServer({
      read: async () => ({ video, extension: 'webm', mimeType: 'video/webm' }),
    });
    const url = `${server.url}/_complex-prompt/attachments/00000000-0000-4000-8000-000000000042.webm?token=${encodeURIComponent(token)}`;

    try {
      const full = await fetch(url);
      expect(full.status).toBe(200);
      expect(full.headers.get('content-type')).toBe('video/webm');
      expect(Buffer.from(await full.arrayBuffer())).toEqual(video);

      const partial = await fetch(url, { headers: { Range: 'bytes=3-' } });
      expect(partial.status).toBe(206);
      expect(partial.headers.get('content-range')).toBe('bytes 3-9/10');
      expect(Buffer.from(await partial.arrayBuffer())).toEqual(Buffer.from('3456789'));

      const suffix = await fetch(url, { headers: { Range: 'bytes=-3' } });
      expect(Buffer.from(await suffix.arrayBuffer())).toEqual(Buffer.from('789'));

      const invalid = await fetch(url, { headers: { Range: 'items=0-1' } });
      expect(invalid.status).toBe(416);
    } finally {
      await server.close();
    }
  });

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
        readScene: async () => '{"elements":[]}',
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
      expect(response.headers.get('x-attachment-editable')).toBe('true');
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
        readScene: async () => undefined,
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

  it('readScene을 제공하는 저장소에서 인증된 장면 요청에 JSON을 반환한다', async () => {
    const scene = '{"type":"image"}';
    const { server, token } = await startAttachmentTestServer({
      readScene: async () => scene,
    });

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/00000000-0000-4000-8000-000000000008.json?token=${encodeURIComponent(token)}`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
      expect(await response.text()).toBe(scene);
    } finally {
      await server.close();
    }
  });

  it('readScene에서 장면을 찾지 못하면 JSON 요청에 404를 반환한다', async () => {
    const { server, token } = await startAttachmentTestServer({ readScene: async () => undefined });

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/00000000-0000-4000-8000-000000000008.json?token=${encodeURIComponent(token)}`,
      );

      expect(response.status).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('인증된 GIF URL에서 GIF MIME 형식과 원본 바이트를 반환한다', async () => {
    const image = Buffer.from('gif-data');
    const { server, token } = await startAttachmentTestServer({
      read: async () => ({ image, extension: 'gif', mimeType: 'image/gif' }),
    });

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/00000000-0000-4000-8000-000000000009.gif?token=${encodeURIComponent(token)}`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/gif');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(image);
    } finally {
      await server.close();
    }
  });

  it('SVG 첨부 응답은 스크립트 실행을 제한하는 보안 헤더를 포함한다', async () => {
    const { server, token } = await startAttachmentTestServer({
      read: async () => ({
        image: Buffer.from('<svg></svg>'),
        extension: 'svg',
        mimeType: 'image/svg+xml',
      }),
    });

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/00000000-0000-4000-8000-000000000009.svg?token=${encodeURIComponent(token)}`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-security-policy')).toBe(
        "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      );
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    } finally {
      await server.close();
    }
  });

  it('저장소가 MIME 형식을 주지 않으면 비PNG 이미지에 기본 MIME 형식을 사용한다', async () => {
    const image = Buffer.from('legacy-image');
    const { server, token } = await startAttachmentTestServer({
      read: async () => ({ image }),
    });

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/00000000-0000-4000-8000-000000000009.gif?token=${encodeURIComponent(token)}`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('application/octet-stream');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(image);
    } finally {
      await server.close();
    }
  });

  it('잘못된 편집 장면 JSON은 편집 불가로 표시한다', async () => {
    const { server, token } = await startAttachmentTestServer({ readScene: async () => '{' });

    try {
      const response = await fetch(
        `${server.url}/_complex-prompt/attachments/00000000-0000-4000-8000-000000000008.json?token=${encodeURIComponent(token)}`,
        { method: 'HEAD' },
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('x-attachment-editable')).toBe('false');
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
        throw new AttachmentTooLargeError('PNG attachment exceeds the 25 MB limit.');
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
});
