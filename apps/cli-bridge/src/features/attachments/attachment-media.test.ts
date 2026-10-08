import { describe, expect, it } from 'vitest';

import {
  decodeImage,
  decodeVideo,
  getEbmlHeaderLength,
  identifyImageBuffer,
  identifyVideoBuffer,
  isImageFileForId,
  isMediaFileForId,
  isMissingFile,
  isSafeImageExtension,
  isSafeVideoExtension,
} from './attachment-media.js';

const PNG_DATA =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const MP4_DATA = 'AAAAGGZ0eXBpc29tAAACAGlzb21pc28y';
const ID = '00000000-0000-4000-8000-000000000043';

describe('attachment media decoding', () => {
  it('decodes image data and returns its detected type', async () => {
    await expect(decodeImage(`data:image/png;base64,${PNG_DATA}`, false)).resolves.toMatchObject({
      extension: 'png',
      mimeType: 'image/png',
      data: Buffer.from(PNG_DATA, 'base64'),
    });
  });

  it('rejects a value that is not an encoded image', async () => {
    await expect(decodeImage('not-an-image', false)).rejects.toThrow(
      'The attachment must be an encoded image.',
    );
  });

  it('rejects empty image data', async () => {
    await expect(decodeImage('data:image/png;base64,', false)).rejects.toThrow(
      'The image content is invalid or its MIME type does not match.',
    );
  });

  it('rejects image data when its detected MIME type differs from the URL', async () => {
    await expect(decodeImage(`data:image/jpeg;base64,${PNG_DATA}`, false)).rejects.toThrow(
      'The image content is invalid or its MIME type does not match.',
    );
  });

  it('keeps the legacy URL validation message for drawing uploads', async () => {
    await expect(decodeImage('not-an-image', true)).rejects.toThrow(
      'The drawing must be saved as a PNG image.',
    );
  });

  it('keeps the legacy content validation message for drawing uploads', async () => {
    await expect(decodeImage('data:image/png;base64,SGVsbG8=', true)).rejects.toThrow(
      'The drawing PNG is invalid.',
    );
  });

  it('decodes video data and returns its detected type', async () => {
    await expect(decodeVideo(`data:video/mp4;base64,${MP4_DATA}`)).resolves.toMatchObject({
      extension: 'mp4',
      mimeType: 'video/mp4',
      data: Buffer.from(MP4_DATA, 'base64'),
    });
  });

  it('rejects a value that is not an encoded video', async () => {
    await expect(decodeVideo('not-a-video')).rejects.toThrow(
      'The attachment must be an encoded video.',
    );
  });

  it('rejects empty video data', async () => {
    await expect(decodeVideo('data:video/mp4;base64,')).rejects.toThrow(
      'The video content is invalid or its MIME type does not match.',
    );
  });

  it('rejects video data when its detected MIME type differs from the URL', async () => {
    await expect(decodeVideo(`data:video/webm;base64,${MP4_DATA}`)).rejects.toThrow(
      'The video content is invalid or its MIME type does not match.',
    );
  });
});

describe('attachment media identification', () => {
  it('identifies an image from its file signature', async () => {
    await expect(identifyImageBuffer(Buffer.from(PNG_DATA, 'base64'))).resolves.toEqual({
      extension: 'png',
      mimeType: 'image/png',
    });
  });

  it('identifies a video from its file signature', async () => {
    await expect(identifyVideoBuffer(Buffer.from(MP4_DATA, 'base64'))).resolves.toEqual({
      ext: 'mp4',
      mime: 'video/mp4',
    });
  });

  it('ignores bytes that do not match an image signature', async () => {
    await expect(identifyImageBuffer(Buffer.from('plain text'))).resolves.toBeUndefined();
  });

  it('ignores bytes that do not match a video signature', async () => {
    await expect(identifyVideoBuffer(Buffer.from('plain text'))).resolves.toBeUndefined();
  });

  it('accepts only safe image extensions', () => {
    expect(isSafeImageExtension('png')).toBe(true);
    expect(isSafeImageExtension('../png')).toBe(false);
    expect(isSafeImageExtension('txt')).toBe(false);
  });

  it('accepts only supported video extensions', () => {
    expect(isSafeVideoExtension('mp4')).toBe(true);
    expect(isSafeVideoExtension('webm')).toBe(true);
    expect(isSafeVideoExtension('mkv')).toBe(false);
  });

  it('matches image files to their attachment identifier', () => {
    expect(isImageFileForId(`${ID}.png`, ID)).toBe(true);
    expect(isImageFileForId(`${ID}.txt`, ID)).toBe(false);
    expect(isImageFileForId('other.png', ID)).toBe(false);
  });

  it('matches supported media files to their attachment identifier', () => {
    expect(isMediaFileForId(`${ID}.webm`, ID)).toBe(true);
    expect(isMediaFileForId(`${ID}.json`, ID)).toBe(false);
  });

  it('recognizes ENOENT filesystem errors as missing files', () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });

    expect(isMissingFile(missing)).toBe(true);
  });

  it.each([
    ['permission errors', Object.assign(new Error('denied'), { code: 'EACCES' })],
    ['string values', 'ENOENT'],
  ])('does not treat %s as a missing file', (_label, error) => {
    expect(isMissingFile(error)).toBe(false);
  });
});

describe('WebM EBML header length', () => {
  const magic = [0x1a, 0x45, 0xdf, 0xa3];

  it.each([
    ['a missing EBML signature', Buffer.from([0x01, 0x02, 0x03, 0x04, 0x80])],
    ['a truncated signature', Buffer.from(magic)],
    ['a truncated size field', Buffer.from([...magic, 0x00])],
    ['an invalid size marker', Buffer.from([...magic, 0x40])],
    ['an unknown-size header', Buffer.from([...magic, 0xff])],
  ])('rejects %s', (_label, prefix) => {
    expect(getEbmlHeaderLength(prefix, 100)).toBeUndefined();
  });

  it('returns the total length of a valid declared header', () => {
    expect(getEbmlHeaderLength(Buffer.from([...magic, 0x82, 0xaa, 0xbb]), 7)).toBe(7);
  });

  it('rejects a declared header length beyond the file size', () => {
    expect(getEbmlHeaderLength(Buffer.from([...magic, 0x82, 0xaa, 0xbb]), 6)).toBeUndefined();
  });

  it('rejects a declared header length beyond the safe integer range', () => {
    const largeEightByteSize = Buffer.from([
      ...magic,
      0x01,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
      0xff,
    ]);
    expect(getEbmlHeaderLength(largeEightByteSize, Number.MAX_SAFE_INTEGER)).toBeUndefined();
  });
});
