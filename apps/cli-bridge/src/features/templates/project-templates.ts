import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import type { PromptTemplate } from '@codex-complex-prompt/protocol';

const templateDefinitions = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    name: 'PRD/기능 요구사항 초안',
    description: '사용자 문제와 목표부터 수용 기준까지 기능 요구사항을 정리합니다.',
    body: '다음 내용을 바탕으로 제품 요구사항을 구현해줘. 정보가 부족하면 먼저 질문하고, 사실과 가정은 구분해줘.\n\n## 사용자 문제\n## 목표와 비목표\n## 대상 사용자와 사용자 흐름\n## 기능 요구사항\n## 수용 기준\n## 미해결 질문\n',
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    name: 'RFC/기술 제안서 초안',
    description: '배경, 제안, 대안, 절충점, 운영 영향과 도입 단계를 문서화합니다.',
    body: '다음 내용을 바탕으로 검토 가능한 기술 제안서를 작성해줘. 불확실한 정보는 표시하고 대안을 공정하게 비교해줘.\n\n## 배경과 문제\n## 제안\n## 검토한 대안\n## 절충점과 위험\n## 운영 및 보안 영향\n## 단계적 도입과 롤백\n## 미해결 질문\n',
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    name: 'ADR 작성',
    description: '기술 결정의 맥락, 대안, 결정과 결과를 기록합니다.',
    body: '다음 정보를 바탕으로 간결한 Architecture Decision Record를 작성해줘. 결정이 이미 확정되지 않았다면 확정된 것처럼 쓰지 마.\n\n## 제목\n## 상태\n## 맥락과 결정 동인\n## 검토한 대안\n## 결정\n## 결과와 후속 영향\n',
  },
  {
    id: '00000000-0000-4000-8000-000000000104',
    name: 'CO-STAR 작업 브리프',
    description:
      'Context, Objective, Style, Tone, Audience, Response 슬롯으로 작업을 구체화합니다.',
    body: 'CO-STAR 구조를 활용해 다음 작업을 수행해줘. 모르는 항목은 임의로 지어내지 말고 질문으로 남겨줘.\n\n## Context\n## Objective\n## Style\n## Tone\n## Audience\n## Response\n',
  },
  {
    id: '00000000-0000-4000-8000-000000000105',
    name: 'RISEN 작업 지시',
    description: 'Role, Instruction, Steps, End goal, Narrowing 구조로 복합 작업을 지시합니다.',
    body: 'RISEN 구조를 활용해 다음 작업을 수행해줘. 실행 순서와 완료 조건을 구체화해줘.\n\n## Role\n## Instruction\n## Steps\n## End goal\n## Narrowing constraints\n',
  },
  {
    id: '00000000-0000-4000-8000-000000000106',
    name: '회의 후 후속 액션',
    description: '회의 결정, 미해결 안건, 추가 질문과 후속 작업을 정리합니다.',
    body: '아래 회의 내용을 바탕으로 후속 작업을 수행해줘. 결정과 제안을 구분하고, 담당자나 기한이 없으면 만들어내지 마.\n\n## 결정 사항\n## 미해결 안건\n## 추가로 필요한 질문과 자료\n## 후속 작업 (작업, 담당자, 기한)\n',
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
    if (!isErrno(error, 'EEXIST')) throw error;
    const racedStat = await lstat(templatePath);
    assertRegularFile(racedStat);
    const racedContent = await readDirectFile(templatePath);
    try {
      parseTemplate(racedContent, template.id);
    } catch {
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
    file = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const fileStat = await file.stat();
    if (!fileStat.isFile()) throw new Error('A project template is not a regular file.');
    return await file.readFile('utf8');
  } catch (error) {
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
  return { id, name, description, body: match[2] ?? '' };
}
