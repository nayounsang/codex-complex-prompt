import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createFeedbackLoopStateStore } from './feedback-loop-state.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('feedback loop 상태 저장소', () => {
  it('세션 ID가 없으면 feedback loop를 활성화하지 않는다', async () => {
    const directory = await createDirectory();
    const stateStore = createFeedbackLoopStateStore(directory);

    const activated = await stateStore.activate(undefined);

    expect(activated).toBe(false);
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('유효하지 않은 세션 ID의 상태 조회는 비활성으로 반환한다', async () => {
    const directory = await createDirectory();
    const stateStore = createFeedbackLoopStateStore(directory);

    const active = await stateStore.isActive('../outside');

    expect(active).toBe(false);
  });

  it('유효하지 않은 세션 ID의 상태 정리는 파일을 만들지 않는다', async () => {
    const directory = await createDirectory();
    const stateStore = createFeedbackLoopStateStore(directory);

    await stateStore.clear('../outside');

    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('프로젝트 경로를 정리해 상태에 저장하고 다시 읽는다', async () => {
    const directory = await createDirectory();
    const stateStore = createFeedbackLoopStateStore(directory);
    const sessionId = 'cwd-session';

    await expect(stateStore.activate(sessionId, '  /workspace/project  ')).resolves.toBe(true);

    const cwd = await stateStore.getCwd?.(sessionId);
    expect(cwd).toBe('/workspace/project');
  });

  it('공백뿐인 프로젝트 경로는 상태에 저장하지 않는다', async () => {
    const directory = await createDirectory();
    const stateStore = createFeedbackLoopStateStore(directory);
    const sessionId = 'blank-cwd-session';

    await expect(stateStore.activate(sessionId, '  \t  ')).resolves.toBe(true);

    const cwd = await stateStore.getCwd?.(sessionId);
    expect(cwd).toBeUndefined();
  });

  it('아직 생성되지 않은 상태를 정리해도 오류를 던지지 않는다', async () => {
    const directory = await createDirectory();
    const stateStore = createFeedbackLoopStateStore(directory);

    await expect(stateStore.clear('not-created-session')).resolves.toBeUndefined();
  });
});

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codex-feedback-loop-state-'));
  temporaryDirectories.push(directory);
  return directory;
}
