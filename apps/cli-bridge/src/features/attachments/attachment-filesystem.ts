import { access, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isMediaFileForId } from './attachment-media.js';
import { isMissingFile } from './attachment-media.js';

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

export async function removeFile(path: string): Promise<boolean> {
  try {
    await rm(path);
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

export async function removeStaleMediaFiles(
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
