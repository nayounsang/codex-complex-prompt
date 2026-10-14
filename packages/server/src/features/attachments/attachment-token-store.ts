export class AttachmentTokenStore {
  private readonly tokens = new Map<string, string>();

  public set(sessionId: string, token: string): void {
    this.tokens.set(sessionId, token);
  }

  public get(sessionId: string): string | undefined {
    return this.tokens.get(sessionId);
  }

  public entries(): IterableIterator<[string, string]> {
    return this.tokens.entries();
  }

  public delete(sessionId: string): boolean {
    return this.tokens.delete(sessionId);
  }
}
