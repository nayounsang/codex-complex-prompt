export class AttachmentTokenEntity {
  public constructor(
    public readonly sessionId: string,
    public readonly token: string,
  ) {}
}
