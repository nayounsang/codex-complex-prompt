import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CODEX_COMPLEX_PROMPT_CONTENT,
  CODEX_COMPLEX_PROMPT_FILE_MARKER,
  installCodexPrompt,
  removeCodexPrompt,
} from './codex-prompt-config.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Codex 슬래시 prompt 설정', () => {
  it('없는 prompt 파일에 package 소유 슬래시 prompt를 생성한다', async () => {
    const promptPath = join(await createDirectory(), 'prompts', 'complex-prompt.md');

    const result = await installCodexPrompt({ promptPath });

    expect(result.changed).toBe(true);
    expect(await readFile(promptPath, 'utf8')).toBe(CODEX_COMPLEX_PROMPT_CONTENT);
    expect(result.content).toContain(CODEX_COMPLEX_PROMPT_FILE_MARKER);
  });

  it('드라이런에서는 슬래시 prompt 파일을 쓰지 않는다', async () => {
    const promptPath = join(await createDirectory(), 'prompts', 'complex-prompt.md');

    const result = await installCodexPrompt({ promptPath, dryRun: true });

    expect(result.changed).toBe(true);
    await expect(readFile(promptPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('이미 설치된 package 소유 prompt를 변경하지 않는다', async () => {
    const promptPath = join(await createDirectory(), 'complex-prompt.md');
    await writeFile(promptPath, CODEX_COMPLEX_PROMPT_CONTENT, 'utf8');

    const result = await installCodexPrompt({ promptPath });

    expect(result.changed).toBe(false);
  });

  it('사용자 소유 prompt 파일을 덮어쓰지 않는다', async () => {
    const promptPath = join(await createDirectory(), 'complex-prompt.md');
    await writeFile(promptPath, 'user prompt', 'utf8');

    await expect(installCodexPrompt({ promptPath })).rejects.toThrow('not package-owned');
    expect(await readFile(promptPath, 'utf8')).toBe('user prompt');
  });

  it('package 소유 prompt 파일만 제거한다', async () => {
    const promptPath = join(await createDirectory(), 'complex-prompt.md');
    await writeFile(promptPath, CODEX_COMPLEX_PROMPT_CONTENT, 'utf8');

    const result = await removeCodexPrompt({ promptPath });

    expect(result.changed).toBe(true);
    await expect(readFile(promptPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codex-prompt-test-'));
  temporaryDirectories.push(directory);
  return directory;
}
