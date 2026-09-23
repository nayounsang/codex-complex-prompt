import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createProjectTemplateStore } from './project-templates.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('프로젝트 템플릿 저장소', () => {
  it('새 프로젝트에서 기본 템플릿 여섯 개를 Markdown 파일로 제공한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectTemplateStore(projectDirectory);

    const templates = await store.list();

    expect(templates).toHaveLength(6);
    expect(templates.map((template) => template.name)).toContain('PRD/기능 요구사항 초안');
    expect(templates.every((template) => template.id.length === 36)).toBe(true);
  });

  it('템플릿 이름과 설명 및 Markdown 본문을 같은 UUID 파일에 저장한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectTemplateStore(projectDirectory);
    const template = {
      id: randomUUID(),
      name: '개발 계획',
      description: '작업 순서를 씁니다.',
      body: '# 단계\n\n한글 내용',
    };

    const saved = await store.save(template);
    const reloaded = await store.list();

    expect(saved).toContainEqual(template);
    expect(reloaded).toContainEqual(template);
  });

  it('손상된 frontmatter를 건너뛰고 읽을 수 있는 템플릿을 반환한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const directory = join(projectDirectory, 'complex-prompt', 'templates');
    await mkdir(directory, { recursive: true });
    const damagedId = randomUUID();
    await writeFile(join(directory, `${damagedId}.md`), 'not frontmatter', 'utf8');
    const store = createProjectTemplateStore(projectDirectory);

    const templates = await store.list();

    expect(templates).toHaveLength(6);
    expect(templates.map((template) => template.id)).not.toContain(damagedId);
  });

  it('같은 UUID의 템플릿을 삭제하면 목록에서 사라진다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectTemplateStore(projectDirectory);
    const template = { id: randomUUID(), name: '삭제 대상', description: '', body: '' };
    await store.save(template);

    const remaining = await store.delete(template.id);

    expect(remaining).not.toContainEqual(template);
  });

  it('템플릿 디렉터리를 만들 수 없으면 파일 시스템 오류를 반환한다', async () => {
    const projectDirectory = await createProjectDirectory();
    await writeFile(
      join(projectDirectory, 'complex-prompt'),
      'file blocks directory creation',
      'utf8',
    );
    const store = createProjectTemplateStore(projectDirectory);

    await expect(store.list()).rejects.toThrow();
  });
});

async function createProjectDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'project-templates-'));
  temporaryDirectories.push(directory);
  return directory;
}
