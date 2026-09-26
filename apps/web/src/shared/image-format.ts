// sax.parser() works in browsers; sax.createStream() relies on Node's built-in stream module.
import { detectXml } from '@file-type/xml';
import { FileTypeParser } from 'file-type';
import mime from 'mime';

export interface ImageFormat {
  readonly extension: string;
  readonly mimeType: string;
}

export async function identifyImageFormat(file: Blob, fileName = ''): Promise<ImageFormat> {
  const parser = new FileTypeParser({ customDetectors: [detectXml] });
  const detected = await parser.fromBlob(file);
  if (detected === undefined || !detected.mime.startsWith('image/')) {
    throw new Error('지원하는 이미지 형식을 확인할 수 없습니다.');
  }

  const namedExtension = fileName.split('.').pop()?.toLowerCase();
  const extension =
    namedExtension !== undefined && namedExtension !== fileName.toLowerCase() &&
    mime.getType(namedExtension) === detected.mime
      ? namedExtension
      : detected.ext;
  if (mime.getType(extension) !== detected.mime) {
    throw new Error('지원하는 이미지 형식을 확인할 수 없습니다.');
  }
  return { extension, mimeType: detected.mime };
}
