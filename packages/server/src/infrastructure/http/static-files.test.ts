import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { resolveStaticPath, startLocalBridgeServer } from '../../index.js';
import { closeTestSockets, getHttp, trackSocket } from '../../test-support/server.js';

afterEach(closeTestSockets);

describe('정적 파일과 HTTP 연결', () => {
  it('정적 경로가 루트 밖을 가리키면 경로를 반환하지 않는다', () => {
    expect(resolveStaticPath('/tmp/codex-static', '/../../secret')).toBeUndefined();
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
});
