import { randomBytes, randomUUID } from 'node:crypto';

export interface SessionRecord {
  readonly id: string;
  readonly token: string;
  readonly expiresAt: Date;
  connected: boolean;
}

export interface SessionStoreOptions {
  readonly ttlMs?: number;
  readonly now?: () => Date;
}

export class SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly ttlMs: number;
  private readonly now: () => Date;

  public constructor(options: SessionStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
    if (!Number.isInteger(this.ttlMs) || this.ttlMs <= 0) {
      throw new Error('Session TTL must be a positive integer.');
    }
  }

  public create(): SessionRecord {
    this.removeExpired();
    const session: SessionRecord = {
      id: randomUUID(),
      token: randomBytes(32).toString('base64url'),
      expiresAt: new Date(this.now().getTime() + this.ttlMs),
      connected: false,
    };
    this.sessions.set(session.token, session);
    return session;
  }

  public authenticate(token: string): SessionRecord | undefined {
    this.removeExpired();
    const session = this.sessions.get(token);
    if (session === undefined || session.connected) return undefined;
    session.connected = true;
    return session;
  }

  public revoke(token: string): void {
    this.sessions.delete(token);
  }

  public removeExpired(): void {
    const now = this.now().getTime();
    for (const [token, session] of this.sessions) {
      if (session.expiresAt.getTime() <= now) this.sessions.delete(token);
    }
  }
}
