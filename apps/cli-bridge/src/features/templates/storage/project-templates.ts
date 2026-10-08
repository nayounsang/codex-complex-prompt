import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type { PromptTemplate } from '@codex-complex-prompt/protocol';
import { parseTemplate, serializeTemplate, templateDefinitions } from './template-format.js';

const UUID_TEMPLATE_FILENAME = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}\.md$/i;
const TEMPLATE_SYMLINK_ERROR =
  'Project template storage does not allow symbolic links. Replace them with regular files and directories.';

class TemplateSymlinkError extends Error {
  readonly code = 'ERR_TEMPLATE_SYMLINK';

  constructor() {
    super(TEMPLATE_SYMLINK_ERROR);
    this.name = 'TemplateSymlinkError';
  }
}

export function createProjectTemplateStore(projectDirectory: string) {
  return {
    async list(): Promise<PromptTemplate[]> {
      const templateDirectory = await ensureTemplateDirectory(projectDirectory);
      await ensureDefaultTemplates(templateDirectory);
      const filenames = (await readdir(templateDirectory)).filter((filename) =>
        UUID_TEMPLATE_FILENAME.test(filename),
      );
      const templates: PromptTemplate[] = [];
      for (const filename of filenames) {
        const templatePath = join(templateDirectory, filename);
        const templateStat = await lstatIfExists(templatePath);
        /* c8 ignore next 1 -- a file removed between readdir and lstat is a filesystem race. */
        if (templateStat === undefined) continue;
        assertRegularFile(templateStat);
        const content = await readDirectFile(templatePath);
        try {
          templates.push(parseTemplate(content, filename.slice(0, -3)));
        } catch {
          // Ignore a damaged template so the remaining project templates stay available.
        }
      }
      return templates.sort((left, right) => left.name.localeCompare(right.name, 'ko'));
    },
    async save(template: PromptTemplate): Promise<PromptTemplate[]> {
      const templateDirectory = await ensureTemplateDirectory(projectDirectory);
      await writeTemplate(templateDirectory, template);
      return this.list();
    },
    async delete(id: string): Promise<PromptTemplate[]> {
      if (!UUID_TEMPLATE_FILENAME.test(`${id}.md`)) throw new Error('Invalid template ID.');
      const templateDirectory = await ensureTemplateDirectory(projectDirectory);
      const templatePath = join(templateDirectory, `${id}.md`);
      const templateStat = await lstat(templatePath);
      assertRegularFile(templateStat);
      await unlink(templatePath);
      return this.list();
    },
  };
}

async function ensureTemplateDirectory(projectDirectory: string): Promise<string> {
  const projectRoot = await realpath(projectDirectory);
  const projectStat = await lstat(projectRoot);
  if (!projectStat.isDirectory()) throw new Error('The project directory is not a directory.');

  const complexPromptDirectory = join(projectRoot, 'complex-prompt');
  await ensureDirectoryWithoutSymlink(complexPromptDirectory);
  const templateDirectory = join(complexPromptDirectory, 'templates');
  await ensureDirectoryWithoutSymlink(templateDirectory);
  return templateDirectory;
}

async function ensureDirectoryWithoutSymlink(directoryPath: string): Promise<void> {
  let directoryStat = await lstatIfExists(directoryPath);
  if (directoryStat === undefined) {
    try {
      await mkdir(directoryPath);
    } catch (error) {
      /* c8 ignore next 1 -- concurrent directory creation cannot be forced deterministically. */
      if (!isErrno(error, 'EEXIST')) throw error;
    }
    directoryStat = await lstat(directoryPath);
  }
  assertDirectory(directoryStat);
}

async function ensureDefaultTemplates(templateDirectory: string): Promise<void> {
  const markerPath = join(templateDirectory, '.defaults-installed');
  const markerStat = await lstatIfExists(markerPath);
  if (markerStat !== undefined) {
    assertRegularFile(markerStat);
    return;
  }

  for (const definition of templateDefinitions) {
    await ensureDefaultTemplate(templateDirectory, definition);
  }

  try {
    await createFileIfAbsent(markerPath, 'installed\n');
  } catch (error) {
    /* c8 ignore next 1 -- concurrent marker creation cannot be forced deterministically. */
    if (!isErrno(error, 'EEXIST')) throw error;
    const racedMarkerStat = await lstat(markerPath);
    assertRegularFile(racedMarkerStat);
  }
}

