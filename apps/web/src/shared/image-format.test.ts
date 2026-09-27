import { describe, expect, it } from 'vitest';
import { identifyImageFormat } from './image-format.js';

const GIF_DATA = 'R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

describe('이미지 형식 판별', () => {
  it('GIF 바이트는 파일명이 PNG여도 원본 GIF 형식으로 판별한다', async () => {
    const file = createBlob(
      Uint8Array.from(atob(GIF_DATA), (character) => character.charCodeAt(0)),
      'image/png',
    );

    await expect(identifyImageFormat(file, 'image.png')).resolves.toEqual({
      extension: 'gif',
      mimeType: 'image/gif',
    });
  });

  it('파일명 확장자가 실제 GIF 형식과 맞으면 해당 확장자를 유지한다', async () => {
    const file = createBlob(
      Uint8Array.from(atob(GIF_DATA), (character) => character.charCodeAt(0)),
      'image/gif',
    );

    await expect(identifyImageFormat(file, 'animation.GIF')).resolves.toEqual({
      extension: 'gif',
      mimeType: 'image/gif',
    });
  });

  it('비이미지 PDF 파일은 이미지 형식으로 판별하지 않는다', async () => {
    const file = createBlob(new TextEncoder().encode('%PDF-1.4\n'), 'application/pdf');

    await expect(identifyImageFormat(file, 'document.pdf')).rejects.toThrow(
      '지원하는 이미지 형식을 확인할 수 없습니다.',
    );
  });

  it('형식을 식별할 수 없는 파일은 이미지로 판별하지 않는다', async () => {
    const file = createBlob(new TextEncoder().encode('plain text'), 'text/plain');

    await expect(identifyImageFormat(file, 'note.txt')).rejects.toThrow(
      '지원하는 이미지 형식을 확인할 수 없습니다.',
    );
  });
});

function createBlob(bytes: Uint8Array, type: string): Blob {
  return {
    size: bytes.byteLength,
    type,
    slice(start = 0, end = bytes.byteLength) {
      const slicedBytes = bytes.slice(start, end);
      return {
        arrayBuffer: async () =>
          slicedBytes.buffer.slice(
            slicedBytes.byteOffset,
            slicedBytes.byteOffset + slicedBytes.byteLength,
          ),
      };
    },
  } as unknown as Blob;
}
