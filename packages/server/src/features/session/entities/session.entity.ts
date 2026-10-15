export class SessionEntity {
  public constructor(
    public readonly id: string,
    public readonly token: string,
    public readonly expiresAt: Date,
    public connected = false,
  ) {}
}

export type SessionRecord = SessionEntity;
