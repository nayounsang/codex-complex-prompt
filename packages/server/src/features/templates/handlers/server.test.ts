import { randomUUID } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { startLocalBridgeServer } from '../../../index.js';
import { authenticate, closeTestSockets, nextMessage } from '../../../test-support/server.js';

afterEach(closeTestSockets);

describe('서버 템플릿 요청', () => {
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
});
