import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createProjectAttachmentStore } from './project-attachments.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function createProjectDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codex-project-attachments-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('프로젝트 그림 첨부 저장소', () => {
  it('PNG와 Excalidraw 편집 데이터가 모두 저장된 그림을 편집 가능하다고 응답한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = await store.save({
      png: 'data:image/png;base64,iVBORw0KGgo=',
      scene: '{"elements":[]}',
    });

    const hasSceneData = await store.hasSceneData(id);

    expect(hasSceneData).toBe(true);
  });

  it('PNG만 남은 첨부는 편집 가능한 그림으로 표시하지 않는다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = await store.save({
      png: 'data:image/png;base64,iVBORw0KGgo=',
      scene: '{"elements":[]}',
    });
    await unlink(join(projectDirectory, '.complex-prompt', 'attachments', `${id}.excalidraw.json`));

    const hasSceneData = await store.hasSceneData(id);

    expect(hasSceneData).toBe(false);
  });

  it('첨부 ID가 UUID 형식이 아니면 편집 데이터가 없다고 응답한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);

    const hasSceneData = await store.hasSceneData('../outside');

    expect(hasSceneData).toBe(false);
  });
});
