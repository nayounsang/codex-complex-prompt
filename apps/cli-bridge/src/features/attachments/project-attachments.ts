import { randomUUID } from 'node:crypto';
import { access, mkdir, open, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  AttachmentTooLargeError,
  AttachmentValidationError,
  MAX_ATTACHMENT_IMAGE_BYTES,
  MAX_ATTACHMENT_VIDEO_BYTES,
} from '@codex-complex-prompt/protocol';
import { detectXml } from '@file-type/xml';
import { FileTypeParser } from 'file-type';
import mime from 'mime';

export { MAX_ATTACHMENT_IMAGE_BYTES };
export const MAX_ATTACHMENT_PNG_BYTES = MAX_ATTACHMENT_IMAGE_BYTES;

export interface ProjectAttachment {
  readonly id: string;
  readonly image?: Buffer;
  readonly video?: Buffer;
  readonly png?: Buffer;
  readonly extension?: string;
  readonly mimeType?: string;
  readonly scene?: string;
}

export interface ProjectAttachmentStore {
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
  readonly save: (input: {
    id?: string;
    image?: string;
    video?: string;
    png?: string;
    extension?: string;
    scene?: string;
  }) => Promise<string>;
  readonly read: (id: string, extension?: string) => Promise<ProjectAttachment | undefined>;
  readonly readScene?: (id: string) => Promise<string | undefined>;
  readonly hasSceneData: (id: string) => Promise<boolean>;
  readonly delete: (id: string) => Promise<boolean>;
}

