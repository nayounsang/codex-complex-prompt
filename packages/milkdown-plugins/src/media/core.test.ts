import { describe, expect, it } from 'vitest';

import { getMediaMimeType, isSupportedVideoMimeType } from './core.js';

describe('getMediaMimeType', () => {
  it.each([
    ['relative/PHOTO.PNG?download=1#preview', 'image/png'],
    ['/clips/movie.MP4#t=4', 'video/mp4'],
    ['https://example.test/clip.mov?token=secret', 'video/quicktime'],
    ['https://example.test/clip.webm#preview', 'video/webm'],
    ['https://example.test/file.unknown', null],
    ['not a URL%xx', null],
  ])('resolves %s to %s', (path, expected) => {
    expect(getMediaMimeType(path)).toBe(expected);
  });
});

describe('isSupportedVideoMimeType', () => {
  it.each([
    ['video/mp4', true],
    ['video/quicktime', true],
    ['video/webm', true],
    ['video/x-msvideo', false],
    [null, false],
  ] as const)('classifies %s as supported: %s', (mimeType, expected) => {
    expect(isSupportedVideoMimeType(mimeType)).toBe(expected);
  });
});
