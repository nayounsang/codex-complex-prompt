import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createProjectAttachmentStore,
  isAttachmentId,
  MAX_ATTACHMENT_PNG_BYTES,
} from './project-attachments.js';

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

  it('저장한 그림의 PNG와 편집 장면을 다시 읽는다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = '00000000-0000-4000-8000-000000000031';
    const scene = '{"elements":[{"id":"shape"}]}';
    await store.save({ id, png: 'data:image/png;base64,iVBORw0KGgo=', scene });

    const attachment = await store.read(id);

    expect(attachment).toEqual({ id, png: Buffer.from('iVBORw0KGgo=', 'base64'), scene });
  });

  it('그림 삭제 후에는 첨부를 다시 읽을 수 없다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = await store.save({
      png: 'data:image/png;base64,iVBORw0KGgo=',
      scene: '{"elements":[]}',
    });

    const deleted = await store.delete(id);
    const attachment = await store.read(id);

    expect(deleted).toBe(true);
    expect(attachment).toBeUndefined();
  });

  it('이미 제거한 그림을 다시 삭제하면 false를 반환한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = await store.save({
      png: 'data:image/png;base64,iVBORw0KGgo=',
      scene: '{"elements":[]}',
    });
    await store.delete(id);

    const deleted = await store.delete(id);

    expect(deleted).toBe(false);
  });

  it('PNG가 없어도 장면 파일이 있으면 첨부 삭제를 성공으로 반환한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = await store.save({
      png: 'data:image/png;base64,iVBORw0KGgo=',
      scene: '{"elements":[]}',
    });
    await unlink(join(projectDirectory, '.complex-prompt', 'attachments', `${id}.png`));

    const deleted = await store.delete(id);

    expect(deleted).toBe(true);
  });

  it('잘못된 UUID 형식의 그림 ID 저장을 거부한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);

    await expect(
      store.save({ id: '../outside', png: 'data:image/png;base64,iVBORw0KGgo=', scene: '{}' }),
    ).rejects.toThrow('Attachment ID is invalid.');
  });

  it('PNG 데이터 URI가 아닌 그림 저장 요청을 거부한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);

    await expect(store.save({ png: 'not a PNG', scene: '{}' })).rejects.toThrow(
      'The drawing must be saved as a PNG image.',
    );
  });

  it('PNG 서명이 없는 그림 저장 요청을 거부한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);

    await expect(store.save({ png: 'data:image/png;base64,AA==', scene: '{}' })).rejects.toThrow(
      'The drawing PNG is invalid.',
    );
  });

  it('유효하지 않은 Excalidraw 장면 JSON 저장을 거부한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);

    await expect(
      store.save({ png: 'data:image/png;base64,iVBORw0KGgo=', scene: '{' }),
    ).rejects.toThrow('Drawing scene JSON is invalid:');
  });

  it('저장되지 않은 첨부 ID의 그림을 읽으면 undefined를 반환한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);

    const attachment = await store.read('00000000-0000-4000-8000-000000000032');

    expect(attachment).toBeUndefined();
  });

  it('UUID 형식이 아닌 첨부 ID 읽기는 undefined를 반환한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);

    const attachment = await store.read('../outside');

    expect(attachment).toBeUndefined();
  });

  it('UUID 형식이 아닌 첨부 ID 삭제를 거부한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);

    const deleted = await store.delete('../outside');

    expect(deleted).toBe(false);
  });

  it('첨부 ID 검증은 UUID v4 형식에서만 true를 반환한다', () => {
    expect(isAttachmentId('00000000-0000-4000-8000-000000000033')).toBe(true);
  });

  it('UUID v4가 아닌 첨부 ID 검증은 false를 반환한다', () => {
    expect(isAttachmentId('00000000-0000-3000-8000-000000000033')).toBe(false);
  });

  it('PNG 데이터가 25 MB 제한보다 크면 저장을 거부한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const oversizedDataUri = `data:image/png;base64,${'A'.repeat(35_000_000)}`;

    await expect(store.save({ png: oversizedDataUri, scene: '{}' })).rejects.toThrow(
      'PNG attachments must be 25 MB or smaller.',
    );
  });

  it('디코딩된 PNG가 25 MB를 초과하면 저장을 거부한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const png = Buffer.alloc(MAX_ATTACHMENT_PNG_BYTES + 1);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(png);

    await expect(
      store.save({ png: `data:image/png;base64,${png.toString('base64')}`, scene: '{}' }),
    ).rejects.toThrow('PNG attachments must be 25 MB or smaller.');
  });

  it('기존 첨부 ID를 저장하면 PNG와 장면을 새 내용으로 교체한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = '00000000-0000-4000-8000-000000000034';
    await store.save({ id, png: 'data:image/png;base64,iVBORw0KGgo=', scene: '{"version":1}' });

    await store.save({ id, png: 'data:image/png;base64,iVBORw0KGgo=', scene: '{"version":2}' });

    await expect(store.read(id)).resolves.toMatchObject({ scene: '{"version":2}' });
  });

  it('PNG 첨부 경로가 디렉터리면 파일 읽기 오류를 전달한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = await store.save({
      id: '00000000-0000-4000-8000-000000000035',
      png: 'data:image/png;base64,iVBORw0KGgo=',
      scene: '{}',
    });
    const imagePath = join(projectDirectory, '.complex-prompt', 'attachments', `${id}.png`);
    await unlink(imagePath);
    await mkdir(imagePath);

    await expect(store.read(id)).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('첨부 저장소 경로가 파일이면 존재 확인 오류를 전달한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = await store.save({
      png: 'data:image/png;base64,iVBORw0KGgo=',
      scene: '{}',
    });
    const attachmentDirectory = join(projectDirectory, '.complex-prompt', 'attachments');
    await rm(attachmentDirectory, { recursive: true });
    await writeFile(attachmentDirectory, 'not a directory');

    await expect(store.hasSceneData(id)).rejects.toMatchObject({ code: 'ENOTDIR' });
  });

  it('빈 PNG 데이터를 거부한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);

    await expect(store.save({ png: 'data:image/png;base64,', scene: '{}' })).rejects.toThrow(
      'The drawing PNG is invalid.',
    );
  });
});
