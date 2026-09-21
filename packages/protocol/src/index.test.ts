import { describe, expect, it } from 'vitest';

import {
  ClientMessageSchema,
  ServerMessageSchema,
  encodeServerMessage,
  parseClientMessage,
  type ServerMessage,
} from './index.js';

describe('프로토콜 스키마', () => {
  it('유효한 프롬프트 제출 메시지를 수락한다', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'prompt.submit',
      submissionId: '00000000-0000-4000-8000-000000000001',
      prompt: 'Make this prompt clearer',
    });

    expect(result.success).toBe(true);
  });

  it('잘못된 제출 ID를 거부한다', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'prompt.submit',
      submissionId: 'not-a-uuid',
      prompt: 'Make this prompt clearer',
    });

    expect(result.success).toBe(false);
  });

  it('빈 프롬프트를 거부한다', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'prompt.submit',
      submissionId: '00000000-0000-4000-8000-000000000001',
      prompt: ' ',
    });

    expect(result.success).toBe(false);
  });

  it('12,000자를 초과한 프롬프트를 거부한다', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'prompt.submit',
      submissionId: '00000000-0000-4000-8000-000000000001',
      prompt: 'p'.repeat(12_001),
    });

    expect(result.success).toBe(false);
  });

  it('유효한 클라이언트 메시지를 파싱해 반환한다', () => {
    const message = parseClientMessage({
      type: 'session.handshake',
      token: 'a'.repeat(32),
    });

    expect(message).toEqual({ type: 'session.handshake', token: 'a'.repeat(32) });
  });

  it('유효한 서버 준비 메시지를 검증한다', () => {
    expect(
      ServerMessageSchema.safeParse({
        type: 'session.ready',
        sessionId: '00000000-0000-4000-8000-000000000002',
        expiresAt: '2026-09-20T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('유효한 서버 메시지를 JSON으로 인코딩한다', () => {
    const message: ServerMessage = {
      type: 'session.ready',
      sessionId: '00000000-0000-4000-8000-000000000002',
      expiresAt: '2026-09-20T00:00:00.000Z',
    };

    expect(encodeServerMessage(message)).toBe(JSON.stringify(message));
  });

  it('유효하지 않은 서버 메시지 인코딩을 거부한다', () => {
    expect(() => encodeServerMessage({ type: 'session.ready', sessionId: 'invalid' })).toThrow();
  });
});
