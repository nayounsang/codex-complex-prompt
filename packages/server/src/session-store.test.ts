import { describe, expect, it } from 'vitest';

import { SessionStore } from './session-store.js';

describe('세션 저장소', () => {
  it('인증한 세션 토큰의 재사용을 거부한다', () => {
    let currentTime = new Date('2026-09-20T00:00:00.000Z');
    const store = new SessionStore({
      ttlMs: 1_000,
      now: () => currentTime,
    });
    const session = store.create();

    expect(session.token).toHaveLength(43);
    expect(store.authenticate(session.token)?.id).toBe(session.id);
    expect(store.authenticate(session.token)).toBeUndefined();

    expect(store.authenticate(session.token)).toBeUndefined();
  });

  it('TTL이 지나면 세션 토큰을 만료 처리한다', () => {
    let currentTime = new Date('2026-09-20T00:00:00.000Z');
    const store = new SessionStore({
      ttlMs: 1_000,
      now: () => currentTime,
    });
    const expiringSession = store.create();

    currentTime = new Date('2026-09-20T00:00:01.000Z');
    expect(store.authenticate(expiringSession.token)).toBeUndefined();
  });

  it('취소한 세션 토큰을 인증할 수 없다', () => {
    const store = new SessionStore();
    const session = store.create();

    store.revoke(session.token);

    expect(store.authenticate(session.token)).toBeUndefined();
  });

  it('존재하지 않는 세션 ID 조회에 undefined를 반환한다', () => {
    const store = new SessionStore();

    expect(store.get('missing-session')).toBeUndefined();
  });

  it('유효하지 않은 TTL 설정을 거부한다', () => {
    expect(() => new SessionStore({ ttlMs: 0 })).toThrow('positive integer');
  });
});
