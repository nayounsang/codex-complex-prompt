import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { MAX_ATTACHMENT_VIDEO_BYTES } from '@codex-complex-prompt/protocol';

import {
  createProjectAttachmentStore,
  isAttachmentId,
  MAX_ATTACHMENT_PNG_BYTES,
} from './project-attachments.js';

const temporaryDirectories: string[] = [];
const PNG_DATA =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const PNG_DATA_URL = `data:image/png;base64,${PNG_DATA}`;
const GIF_DATA = 'R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const VIDEO_DATA = 'AAAAGGZ0eXBpc29tAAACAGlzb21pc28y';
const VIDEO_DATA_URL = `data:video/mp4;base64,${VIDEO_DATA}`;

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
  it('MP4를 저장하고 정보와 지정한 byte range를 읽는다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = '00000000-0000-4000-8000-000000000043';
    const bytes = Buffer.from(VIDEO_DATA, 'base64');
    await store.save({ id, video: VIDEO_DATA_URL, extension: 'mp4' });

    await expect(store.getVideoInfo(id, 'mp4')).resolves.toEqual({
      size: bytes.byteLength,
      mimeType: 'video/mp4',
    });
    await expect(store.readVideoRange(id, 'mp4', 4, 7, bytes.byteLength)).resolves.toEqual(
      bytes.subarray(4, 8),
    );
    await expect(store.read(id, 'mp4')).resolves.toMatchObject({
      id,
      video: bytes,
      extension: 'mp4',
      mimeType: 'video/mp4',
    });
    await expect(store.read(id, 'json')).resolves.toBeUndefined();
  });

  it('동영상 정보와 range 읽기는 잘못된 ID, 확장자, 범위를 거부한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = '00000000-0000-4000-8000-000000000044';
    const bytes = Buffer.from(VIDEO_DATA, 'base64');
    await store.save({ id, video: VIDEO_DATA_URL, extension: 'mp4' });

    await expect(store.getVideoInfo('../outside', 'mp4')).resolves.toBeUndefined();
    await expect(store.getVideoInfo(id, '../mp4')).resolves.toBeUndefined();
    await expect(store.getVideoInfo(id, 'webm')).resolves.toBeUndefined();
    await expect(
      store.getVideoInfo('00000000-0000-4000-8000-000000000045', 'mp4'),
    ).resolves.toBeUndefined();
    await expect(
      store.readVideoRange('../outside', 'mp4', 0, 1, bytes.length),
    ).resolves.toBeUndefined();
    await expect(store.readVideoRange(id, '../mp4', 0, 1, bytes.length)).resolves.toBeUndefined();
    await expect(store.readVideoRange(id, 'mp4', 0.5, 1, bytes.length)).resolves.toBeUndefined();
    await expect(
      store.readVideoRange(id, 'mp4', 0, Number.NaN, bytes.length),
    ).resolves.toBeUndefined();
    await expect(store.readVideoRange(id, 'mp4', -1, 1, bytes.length)).resolves.toBeUndefined();
    await expect(store.readVideoRange(id, 'mp4', 2, 1, bytes.length)).resolves.toBeUndefined();
    await expect(
      store.readVideoRange(id, 'mp4', 0, bytes.length, bytes.length),
    ).resolves.toBeUndefined();
    await expect(store.readVideoRange(id, 'mp4', 0, 1, bytes.length + 1)).resolves.toBeUndefined();
  });

  it('크기가 비었거나 상한을 넘거나 내용이 손상된 video 파일을 거부한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const directory = join(projectDirectory, '.complex-prompt', 'attachments');
    await mkdir(directory, { recursive: true });
    const emptyId = '00000000-0000-4000-8000-000000000047';
    const oversizedId = '00000000-0000-4000-8000-000000000048';
    const corruptId = '00000000-0000-4000-8000-000000000049';
    await writeFile(join(directory, `${emptyId}.mp4`), Buffer.alloc(0));
    await writeFile(
      join(directory, `${oversizedId}.mp4`),
      Buffer.alloc(MAX_ATTACHMENT_VIDEO_BYTES + 1),
    );
    await writeFile(join(directory, `${corruptId}.mp4`), 'not a video');

    await expect(store.getVideoInfo(emptyId, 'mp4')).resolves.toBeUndefined();
    await expect(store.getVideoInfo(oversizedId, 'mp4')).resolves.toBeUndefined();
    await expect(store.getVideoInfo(corruptId, 'mp4')).resolves.toBeUndefined();
    await expect(store.read(corruptId, 'mp4')).resolves.toBeUndefined();
  });

  it('동영상 경로의 실제 파일 오류를 호출자에게 전달한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const directory = join(projectDirectory, '.complex-prompt', 'attachments');
    await mkdir(join(projectDirectory, '.complex-prompt'), { recursive: true });
    await writeFile(directory, 'not a directory');
    const id = '00000000-0000-4000-8000-000000000050';
    const readScene = store.readScene;
    if (readScene === undefined) throw new Error('readScene must be available.');

    await expect(store.getVideoInfo(id, 'mp4')).rejects.toMatchObject({ code: 'ENOTDIR' });
    await expect(store.readVideoRange(id, 'mp4', 0, 1, 2)).rejects.toMatchObject({
      code: 'ENOTDIR',
    });
    await expect(readScene(id)).rejects.toMatchObject({ code: 'ENOTDIR' });
  });

  it('동영상만 저장된 첨부는 Excalidraw 장면이 있는 것으로 표시하지 않는다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = '00000000-0000-4000-8000-000000000051';
    await store.save({ id, video: VIDEO_DATA_URL, extension: 'mp4' });

    await expect(store.hasSceneData(id)).resolves.toBe(false);
  });

  it('동영상 데이터 URI, 실제 형식, 지정한 확장자가 일치하지 않으면 저장을 거부한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);

    await expect(store.save({ video: 'not a video', extension: 'mp4' })).rejects.toThrow(
      'The attachment must be an encoded video.',
    );
    await expect(store.save({ video: 'data:video/mp4;base64,', extension: 'mp4' })).rejects.toThrow(
      'The video content is invalid or its MIME type does not match.',
    );
    await expect(
      store.save({ video: 'data:video/webm;base64,AA==', extension: 'webm' }),
    ).rejects.toThrow('The video content is invalid or its MIME type does not match.');
    await expect(store.save({ video: VIDEO_DATA_URL, extension: 'webm' })).rejects.toThrow(
      'Video extension does not match its content.',
    );
    await expect(store.save({ video: VIDEO_DATA_URL, extension: '../mp4' })).rejects.toThrow(
      'Video extension does not match its content.',
    );
    await expect(
      store.save({ video: VIDEO_DATA_URL, extension: 'mp4', scene: '{}' }),
    ).rejects.toThrow('Invalid video attachment request.');
    await expect(store.save({ video: VIDEO_DATA_URL })).rejects.toThrow(
      'Invalid video attachment request.',
    );
  });

  it('크기 제한을 넘는 동영상 데이터를 저장하지 않는다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const oversizedDataUri = `data:video/mp4;base64,${'A'.repeat(
      Math.ceil((MAX_ATTACHMENT_VIDEO_BYTES + 2) / 3) * 4 + 129,
    )}`;

    await expect(store.save({ video: oversizedDataUri, extension: 'mp4' })).rejects.toThrow(
      'Video attachments must be 25 MB or smaller.',
    );
    const oversizedBytesData = `data:video/mp4;base64,${'A'.repeat(
      Math.ceil((MAX_ATTACHMENT_VIDEO_BYTES + 1) / 3) * 4,
    )}`;
    await expect(store.save({ video: oversizedBytesData, extension: 'mp4' })).rejects.toThrow(
      'Video attachments must be 25 MB or smaller.',
    );
  });

  it('동영상 교체 시 이전 이미지 파일을 제거하고 삭제 후 다시 읽을 수 없다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = '00000000-0000-4000-8000-000000000046';
    await store.save({ id, png: PNG_DATA_URL, scene: '{}' });

    await store.save({ id, video: VIDEO_DATA_URL, extension: 'mp4' });

    await expect(store.read(id, 'png')).resolves.toBeUndefined();
    await expect(store.getVideoInfo(id, 'mp4')).resolves.toBeDefined();
    await expect(store.delete(id)).resolves.toBe(true);
    await expect(store.getVideoInfo(id, 'mp4')).resolves.toBeUndefined();
    await expect(store.readVideoRange(id, 'mp4', 0, 1, 24)).resolves.toBeUndefined();
  });

  it('PNG와 Excalidraw 편집 데이터가 모두 저장된 그림을 편집 가능하다고 응답한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = await store.save({
      png: PNG_DATA_URL,
      scene: '{"elements":[]}',
    });

    const hasSceneData = await store.hasSceneData(id);

    expect(hasSceneData).toBe(true);
  });

  it('PNG만 남은 첨부는 편집 가능한 그림으로 표시하지 않는다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = await store.save({
      png: PNG_DATA_URL,
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
    await store.save({ id, png: PNG_DATA_URL, scene });

    const attachment = await store.read(id);

    expect(attachment).toMatchObject({
      id,
      image: Buffer.from(PNG_DATA, 'base64'),
      png: Buffer.from(PNG_DATA, 'base64'),
      extension: 'png',
      mimeType: 'image/png',
      scene,
    });
    await expect(store.read(id, 'json')).resolves.toEqual({ id, scene });
  });

  it('장면 확장자 읽기와 장면 전용 API는 없는 파일에 undefined를 반환한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = '00000000-0000-4000-8000-000000000052';
    const readScene = store.readScene;
    if (readScene === undefined) throw new Error('readScene must be available.');

    await expect(store.read(id, 'json')).resolves.toBeUndefined();
    await expect(readScene(id)).resolves.toBeUndefined();
    await expect(readScene('../outside')).resolves.toBeUndefined();
    await expect(store.read(id, '../png')).resolves.toBeUndefined();
    await expect(store.readVideoRange(id, 'mp4', 0, 0, 1)).resolves.toBeUndefined();
  });

  it('저장한 GIF 첨부를 원본 바이트와 GIF 확장자로 다시 읽는다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = '00000000-0000-4000-8000-000000000036';
    const gif = Buffer.from(GIF_DATA, 'base64');
    await store.save({
      id,
      image: `data:image/gif;base64,${GIF_DATA}`,
      extension: 'gif',
      scene: '{"type":"image"}',
    });

    const attachment = await store.read(id, 'gif');

    expect(attachment).toMatchObject({
      id,
      image: gif,
      extension: 'gif',
      mimeType: 'image/gif',
    });
  });

  it('같은 첨부 ID의 이미지 형식을 바꾸면 이전 확장자 파일을 제거한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = '00000000-0000-4000-8000-000000000037';
    await store.save({
      id,
      image: `data:image/gif;base64,${GIF_DATA}`,
      extension: 'gif',
      scene: '{"type":"image"}',
    });

    await store.save({ id, png: PNG_DATA_URL, scene: '{"type":"image"}' });

    await expect(store.read(id, 'gif')).resolves.toBeUndefined();
  });

  it('이미지 내용과 다른 확장자로 첨부를 저장하지 않는다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);

    await expect(
      store.save({
        image: `data:image/gif;base64,${GIF_DATA}`,
        extension: 'png',
        scene: '{"type":"image"}',
      }),
    ).rejects.toThrow('Image extension does not match its content.');
  });

  it('경로 문자가 포함된 이미지 확장자는 저장하지 않는다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);

    await expect(
      store.save({
        image: PNG_DATA_URL,
        extension: '../png',
        scene: '{"type":"image"}',
      }),
    ).rejects.toThrow('Image extension does not match its content.');
  });

  it('그림 삭제 후에는 첨부를 다시 읽을 수 없다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = await store.save({
      png: PNG_DATA_URL,
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
      png: PNG_DATA_URL,
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
      png: PNG_DATA_URL,
      scene: '{"elements":[]}',
    });
    await unlink(join(projectDirectory, '.complex-prompt', 'attachments', `${id}.png`));

    const deleted = await store.delete(id);

    expect(deleted).toBe(true);
  });

  it('잘못된 UUID 형식의 그림 ID 저장을 거부한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);

    await expect(store.save({ id: '../outside', png: PNG_DATA_URL, scene: '{}' })).rejects.toThrow(
      'Attachment ID is invalid.',
    );
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

    await expect(store.save({ png: PNG_DATA_URL, scene: '{' })).rejects.toThrow(
      'Drawing scene JSON is invalid:',
    );
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
    await store.save({ id, png: PNG_DATA_URL, scene: '{"version":1}' });

    await store.save({ id, png: PNG_DATA_URL, scene: '{"version":2}' });

    await expect(store.read(id)).resolves.toMatchObject({ scene: '{"version":2}' });
  });

  it('PNG 첨부 경로가 디렉터리면 파일 읽기 오류를 전달한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = await store.save({
      id: '00000000-0000-4000-8000-000000000035',
      png: PNG_DATA_URL,
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
      png: PNG_DATA_URL,
      scene: '{}',
    });
    const attachmentDirectory = join(projectDirectory, '.complex-prompt', 'attachments');
    await rm(attachmentDirectory, { recursive: true });
    await writeFile(attachmentDirectory, 'not a directory');

    await expect(store.hasSceneData(id)).rejects.toMatchObject({ code: 'ENOTDIR' });
  });

  it('아직 생성되지 않은 첨부 저장소에서 장면 확인과 삭제를 안전하게 처리한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);
    const id = '00000000-0000-4000-8000-000000000053';

    await expect(store.hasSceneData(id)).resolves.toBe(false);
    await expect(store.delete(id)).resolves.toBe(false);
  });

  it('빈 PNG 데이터를 거부한다', async () => {
    const projectDirectory = await createProjectDirectory();
    const store = createProjectAttachmentStore(projectDirectory);

    await expect(store.save({ png: 'data:image/png;base64,', scene: '{}' })).rejects.toThrow(
      'The drawing PNG is invalid.',
    );
  });
});
