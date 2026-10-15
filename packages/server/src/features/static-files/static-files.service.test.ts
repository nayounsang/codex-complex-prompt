import { get } from 'node:http';
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { resolveStaticPath, startLocalBridgeServer } from '../../index.js';
import { closeTestSockets, getHttp, trackSocket } from '../../test-support/server.js';

afterEach(closeTestSockets);

interface StaticTestServer {
  readonly url: string;
  readonly close: () => Promise<void>;
}

async function startStaticTestServer(staticDir?: string): Promise<StaticTestServer> {
  return startLocalBridgeServer({
    ...(staticDir === undefined ? {} : { staticDir }),
    onPrompt: async () => undefined,
  });
}

describe('정적 경로 해석', () => {
  it('정적 경로가 루트 밖을 가리키면 경로를 반환하지 않는다', () => {
    expect(resolveStaticPath('/tmp/codex-static', '/../../secret')).toBeUndefined();
  });
});

describe('공개 정적 파일 HTTP 계약', () => {
  it('정적 디렉터리의 색인 문서를 제공한다', async () => {
    const staticDir = await mkdtemp(join(tmpdir(), 'codex-complex-prompt-'));
    await writeFile(join(staticDir, 'index.html'), '<h1>bridge</h1>');
    const server = await startStaticTestServer(`${staticDir}/`);

    try {
      const response = await getHttp(`${server.url}/`);

      expect(response).toEqual({ statusCode: 200, body: '<h1>bridge</h1>' });
    } finally {
      await server.close();
      await rm(staticDir, { recursive: true, force: true });
    }
  });

  it('정적 파일 확장자에 맞는 MIME 형식을 제공한다', async () => {
    const staticDir = await mkdtemp(join(tmpdir(), 'codex-complex-prompt-mime-'));
    const fixtures = [
      ['style.css', 'text/css; charset=utf-8'],
      ['index.html', 'text/html; charset=utf-8'],
      ['app.js', 'text/javascript; charset=utf-8'],
      ['data.json', 'application/json; charset=utf-8'],
      ['icon.svg', 'image/svg+xml'],
      ['asset.bin', 'application/octet-stream'],
    ] as const;
    await Promise.all(fixtures.map(([file]) => writeFile(join(staticDir, file), 'content')));
    const server = await startStaticTestServer(staticDir);

    try {
      for (const [file, mimeType] of fixtures) {
        const response = await fetch(`${server.url}/${file}`);

        expect({ file, status: response.status }).toEqual({ file, status: 200 });
        expect({ file, contentType: response.headers.get('content-type') }).toEqual({
          file,
          contentType: mimeType,
        });
        await response.arrayBuffer();
      }
    } finally {
      await server.close();
      await rm(staticDir, { recursive: true, force: true });
    }
  });

  it('정적 디렉터리 안의 심볼릭 링크로 외부 파일을 제공하지 않는다', async () => {
    const staticDir = await mkdtemp(join(tmpdir(), 'codex-complex-prompt-static-'));
    const outsideDir = await mkdtemp(join(tmpdir(), 'codex-complex-prompt-outside-'));
    await writeFile(join(outsideDir, 'secret.txt'), 'private content');
    await symlink(join(outsideDir, 'secret.txt'), join(staticDir, 'secret.txt'));
    const server = await startStaticTestServer(staticDir);

    try {
      const response = await getHttp(`${server.url}/secret.txt`);

      expect(response).toEqual({ statusCode: 404, body: 'Not found' });
    } finally {
      await server.close();
      await Promise.all([
        rm(staticDir, { recursive: true, force: true }),
        rm(outsideDir, { recursive: true, force: true }),
      ]);
    }
  });

  it('일반 파일이 아닌 정적 경로를 제공하지 않는다', async () => {
    const staticDir = await mkdtemp(join(tmpdir(), 'codex-complex-prompt-directory-'));
    await mkdir(join(staticDir, 'assets'));
    const server = await startStaticTestServer(staticDir);

    try {
      const response = await getHttp(`${server.url}/assets`);

      expect(response).toEqual({ statusCode: 404, body: 'Not found' });
    } finally {
      await server.close();
      await rm(staticDir, { recursive: true, force: true });
    }
  });

  it('정적 디렉터리가 없으면 브리지 상태를 HTTP로 반환한다', async () => {
    const server = await startStaticTestServer();

    try {
      const response = await fetch(server.url);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
      expect(await response.text()).toBe('Codex Complex Prompt bridge is running.');
    } finally {
      await server.close();
    }
  });

  it('정적 디렉터리에 없는 문서 요청에 404를 반환한다', async () => {
    const staticDir = await mkdtemp(join(tmpdir(), 'codex-complex-prompt-'));
    const server = await startStaticTestServer(staticDir);

    try {
      const response = await getHttp(`${server.url}/missing.js`);

      expect(response).toEqual({ statusCode: 404, body: 'Not found' });
    } finally {
      await server.close();
      await rm(staticDir, { recursive: true, force: true });
    }
  });

  it('클라이언트 연결이 끝나면 정적 파일 스트림을 중단한다', async () => {
    const staticDir = await mkdtemp(join(tmpdir(), 'codex-complex-prompt-stream-'));
    const filePath = join(staticDir, 'large.bin');
    await writeFile(filePath, 'x');
    await truncate(filePath, 32 * 1024 * 1024);
    const server = await startStaticTestServer(staticDir);

    try {
      const statusCode = await new Promise<number | undefined>((resolve, reject) => {
        const request = get(`${server.url}/large.bin`, (response) => {
          response.once('data', () => {
            resolve(response.statusCode);
            response.destroy();
          });
          response.on('error', () => undefined);
        });
        request.on('error', reject);
      });

      expect(statusCode).toBe(200);
    } finally {
      await server.close();
      await rm(staticDir, { recursive: true, force: true });
    }
  });
});

describe('정적 파일과 WebSocket upgrade', () => {
  it('WebSocket이 아닌 경로의 upgrade 요청을 종료한다', async () => {
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
});
