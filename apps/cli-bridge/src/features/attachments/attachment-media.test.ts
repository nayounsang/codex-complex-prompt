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

  it('rejects invalid image URLs, empty data, and content with a mismatched MIME type', async () => {
    await expect(decodeImage('not-an-image', false)).rejects.toThrow(
      'The attachment must be an encoded image.',
    );
    await expect(decodeImage('data:image/png;base64,', false)).rejects.toThrow(
      'The image content is invalid or its MIME type does not match.',
    );
    await expect(decodeImage(`data:image/jpeg;base64,${PNG_DATA}`, false)).rejects.toThrow(
      'The image content is invalid or its MIME type does not match.',
    );
  });

  it('keeps the legacy PNG validation messages for drawing uploads', async () => {
    await expect(decodeImage('not-an-image', true)).rejects.toThrow(
      'The drawing must be saved as a PNG image.',
    );
    await expect(decodeImage('data:image/png;base64,SGVsbG8=', true)).rejects.toThrow(
      'The drawing PNG is invalid.',
    );
  });

  it('decodes video data and rejects invalid or mismatched video payloads', async () => {
    await expect(decodeVideo(`data:video/mp4;base64,${MP4_DATA}`)).resolves.toMatchObject({
      extension: 'mp4',
      mimeType: 'video/mp4',
      data: Buffer.from(MP4_DATA, 'base64'),
    });
    await expect(decodeVideo('not-a-video')).rejects.toThrow(
      'The attachment must be an encoded video.',
    );
    await expect(decodeVideo('data:video/mp4;base64,')).rejects.toThrow(
      'The video content is invalid or its MIME type does not match.',
    );
    await expect(decodeVideo(`data:video/webm;base64,${MP4_DATA}`)).rejects.toThrow(
      'The video content is invalid or its MIME type does not match.',
    );
  });
});

describe('attachment media identification', () => {
  it('identifies image and video signatures and ignores unsupported bytes', async () => {
    await expect(identifyImageBuffer(Buffer.from(PNG_DATA, 'base64'))).resolves.toEqual({
      extension: 'png',
      mimeType: 'image/png',
    });
    await expect(identifyVideoBuffer(Buffer.from(MP4_DATA, 'base64'))).resolves.toEqual({
      ext: 'mp4',
      mime: 'video/mp4',
    });
    await expect(identifyImageBuffer(Buffer.from('plain text'))).resolves.toBeUndefined();
    await expect(identifyVideoBuffer(Buffer.from('plain text'))).resolves.toBeUndefined();
  });

  it('accepts only safe image and supported video extensions for the matching attachment', () => {
    expect(isSafeImageExtension('png')).toBe(true);
    expect(isSafeImageExtension('../png')).toBe(false);
    expect(isSafeImageExtension('txt')).toBe(false);
    expect(isSafeVideoExtension('mp4')).toBe(true);
    expect(isSafeVideoExtension('webm')).toBe(true);
    expect(isSafeVideoExtension('mkv')).toBe(false);
    expect(isImageFileForId(`${ID}.png`, ID)).toBe(true);
    expect(isImageFileForId(`${ID}.txt`, ID)).toBe(false);
    expect(isImageFileForId('other.png', ID)).toBe(false);
    expect(isMediaFileForId(`${ID}.webm`, ID)).toBe(true);
    expect(isMediaFileForId(`${ID}.json`, ID)).toBe(false);
  });

  it('recognizes only ENOENT filesystem errors as missing files', () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const denied = Object.assign(new Error('denied'), { code: 'EACCES' });

    expect(isMissingFile(missing)).toBe(true);
    expect(isMissingFile(denied)).toBe(false);
    expect(isMissingFile('ENOENT')).toBe(false);
  });
});

describe('WebM EBML header length', () => {
  const magic = [0x1a, 0x45, 0xdf, 0xa3];

  it('rejects missing, truncated, invalid, and unknown-size headers', () => {
    expect(getEbmlHeaderLength(Buffer.from([0x01, 0x02, 0x03, 0x04, 0x80]), 100)).toBeUndefined();
    expect(getEbmlHeaderLength(Buffer.from(magic), 100)).toBeUndefined();
    expect(getEbmlHeaderLength(Buffer.from([...magic, 0x00]), 100)).toBeUndefined();
    expect(getEbmlHeaderLength(Buffer.from([...magic, 0x40]), 100)).toBeUndefined();
    expect(getEbmlHeaderLength(Buffer.from([...magic, 0xff]), 100)).toBeUndefined();
  });

  it('returns a valid declared size and rejects sizes beyond the file or safe integer range', () => {
    expect(getEbmlHeaderLength(Buffer.from([...magic, 0x82, 0xaa, 0xbb]), 7)).toBe(7);
    expect(getEbmlHeaderLength(Buffer.from([...magic, 0x82, 0xaa, 0xbb]), 6)).toBeUndefined();
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
