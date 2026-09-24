import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
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

  it('동시에 처음 목록을 불러와도 기본 템플릿을 한 벌만 제공한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectTemplateStore(projectDirectory);

    const [firstList, secondList] = await Promise.all([store.list(), store.list()]);

    expect(firstList).toHaveLength(6);
    expect(secondList).toEqual(firstList);
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

  it('같은 UUID를 저장하면 기존 템플릿 내용을 수정한다', async () => {
    const store = createProjectTemplateStore(await createProjectDirectory());
    const template = { id: randomUUID(), name: '초안', description: '기존', body: '기존 본문' };
    await store.save(template);

    const updated = await store.save({ ...template, name: '수정본', body: '# 새 본문' });

    expect(updated).toContainEqual({ ...template, name: '수정본', body: '# 새 본문' });
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

  it('메타데이터 형식이 잘못된 UUID 파일을 목록에서 건너뛴다', async () => {
    const projectDirectory = await createProjectDirectory();
    const directory = join(projectDirectory, 'complex-prompt', 'templates');
    await mkdir(directory, { recursive: true });
    const invalidFrontmatters = [
      '---\nother: "필드"\n---\n본문',
      '---\nname: 잘못된 JSON\ndescription: "설명"\n---\n본문',
      '---\nname: "이름"\n---\n본문',
    ];
    for (const content of invalidFrontmatters) {
      await writeFile(join(directory, `${randomUUID()}.md`), content, 'utf8');
    }
    await writeFile(join(directory, 'notes.md'), '일반 문서', 'utf8');
    const store = createProjectTemplateStore(projectDirectory);

    const templates = await store.list();

    expect(templates).toHaveLength(6);
  });

  it('프로토콜 길이 제한을 넘는 템플릿 파일을 목록에서 건너뛴다', async () => {
    const projectDirectory = await createProjectDirectory();
    const directory = join(projectDirectory, 'complex-prompt', 'templates');
    await mkdir(directory, { recursive: true });
    const invalidId = randomUUID();
    await writeFile(
      join(directory, `${invalidId}.md`),
      `---\nname: ${JSON.stringify('이름'.repeat(61))}\ndescription: "설명"\n---\n본문`,
      'utf8',
    );
    const store = createProjectTemplateStore(projectDirectory);

    const templates = await store.list();

    expect(templates.map((template) => template.id)).not.toContain(invalidId);
  });

  it('손상된 기본 템플릿 파일을 기본 내용으로 복구한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const directory = join(projectDirectory, 'complex-prompt', 'templates');
    await mkdir(directory, { recursive: true });
    const defaultId = '00000000-0000-4000-8000-000000000101';
    await writeFile(join(directory, `${defaultId}.md`), 'damaged', 'utf8');
    const store = createProjectTemplateStore(projectDirectory);

    const templates = await store.list();

    expect(templates.find((template) => template.id === defaultId)).toMatchObject({
      name: 'PRD/기능 요구사항 초안',
      body: expect.stringContaining('제품 요구사항을 구현해줘'),
    });
  });

  it('프로젝트 템플릿 디렉터리가 심볼릭 링크면 읽기를 거부한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const externalDirectory = await createProjectDirectory();
    await mkdir(join(projectDirectory, 'complex-prompt'));
    await symlink(externalDirectory, join(projectDirectory, 'complex-prompt', 'templates'));
    const store = createProjectTemplateStore(projectDirectory);

    await expect(store.list()).rejects.toThrow(/symbolic links/);
  });

  it('템플릿 파일이 심볼릭 링크면 읽기를 거부한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const externalFile = join(projectDirectory, 'outside.md');
    const directory = join(projectDirectory, 'complex-prompt', 'templates');
    await mkdir(directory, { recursive: true });
    await writeFile(externalFile, '---\nname: "외부"\ndescription: "외부"\n---\n본문', 'utf8');
    await symlink(externalFile, join(directory, `${randomUUID()}.md`));
    const store = createProjectTemplateStore(projectDirectory);

    await expect(store.list()).rejects.toThrow(/symbolic links/);
  });

  it('UUID가 아닌 템플릿 ID의 저장을 거부한다', async () => {
    const store = createProjectTemplateStore(await createProjectDirectory());

    await expect(
      store.save({ id: 'invalid', name: '잘못된 ID', description: '', body: '' }),
    ).rejects.toThrow('Invalid template ID.');
  });

  it('UUID가 아닌 템플릿 ID의 삭제를 거부한다', async () => {
    const store = createProjectTemplateStore(await createProjectDirectory());

    await expect(store.delete('invalid')).rejects.toThrow('Invalid template ID.');
  });

  it('같은 UUID의 템플릿을 삭제하면 목록에서 사라진다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectTemplateStore(projectDirectory);
    const template = { id: randomUUID(), name: '삭제 대상', description: '', body: '' };
    await store.save(template);

    const remaining = await store.delete(template.id);

    expect(remaining).not.toContainEqual(template);
  });

  it('목록에 없는 UUID의 템플릿 삭제를 거부한다', async () => {
    const store = createProjectTemplateStore(await createProjectDirectory());

    await expect(store.delete(randomUUID())).rejects.toThrow();
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

  it('템플릿 저장 경로의 상위 항목이 디렉터리가 아니면 거부한다', async () => {
    const projectDirectory = await createProjectDirectory();
    await writeFile(join(projectDirectory, 'complex-prompt'), 'not a directory', 'utf8');
    const store = createProjectTemplateStore(projectDirectory);

    await expect(store.list()).rejects.toThrow('Project template storage path is not a directory.');
  });

  it('프로젝트 경로가 디렉터리가 아니면 템플릿 읽기를 거부한다', async () => {
    const projectPath = await createProjectDirectory();
    await rm(projectPath, { recursive: true });
    await writeFile(projectPath, 'not a directory', 'utf8');
    const store = createProjectTemplateStore(projectPath);

    await expect(store.list()).rejects.toThrow('The project directory is not a directory.');
  });

  it('UUID 템플릿 경로가 일반 파일이 아니면 읽기를 거부한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const directory = join(projectDirectory, 'complex-prompt', 'templates');
    await mkdir(join(directory, `${randomUUID()}.md`), { recursive: true });
    const store = createProjectTemplateStore(projectDirectory);

    await expect(store.list()).rejects.toThrow('A project template is not a regular file.');
  });
});

async function createProjectDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'project-templates-'));
  temporaryDirectories.push(directory);
  return directory;
}
