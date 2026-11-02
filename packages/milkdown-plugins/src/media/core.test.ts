import { afterEach, describe, expect, it, vi } from 'vitest';

import { getMediaMimeType, isSupportedVideoMimeType, resolveMediaMimeType } from './core.js';

afterEach(() => vi.unstubAllGlobals());

describe('getMediaMimeType', () => {
  it.each([
    ['data:image/png;base64,AA==', 'image/png'],
    ['data:video/mp4;base64,AA==', 'video/mp4'],
    ['data:image/svg+xml;charset=utf-8,', 'image/svg+xml'],
    ['https://example.test/clip.mov?token=secret', null],
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

describe('resolveMediaMimeType', () => {
  it.each([
    ['https://example.test/photo', 'image/png; charset=binary', 'image/png'],
    ['https://example.test/clip', 'video/webm', 'video/webm'],
  ])('reads MIME from the HEAD response for %s', async (path, contentType, expected) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { status: 200, headers: { 'Content-Type': contentType } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveMediaMimeType(path)).resolves.toBe(expected);
    expect(fetchMock).toHaveBeenCalledWith(path, { method: 'HEAD' });
  });

  it('reads a data URL MIME without making a request', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveMediaMimeType('data:image/png;base64,AA==')).resolves.toBe('image/png');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects failed HEAD responses and responses without Content-Type', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 405 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(resolveMediaMimeType('https://example.test/no-head')).rejects.toThrow('HTTP 405');
    await expect(resolveMediaMimeType('https://example.test/no-type')).rejects.toThrow(
      'did not provide a Content-Type header',
    );
  });
});