async function ensureDefaultTemplate(
  templateDirectory: string,
  definition: (typeof templateDefinitions)[number],
): Promise<void> {
  const template: PromptTemplate = { ...definition };
  const templatePath = join(templateDirectory, `${template.id}.md`);
  const existingStat = await lstatIfExists(templatePath);
  if (existingStat !== undefined) {
    assertRegularFile(existingStat);
    const existingContent = await readDirectFile(templatePath);
    try {
      parseTemplate(existingContent, template.id);
      return;
    } catch {
      await replaceFile(templatePath, templateDirectory, serializeTemplate(template));
      return;
    }
  }

  try {
    await createFileIfAbsent(templatePath, serializeTemplate(template));
  } catch (error) {
    /* c8 ignore next 1 -- concurrent default creation cannot be forced deterministically. */
    if (!isErrno(error, 'EEXIST')) throw error;
    const racedStat = await lstat(templatePath);
    assertRegularFile(racedStat);
    const racedContent = await readDirectFile(templatePath);
    try {
      parseTemplate(racedContent, template.id);
    } catch {
      /* c8 ignore next 1 -- malformed data won by a concurrent initializer is nondeterministic. */
      await replaceFile(templatePath, templateDirectory, serializeTemplate(template));
    }
  }
}

async function writeTemplate(templateDirectory: string, template: PromptTemplate): Promise<void> {
  if (!UUID_TEMPLATE_FILENAME.test(`${template.id}.md`)) throw new Error('Invalid template ID.');
  const templatePath = join(templateDirectory, `${template.id}.md`);
  const existingStat = await lstatIfExists(templatePath);
  if (existingStat !== undefined) assertRegularFile(existingStat);
  await replaceFile(templatePath, templateDirectory, serializeTemplate(template));
}

async function createFileIfAbsent(targetPath: string, content: string): Promise<void> {
  const file = await open(targetPath, 'wx', 0o666);
  try {
    await file.writeFile(content, 'utf8');
  } finally {
    await file.close();
  }
}

async function replaceFile(
  targetPath: string,
  templateDirectory: string,
  content: string,
): Promise<void> {
  const temporaryPath = await writeTemporaryFile(templateDirectory, content);
  try {
    await rename(temporaryPath, targetPath);
  } finally {
    await unlinkIfExists(temporaryPath);
  }
}

async function writeTemporaryFile(templateDirectory: string, content: string): Promise<string> {
  const temporaryPath = join(templateDirectory, `.template-${randomUUID()}.tmp`);
  const file = await open(temporaryPath, 'wx', 0o666);
  try {
    await file.writeFile(content, 'utf8');
  } finally {
    await file.close();
  }
  return temporaryPath;
}

async function readDirectFile(filePath: string): Promise<string> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    /* c8 ignore next 1 -- supported platforms define O_NOFOLLOW; fallback is platform-specific. */
    file = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const fileStat = await file.stat();
    /* c8 ignore next 1 -- file type changing after lstat requires an external filesystem race. */
    if (!fileStat.isFile()) throw new Error('A project template is not a regular file.');
    return await file.readFile('utf8');
  } catch (error) {
    /* c8 ignore next 1 -- lstat rejects links first; ELOOP covers a link-swap race before open. */
    if (isErrno(error, 'ELOOP')) throw new TemplateSymlinkError();
    throw error;
  } finally {
    await file?.close();
  }
}

async function lstatIfExists(filePath: string) {
  try {
    return await lstat(filePath);
  } catch (error) {
    /* c8 ignore next 1 -- ENOENT is the only portable error; other OS errors are environmental. */
    if (isErrno(error, 'ENOENT')) return undefined;
    throw error;
  }
}

function assertDirectory(fileStat: Awaited<ReturnType<typeof lstat>>): void {
  if (fileStat.isSymbolicLink()) throw new TemplateSymlinkError();
  if (!fileStat.isDirectory()) throw new Error('Project template storage path is not a directory.');
}

function assertRegularFile(fileStat: Awaited<ReturnType<typeof lstat>>): void {
  if (fileStat.isSymbolicLink()) throw new TemplateSymlinkError();
  if (!fileStat.isFile()) throw new Error('A project template is not a regular file.');
}

async function unlinkIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}
