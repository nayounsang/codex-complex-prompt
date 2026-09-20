import { describe, expect, it } from 'vitest';

import { SessionStore } from './session-store.js';

describe('session store', () => {
  it('인증한 session token의 재사용을 거부한다', () => {
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

  it('TTL이 지나면 session token을 만료 처리한다', () => {
    let currentTime = new Date('2026-09-20T00:00:00.000Z');
    const store = new SessionStore({
      ttlMs: 1_000,
      now: () => currentTime,
    });
    const expiringSession = store.create();

    currentTime = new Date('2026-09-20T00:00:01.000Z');
    expect(store.authenticate(expiringSession.token)).toBeUndefined();
  });

  it('revoke한 session token을 인증할 수 없다', () => {
    const store = new SessionStore();
    const session = store.create();

    store.revoke(session.token);

    expect(store.authenticate(session.token)).toBeUndefined();
  });

  it('유효하지 않은 TTL 설정을 거부한다', () => {
    expect(() => new SessionStore({ ttlMs: 0 })).toThrow('positive integer');
  });
});
