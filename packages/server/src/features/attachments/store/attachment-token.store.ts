import { AttachmentTokenEntity } from './entities/attachment-token.entity.js';

export class AttachmentTokenStore {
  private readonly tokens = new Map<string, AttachmentTokenEntity>();

  public set(sessionId: string, token: string): void {
    this.tokens.set(sessionId, new AttachmentTokenEntity(sessionId, token));
  }

  public get(sessionId: string): string | undefined {
    return this.tokens.get(sessionId)?.token;
  }

  public *entries(): IterableIterator<[string, string]> {
    for (const { sessionId, token } of this.tokens.values()) {
      yield [sessionId, token];
    }
  }

  public delete(sessionId: string): boolean {
    return this.tokens.delete(sessionId);
  }
}
