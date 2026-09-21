import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import {
  CodexSessionInputAdapter,
  MockCodexSessionInputAdapter,
} from './adapters/codex-session-input.js';
import { startCliBridge } from './index.js';

vi.mock('open', () => ({ default: () => Promise.resolve() }));

describe('CLI 브리지 동작', () => {
  it('브라우저를 열지 않고 세션 토큰이 포함된 URL을 생성한다', async () => {
    const adapter = new MockCodexSessionInputAdapter();
    const bridge = await startCliBridge({
      inputAdapter: adapter,
    });

    expect(new URL(bridge.browserUrl).searchParams.get('token')).toHaveLength(43);
    expect(new URL(bridge.browserUrl).searchParams.get('bridge')).toBe(bridge.server.url);
    expect(bridge.browserOpened).toBe(true);
    await bridge.stop();
  });

  it('브라우저 연동 실패를 브리지 실패로 처리하지 않는다', async () => {
    const bridge = await startCliBridge({
      openBrowser: async () => {
        throw new Error('browser unavailable');
      },
    });

    expect(bridge.browserOpened).toBe(false);
    await bridge.stop();
  });

  it('별도 루프백 웹 URL에 브리지 오리진을 전달한다', async () => {
    const bridge = await startCliBridge({
      webUrl: 'http://127.0.0.1:5173',
      openBrowser: () => Promise.resolve(),
    });

    const browserUrl = new URL(bridge.browserUrl);
    expect(browserUrl.origin).toBe('http://127.0.0.1:5173');
    expect(browserUrl.searchParams.get('bridge')).toBe(bridge.server.url);
    await bridge.stop();
  });

  it('루프백이 아닌 웹 URL로 세션 토큰을 보내지 않는다', async () => {
    await expect(
      startCliBridge({ webUrl: 'https://attacker.example', openBrowser: () => Promise.resolve() }),
    ).rejects.toThrow('loopback');
  });

  it('파싱할 수 없는 웹 URL을 거부한다', async () => {
    await expect(
      startCliBridge({ webUrl: 'not-a-url', openBrowser: () => Promise.resolve() }),
    ).rejects.toThrow('valid local HTTP(S) URL');
  });

  it('루프백이 아닌 프로토콜의 웹 URL을 거부한다', async () => {
    await expect(
      startCliBridge({ webUrl: 'ftp://127.0.0.1:5173', openBrowser: () => Promise.resolve() }),
    ).rejects.toThrow('loopback');
  });

  it('인증 정보가 포함된 웹 URL을 거부한다', async () => {
    await expect(
      startCliBridge({
        webUrl: 'http://user:password@127.0.0.1:5173',
        openBrowser: () => Promise.resolve(),
      }),
    ).rejects.toThrow('credentials');
  });

  it('기본 Codex 어댑터는 미지원 오류를 반환한다', async () => {
    await expect(new CodexSessionInputAdapter().submit('Prompt')).rejects.toThrow('not available');
  });

  it('모의 Codex 어댑터는 제출한 프롬프트를 저장한다', async () => {
    const adapter = new MockCodexSessionInputAdapter();

    await adapter.submit('Prompt');

    expect(adapter.prompts).toEqual(['Prompt']);
  });

  it('선택적 서버 설정을 브리지에 전달한다', async () => {
    const bridge = await startCliBridge({
      inputAdapter: new MockCodexSessionInputAdapter(),
      port: 0,
      sessionTtlMs: 1_000,
      promptTimeoutMs: 1_000,
      openBrowser: () => Promise.resolve(),
    });

    expect(bridge.server.port).toBeGreaterThan(0);
    await bridge.stop();
  });

  it('브라우저 프롬프트를 모의 Codex 어댑터에 전달한다', async () => {
    const adapter = new MockCodexSessionInputAdapter();
    const bridge = await startCliBridge({
      inputAdapter: adapter,
      openBrowser: () => Promise.resolve(),
    });
    const socket = new WebSocket(`${bridge.server.url}/ws`);
    const nextMessage = (): Promise<{ type: string; status?: string }> =>
      new Promise((resolve) =>
        socket.once('message', (data) =>
          resolve(JSON.parse(messageText(data)) as { type: string; status?: string }),
        ),
      );

    try {
      await new Promise<void>((resolve) => socket.once('open', () => resolve()));
      const token = new URL(bridge.browserUrl).searchParams.get('token');
      if (token === null) throw new Error('Session token was not generated.');
      socket.send(JSON.stringify({ type: 'session.handshake', token }));
      await nextMessage();
      socket.send(
        JSON.stringify({
          type: 'prompt.submit',
          submissionId: '00000000-0000-4000-8000-000000000006',
          prompt: 'Forward from browser',
        }),
      );

      await expect(nextMessage()).resolves.toMatchObject({
        type: 'prompt.result',
        status: 'accepted',
      });
      expect(adapter.prompts).toEqual(['Forward from browser']);
    } finally {
      socket.close();
      await bridge.stop();
    }
  });
});

function messageText(data: WebSocket.RawData): string {
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  return Buffer.from(data).toString();
}