export function createProjectAttachmentStore(projectDirectory: string): ProjectAttachmentStore {
  const directory = resolve(projectDirectory, '.complex-prompt', 'attachments');

  return {
    getVideoInfo: async (id, extension) => {
      if (!isAttachmentId(id) || !isSafeVideoExtension(extension)) return undefined;
      const path = join(directory, `${id}.${extension}`);
      let handle;
      try {
        handle = await open(path, 'r');
        const { size } = await handle.stat();
        if (size <= 0 || size > MAX_ATTACHMENT_VIDEO_BYTES) return undefined;
        const header = Buffer.alloc(Math.min(size, 4100));
        const { bytesRead } = await handle.read(header, 0, header.byteLength, 0);
        const detected = await identifyVideoBuffer(header.subarray(0, bytesRead));
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
    save: async ({
      id = randomUUID(),
      image: imageDataUrl,
      video: videoDataUrl,
      png,
      extension,
      scene,
    }) => {
      if (!isAttachmentId(id)) throw new AttachmentValidationError('Attachment ID is invalid.');
      if (videoDataUrl !== undefined) {
        if (
          imageDataUrl !== undefined ||
          png !== undefined ||
          scene !== undefined ||
          extension === undefined
        ) {
          throw new AttachmentValidationError('Invalid video attachment request.');
        }
        const {
          data: video,
          extension: detectedExtension,
          mimeType,
        } = await decodeVideo(videoDataUrl);
        if (video.byteLength > MAX_ATTACHMENT_VIDEO_BYTES) {
          throw new AttachmentTooLargeError('Video attachments must be 25 MB or smaller.');
        }
        if (
          !isSafeVideoExtension(extension) ||
          mime.getType(extension) !== mimeType ||
          extension !== detectedExtension
        ) {
          throw new AttachmentValidationError('Video extension does not match its content.');
        }
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const videoPath = join(directory, `${id}.${extension}`);
        const temporary = `${videoPath}.tmp-${process.pid}-${randomUUID()}`;
        await writeFile(temporary, video, { mode: 0o600, flag: 'wx' });
        try {
          await rename(temporary, videoPath);
        } catch (error) {
          await rm(temporary, { force: true });
          throw error;
        }
        await removeStaleMediaFiles(directory, id, `${id}.${extension}`);
        return id;
      }
      const encodedImage = imageDataUrl ?? png;
      if (encodedImage === undefined)
        throw new AttachmentValidationError('Image data is required.');
      const legacyPngInput = imageDataUrl === undefined;
      const {
        data: image,
        extension: detectedExtension,
        mimeType,
      } = await decodeImage(encodedImage, legacyPngInput);
      if (image.byteLength > MAX_ATTACHMENT_IMAGE_BYTES) {
        throw new AttachmentTooLargeError(
          legacyPngInput ? undefined : 'Image attachments must be 25 MB or smaller.',
        );
      }
      const imageExtension = extension ?? detectedExtension;
      if (!isSafeImageExtension(imageExtension) || mime.getType(imageExtension) !== mimeType) {
        throw new AttachmentValidationError('Image extension does not match its content.');
      }
      if (scene === undefined)
        throw new AttachmentValidationError('Drawing scene JSON is required.');
      try {
        JSON.parse(scene) as unknown;
      } catch (error) {
        throw new AttachmentValidationError(
          `Drawing scene JSON is invalid: ${
            error instanceof Error ? error.message : 'unknown parse error'
          }`,
        );
      }
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const imagePath = join(directory, `${id}.${imageExtension}`);
      const scenePath = join(directory, `${id}.excalidraw.json`);
      const suffix = `.tmp-${process.pid}-${randomUUID()}`;
      const imageTemporary = `${imagePath}${suffix}`;
      const sceneTemporary = `${scenePath}${suffix}`;
      const imageBackup = `${imagePath}${suffix}.bak`;
      const sceneBackup = `${scenePath}${suffix}.bak`;
      await writeFile(imageTemporary, image, { mode: 0o600, flag: 'wx' });
      let imageBackedUp = false;
      let sceneBackedUp = false;
      let imageReplaced = false;
      let sceneReplaced = false;
      try {
        await writeFile(sceneTemporary, scene, {
          encoding: 'utf8',
          mode: 0o600,
          flag: 'wx',
        });
        if (await fileExists(imagePath)) {
          await rename(imagePath, imageBackup);
          imageBackedUp = true;
        }
        if (await fileExists(scenePath)) {
          await rename(scenePath, sceneBackup);
          sceneBackedUp = true;
        }
        await rename(imageTemporary, imagePath);
        imageReplaced = true;
        await rename(sceneTemporary, scenePath);
        sceneReplaced = true;
      } catch (error) {
        if (imageReplaced) await rm(imagePath, { force: true });
        if (sceneReplaced) await rm(scenePath, { force: true });
        if (imageBackedUp) await rename(imageBackup, imagePath);
        if (sceneBackedUp) await rename(sceneBackup, scenePath);
        await Promise.all([
          rm(imageTemporary, { force: true }),
          rm(sceneTemporary, { force: true }),
        ]);
        throw error;
      }
      await Promise.all([rm(imageBackup, { force: true }), rm(sceneBackup, { force: true })]).catch(
        () => undefined,
      );
      await removeStaleMediaFiles(directory, id, `${id}.${imageExtension}`);
      return id;
    },
    read: async (id, extension) => {
      if (!isAttachmentId(id)) return undefined;
      try {
        if (extension === 'json') {
          return { id, scene: await readFile(join(directory, `${id}.excalidraw.json`), 'utf8') };
        }
        if (extension !== undefined && isSafeVideoExtension(extension)) {
          const video = await readFile(join(directory, `${id}.${extension}`));
          const parsed = await identifyVideoBuffer(video);
          if (
            parsed === undefined ||
            parsed.ext !== extension ||
            mime.getType(extension) !== parsed.mime
          ) {
            return undefined;
          }
          return { id, video, extension, mimeType: parsed.mime };
        }
        const imageExtension = extension ?? 'png';
        if (!isSafeImageExtension(imageExtension)) return undefined;
        const image = await readFile(join(directory, `${id}.${imageExtension}`));
        const parsed = await identifyImageBuffer(image);
        if (parsed === undefined || mime.getType(imageExtension) !== parsed.mimeType)
          return undefined;
        const scene =
          extension === undefined
            ? await readFile(join(directory, `${id}.excalidraw.json`), 'utf8')
            : undefined;
        return {
          id,
          image,
          png: image,
          extension: imageExtension,
          mimeType: parsed.mimeType,
          ...(scene === undefined ? {} : { scene }),
        };
      } catch (error) {
        if (isMissingFile(error)) return undefined;
        throw error;
      }
    },
    readScene: async (id) => {
      if (!isAttachmentId(id)) return undefined;
      try {
        return await readFile(join(directory, `${id}.excalidraw.json`), 'utf8');
      } catch (error) {
        if (isMissingFile(error)) return undefined;
        throw error;
      }
    },
    hasSceneData: async (id) => {
      if (!isAttachmentId(id)) return false;
      try {
        const [entries, sceneExists] = await Promise.all([
          readdir(directory),
          fileExists(join(directory, `${id}.excalidraw.json`)),
        ]);
        return sceneExists && entries.some((entry) => isImageFileForId(entry, id));
      } catch (error) {
        if (isMissingFile(error)) return false;
        throw error;
      }
    },
    delete: async (id) => {
      if (!isAttachmentId(id)) return false;
      const scenePath = join(directory, `${id}.excalidraw.json`);
      let removed = await removeFile(scenePath);
      const entries = await readdir(directory).catch((error: unknown) => {
        if (isMissingFile(error)) return [];
        throw error;
      });
      for (const entry of entries.filter((candidate) => isMediaFileForId(candidate, id))) {
        removed = (await removeFile(join(directory, entry))) || removed;
      }
      return removed;
    },
  };
}

export function isAttachmentId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function decodeImage(
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

async function decodeVideo(
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

async function identifyVideoBuffer(
  buffer: Buffer,
): Promise<{ ext: string; mime: string } | undefined> {
  const parser = new FileTypeParser();
  const detected = await parser.fromBuffer(buffer);
  if (detected === undefined || !detected.mime.startsWith('video/')) return undefined;
  return { ext: detected.ext, mime: detected.mime };
}

async function identifyImageBuffer(
  buffer: Buffer,
): Promise<{ readonly extension: string; readonly mimeType: string } | undefined> {
  const parser = new FileTypeParser({ customDetectors: [detectXml] });
  const detected = await parser.fromBuffer(buffer);
  if (detected === undefined || !detected.mime.startsWith('image/')) return undefined;
  return { extension: detected.ext, mimeType: detected.mime };
}

function isSafeImageExtension(value: string): boolean {
  return /^[a-z0-9]+$/.test(value) && mime.getType(value)?.startsWith('image/') === true;
}

function isImageFileForId(entry: string, id: string): boolean {
  if (!entry.startsWith(`${id}.`)) return false;
  const extension = entry.slice(id.length + 1);
  return isSafeImageExtension(extension);
}

function isSafeVideoExtension(value: string): boolean {
  return (
    ['mp4', 'mov', 'webm'].includes(value) && mime.getType(value)?.startsWith('video/') === true
  );
}

function isMediaFileForId(entry: string, id: string): boolean {
  if (!entry.startsWith(`${id}.`)) return false;
  const extension = entry.slice(id.length + 1);
  return isImageFileForId(entry, id) || isSafeVideoExtension(extension);
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

async function removeFile(path: string): Promise<boolean> {
  try {
    await rm(path);
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

async function removeStaleMediaFiles(
  directory: string,
  id: string,
  currentImageName: string,
): Promise<void> {
  const entries = await readdir(directory).catch(() => []);
  await Promise.all(
    entries
      .filter((entry) => isMediaFileForId(entry, id) && entry !== currentImageName)
      .map((entry) => rm(join(directory, entry), { force: true })),
  ).catch(() => undefined);
}
