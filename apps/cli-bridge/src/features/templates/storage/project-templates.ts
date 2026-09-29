import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { PromptTemplateSchema, type PromptTemplate } from '@codex-complex-prompt/protocol';

const templateDefinitions = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    name: 'PRD / Feature Requirements',
    description: 'Define the user problem, product goals, requirements, and acceptance criteria.',
    body: 'Implement the product requirements below. Ask questions first when information is missing, and distinguish facts from assumptions.\n\n## User problem\n## Goals and non-goals\n## Target users and user flows\n## Functional requirements\n## Acceptance criteria\n## Open questions\n',
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    name: 'RFC / Technical Proposal',
    description:
      'Document the context, proposal, alternatives, trade-offs, operational impact, and rollout plan.',
    body: 'Write a reviewable technical proposal based on the information below. Mark uncertain details and compare alternatives fairly.\n\n## Context and problem\n## Proposal\n## Alternatives considered\n## Trade-offs and risks\n## Operational and security impact\n## Phased rollout and rollback\n## Open questions\n',
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    name: 'Write an ADR',
    description:
      'Record the context, alternatives, decision, and consequences of a technical choice.',
    body: 'Write a concise Architecture Decision Record using the information below. Do not present a decision as final unless it has been approved.\n\n## Title\n## Status\n## Context and decision drivers\n## Alternatives considered\n## Decision\n## Consequences and follow-up\n',
  },
  {
    id: '00000000-0000-4000-8000-000000000104',
    name: 'CO-STAR Task Brief',
    description: 'Shape a task around its context, objective, style, tone, audience, and response.',
    body: 'Use the CO-STAR structure for the task below. Do not invent missing details; ask questions instead.\n\n## Context\n## Objective\n## Style\n## Tone\n## Audience\n## Response\n',
  },
  {
    id: '00000000-0000-4000-8000-000000000105',
    name: 'RISEN Task Instructions',
    description:
      'Structure a complex task around its role, instructions, steps, end goal, and constraints.',
    body: 'Use the RISEN structure for the task below. Specify the order of work and completion criteria.\n\n## Role\n## Instructions\n## Steps\n## End goal\n## Narrowing constraints\n',
  },
  {
    id: '00000000-0000-4000-8000-000000000106',
    name: 'Meeting Follow-up Actions',
    description:
      'Summarize meeting decisions, open questions, additional information needed, and follow-up tasks.',
    body: 'Create follow-up actions from the meeting notes below. Distinguish decisions from proposals. Do not invent owners or due dates.\n\n## Decisions\n## Open questions\n## Additional questions and materials needed\n## Follow-up tasks (task, owner, due date)\n',
  },
] as const;

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

function serializeTemplate(template: PromptTemplate): string {
  return `---\nname: ${JSON.stringify(template.name)}\ndescription: ${JSON.stringify(template.description)}\n---\n${template.body}`;
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

function parseTemplate(content: string, id: string): PromptTemplate {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (match === null) throw new Error('Template frontmatter is missing.');
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const field = line.match(/^(name|description):\s*(.+)$/);
    if (field === null) throw new Error('Template frontmatter is malformed.');
    fields.set(field[1] ?? '', JSON.parse(field[2] ?? '') as string);
  }
  const name = fields.get('name');
  const description = fields.get('description');
  if (name === undefined || description === undefined)
    throw new Error('Template metadata is missing.');
  const parsed = PromptTemplateSchema.safeParse({ id, name, description, body: match[2] ?? '' });
  if (!parsed.success) throw new Error('Template does not match the prompt template schema.');
  return parsed.data;
}
