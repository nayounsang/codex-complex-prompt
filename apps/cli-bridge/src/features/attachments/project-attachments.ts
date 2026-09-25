import { randomUUID } from 'node:crypto';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { AttachmentTooLargeError, AttachmentValidationError } from '@codex-complex-prompt/protocol';

export const MAX_ATTACHMENT_PNG_BYTES = 25 * 1024 * 1024;

export interface ProjectAttachment {
  readonly id: string;
  readonly png: Buffer;
  readonly scene: string;
}

export interface ProjectAttachmentStore {
  readonly save: (input: { id?: string; png: string; scene: string }) => Promise<string>;
  readonly read: (id: string) => Promise<ProjectAttachment | undefined>;
  readonly hasSceneData: (id: string) => Promise<boolean>;
  readonly delete: (id: string) => Promise<boolean>;
}

export function createProjectAttachmentStore(projectDirectory: string): ProjectAttachmentStore {
  const directory = resolve(projectDirectory, '.complex-prompt', 'attachments');

  return {
    save: async ({ id = randomUUID(), png, scene }) => {
      if (!isAttachmentId(id)) throw new AttachmentValidationError('Attachment ID is invalid.');
      const image = decodePng(png);
      if (image.byteLength > MAX_ATTACHMENT_PNG_BYTES) {
        throw new AttachmentTooLargeError();
      }
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
      const imagePath = join(directory, `${id}.png`);
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
      return id;
    },
    read: async (id) => {
      if (!isAttachmentId(id)) return undefined;
      try {
        const [png, scene] = await Promise.all([
          readFile(join(directory, `${id}.png`)),
          readFile(join(directory, `${id}.excalidraw.json`), 'utf8'),
        ]);
        return { id, png, scene };
      } catch (error) {
        if (isMissingFile(error)) return undefined;
        throw error;
      }
    },
    hasSceneData: async (id) => {
      if (!isAttachmentId(id)) return false;
      const [imageExists, sceneExists] = await Promise.all([
        fileExists(join(directory, `${id}.png`)),
        fileExists(join(directory, `${id}.excalidraw.json`)),
      ]);
      return imageExists && sceneExists;
    },
    delete: async (id) => {
      if (!isAttachmentId(id)) return false;
      const imagePath = join(directory, `${id}.png`);
      const scenePath = join(directory, `${id}.excalidraw.json`);
      const [imageRemoved, sceneRemoved] = await Promise.all([
        removeFile(imagePath),
        removeFile(scenePath),
      ]);
      return imageRemoved || sceneRemoved;
    },
  };
}

export function isAttachmentId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function decodePng(value: string): Buffer {
  if (value.length > Math.ceil((MAX_ATTACHMENT_PNG_BYTES + 2) / 3) * 4 + 32) {
    throw new AttachmentTooLargeError();
  }
  const match = value.match(/^data:image\/png;base64,([A-Za-z0-9+/]*={0,2})$/);
  if (match === null) {
    throw new AttachmentValidationError('The drawing must be saved as a PNG image.');
  }
  const buffer = Buffer.from(match[1] ?? '', 'base64');
  if (buffer.byteLength === 0 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new AttachmentValidationError('The drawing PNG is invalid.');
  }
  return buffer;
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
