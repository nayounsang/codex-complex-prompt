import {
  AttachmentTooLargeError,
  AttachmentValidationError,
  MAX_ATTACHMENT_IMAGE_BYTES,
  MAX_ATTACHMENT_VIDEO_BYTES,
} from '@codex-complex-prompt/protocol';
import { detectXml } from '@file-type/xml';
import { FileTypeParser } from 'file-type';
import mime from 'mime';

export async function decodeImage(
  value: string,
  legacyPngInput: boolean,
): Promise<{
  readonly data: Buffer;
  readonly extension: string;
  readonly mimeType: string;
}> {
  if (value.length > Math.ceil((MAX_ATTACHMENT_IMAGE_BYTES + 2) / 3) * 4 + 128) {
    throw new AttachmentTooLargeError(
      legacyPngInput ? undefined : 'Image attachments must be 25 MB or smaller.',
    );
  }
  const match = value.match(/^data:(image\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/);
  if (match === null) {
    throw new AttachmentValidationError(
      legacyPngInput
        ? 'The drawing must be saved as a PNG image.'
        : 'The attachment must be an encoded image.',
    );
  }
  const buffer = Buffer.from(match[2] ?? '', 'base64');
  if (buffer.byteLength > MAX_ATTACHMENT_IMAGE_BYTES) {
    throw new AttachmentTooLargeError(
      legacyPngInput ? undefined : 'Image attachments must be 25 MB or smaller.',
    );
  }
  const parsed = await identifyImageBuffer(buffer);
  if (buffer.byteLength === 0 || parsed === undefined || parsed.mimeType !== match[1]) {
    throw new AttachmentValidationError(
      legacyPngInput
        ? 'The drawing PNG is invalid.'
        : 'The image content is invalid or its MIME type does not match.',
    );
  }
  return { data: buffer, ...parsed };
}

export async function decodeVideo(
  value: string,
): Promise<{ data: Buffer; extension: string; mimeType: string }> {
  if (value.length > Math.ceil((MAX_ATTACHMENT_VIDEO_BYTES + 2) / 3) * 4 + 128) {
    throw new AttachmentTooLargeError('Video attachments must be 25 MB or smaller.');
  }
  const match = value.match(/^data:(video\/[A-Za-z0-9.+-]+);base64,([A-Za-z0-9+/]*={0,2})$/);
  if (match === null) {
    throw new AttachmentValidationError('The attachment must be an encoded video.');
  }
  const buffer = Buffer.from(match[2] ?? '', 'base64');
  if (buffer.byteLength > MAX_ATTACHMENT_VIDEO_BYTES) {
    throw new AttachmentTooLargeError('Video attachments must be 25 MB or smaller.');
  }
  const parsed = await identifyVideoBuffer(buffer);
  if (buffer.byteLength === 0 || parsed === undefined || parsed.mime !== match[1]) {
    throw new AttachmentValidationError(
      'The video content is invalid or its MIME type does not match.',
    );
  }
  return { data: buffer, extension: parsed.ext, mimeType: parsed.mime };
}

export async function identifyVideoBuffer(
  buffer: Buffer,
): Promise<{ ext: string; mime: string } | undefined> {
  const parser = new FileTypeParser();
  const detected = await parser.fromBuffer(buffer);
  if (detected === undefined || !detected.mime.startsWith('video/')) return undefined;
  return { ext: detected.ext, mime: detected.mime };
}

export function getEbmlHeaderLength(prefix: Buffer, fileSize: number): number | undefined {
  if (
    prefix.byteLength < 5 ||
    !prefix.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  ) {
    return undefined;
  }

  const firstSizeByte = prefix[4];
  if (firstSizeByte === undefined) return undefined;
  let sizeLength = 1;
  let marker = 0x80;
  while (sizeLength <= 8 && (firstSizeByte & marker) === 0) {
    marker >>= 1;
    sizeLength += 1;
  }
  if (sizeLength > 8 || prefix.byteLength < 4 + sizeLength) return undefined;

  let payloadSize = BigInt(firstSizeByte & (marker - 1));
  for (let index = 1; index < sizeLength; index += 1) {
    const byte = prefix[4 + index];
    if (byte === undefined) return undefined;
    payloadSize = (payloadSize << 8n) | BigInt(byte);
  }
  if (payloadSize === (1n << BigInt(sizeLength * 7)) - 1n) return undefined;

  const headerLength = 4n + BigInt(sizeLength) + payloadSize;
  if (headerLength > BigInt(fileSize) || headerLength > BigInt(Number.MAX_SAFE_INTEGER)) {
    return undefined;
  }
  return Number(headerLength);
}

export async function identifyImageBuffer(
  buffer: Buffer,
): Promise<{ readonly extension: string; readonly mimeType: string } | undefined> {
  const parser = new FileTypeParser({ customDetectors: [detectXml] });
  const detected = await parser.fromBuffer(buffer);
  if (detected === undefined || !detected.mime.startsWith('image/')) return undefined;
  return { extension: detected.ext, mimeType: detected.mime };
}

export function isSafeImageExtension(value: string): boolean {
  return /^[a-z0-9]+$/.test(value) && mime.getType(value)?.startsWith('image/') === true;
}

export function isImageFileForId(entry: string, id: string): boolean {
  if (!entry.startsWith(`${id}.`)) return false;
  const extension = entry.slice(id.length + 1);
  return isSafeImageExtension(extension);
}

export function isSafeVideoExtension(value: string): boolean {
  return (
    ['mp4', 'mov', 'webm'].includes(value) && mime.getType(value)?.startsWith('video/') === true
  );
}

export function isMediaFileForId(entry: string, id: string): boolean {
  if (!entry.startsWith(`${id}.`)) return false;
  const extension = entry.slice(id.length + 1);
  return isImageFileForId(entry, id) || isSafeVideoExtension(extension);
}

export function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
