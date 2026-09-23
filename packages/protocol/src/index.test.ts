import { describe, expect, it } from 'vitest';

import {
  ClientMessageSchema,
  countPromptCharacters,
  MAX_PROMPT_LENGTH,
  ServerMessageSchema,
  encodeServerMessage,
  parseClientMessage,
  truncatePromptCharacters,
  type ServerMessage,
} from './index.js';

describe('프롬프트 길이 유틸리티', () => {
  it('지정한 Unicode code point 길이까지만 문자열을 반환한다', () => {
    const result = truncatePromptCharacters('😀a한', 2);

    expect(result).toBe('😀a');
  });
});

describe('프로토콜 스키마', () => {
  it('유효한 프롬프트 제출 메시지를 수락한다', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'prompt.submit',
      submissionId: '00000000-0000-4000-8000-000000000001',
      prompt: 'Make this prompt clearer',
    });

    expect(result.success).toBe(true);
  });

  it('feedback 모드 제출 메시지의 선택적 모드를 수락한다', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'prompt.submit',
      submissionId: '00000000-0000-4000-8000-000000000001',
      prompt: '## AI Feedback',
      mode: 'feedback',
    });

    expect(result.success).toBe(true);
  });

  it('빈 Markdown을 제출해 feedback review를 종료하는 finish 모드를 수락한다', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'prompt.submit',
      submissionId: '00000000-0000-4000-8000-000000000001',
      prompt: '',
      mode: 'finish',
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

  it('Codex CLI와 같은 Unicode code point를 기준으로 길이를 계산한다', () => {
    const prompt = '😀'.repeat(MAX_PROMPT_LENGTH);
    const result = ClientMessageSchema.safeParse({
      type: 'prompt.submit',
      submissionId: '00000000-0000-4000-8000-000000000001',
      prompt,
    });

    expect(countPromptCharacters(prompt)).toBe(MAX_PROMPT_LENGTH);
    expect(result.success).toBe(true);
  });

  it('Unicode code point가 하나 초과하면 프롬프트를 거부한다', () => {
    const result = ClientMessageSchema.safeParse({
      type: 'prompt.submit',
      submissionId: '00000000-0000-4000-8000-000000000001',
      prompt: '😀'.repeat(MAX_PROMPT_LENGTH + 1),
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

  it('인증된 서버 준비 메시지의 초기 Markdown과 feedback 상태를 검증한다', () => {
    expect(
      ServerMessageSchema.safeParse({
        type: 'session.ready',
        sessionId: '00000000-0000-4000-8000-000000000002',
        expiresAt: '2026-09-20T00:00:00.000Z',
        initialMarkdown: '# Initial document',
        feedbackLoop: true,
      }).success,
    ).toBe(true);
  });

  it('feedback 결과의 최신 Markdown을 검증한다', () => {
    const result = ServerMessageSchema.safeParse({
      type: 'prompt.result',
      submissionId: '00000000-0000-4000-8000-000000000002',
      status: 'accepted',
      prompt: '# Updated',
    });

    expect(result.success).toBe(true);
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
