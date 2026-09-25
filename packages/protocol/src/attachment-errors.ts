export class AttachmentTooLargeError extends Error {
  constructor(message = 'PNG attachments must be 25 MB or smaller.') {
    super(message);
    this.name = 'AttachmentTooLargeError';
  }
}

export class AttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AttachmentValidationError';
  }
}
