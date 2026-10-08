import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { MAX_ATTACHMENT_VIDEO_BYTES } from '@codex-complex-prompt/protocol';
import mime from 'mime';
import {
  getEbmlHeaderLength,
  identifyVideoBuffer,
  isMissingFile,
  isSafeVideoExtension,
} from './attachment-media.js';
import { isAttachmentId } from './attachment-id.js';

interface ProjectVideoReader {
  readonly getVideoInfo: (
    id: string,
    extension: string,
  ) => Promise<{ readonly size: number; readonly mimeType: string } | undefined>;
  readonly readVideoRange: (
    id: string,
    extension: string,
    start: number,
    end: number,
    expectedSize: number,
  ) => Promise<Buffer | undefined>;
}

export function createProjectAttachmentVideoReader(directory: string): ProjectVideoReader {
  return {
    getVideoInfo: async (id, extension) => {
      if (!isAttachmentId(id) || !isSafeVideoExtension(extension)) return undefined;
      const path = join(directory, `${id}.${extension}`);
      let handle;
      try {
        handle = await open(path, 'r');
        const { size } = await handle.stat();
        if (size <= 0 || size > MAX_ATTACHMENT_VIDEO_BYTES) return undefined;
        const prefix = Buffer.alloc(Math.min(size, 12));
        const { bytesRead: prefixBytesRead } = await handle.read(prefix, 0, prefix.byteLength, 0);
        const headerLength =
          extension === 'webm'
            ? getEbmlHeaderLength(prefix.subarray(0, prefixBytesRead), size)
            : Math.min(size, 4100);
        if (headerLength === undefined) return undefined;
        const header = Buffer.alloc(headerLength);
        const { bytesRead } = await handle.read(header, 0, header.byteLength, 0);
        if (bytesRead !== header.byteLength) return undefined;
        const detected = await identifyVideoBuffer(header);
        if (
          detected === undefined ||
          detected.ext !== extension ||
          mime.getType(extension) !== detected.mime
        ) {
          return undefined;
        }
        return { size, mimeType: detected.mime };
      } catch (error) {
        if (isMissingFile(error)) return undefined;
        throw error;
      } finally {
        await handle?.close();
      }
    },
    readVideoRange: async (id, extension, start, end, expectedSize) => {
      if (
        !isAttachmentId(id) ||
        !isSafeVideoExtension(extension) ||
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        end < start
      ) {
        return undefined;
      }
      let handle;
      try {
        handle = await open(join(directory, `${id}.${extension}`), 'r');
        const { size } = await handle.stat();
        if (size !== expectedSize || end >= size) return undefined;
        const chunk = Buffer.alloc(end - start + 1);
        const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, start);
        return bytesRead === chunk.byteLength ? chunk : undefined;
      } catch (error) {
        if (isMissingFile(error)) return undefined;
        throw error;
      } finally {
        await handle?.close();
      }
    },
  };
}
