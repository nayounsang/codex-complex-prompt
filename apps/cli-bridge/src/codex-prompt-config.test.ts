import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CODEX_COMPLEX_PROMPT_CONTENT,
  CODEX_COMPLEX_PROMPT_FILE_MARKER,
  defaultCodexPromptPath,
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

  it('CODEX_HOME이 지정되면 기본 슬래시 prompt 경로를 그 아래로 계산한다', async () => {
    const codexHome = await createDirectory();
    const previousCodexHome = process.env['CODEX_HOME'];
    process.env['CODEX_HOME'] = codexHome;

    try {
      const result = await installCodexPrompt();

      expect(defaultCodexPromptPath()).toBe(join(codexHome, 'prompts', 'complex-prompt.md'));
      expect(result.promptPath).toBe(join(codexHome, 'prompts', 'complex-prompt.md'));
    } finally {
      restoreCodexHome(previousCodexHome);
    }
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

  it('읽는 중 오류가 발생한 prompt 경로를 거부한다', async () => {
    const promptPath = await createDirectory();

    await expect(installCodexPrompt({ promptPath })).rejects.toThrow();
  });
});

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codex-prompt-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function restoreCodexHome(value: string | undefined): void {
  if (value === undefined) delete process.env['CODEX_HOME'];
  else process.env['CODEX_HOME'] = value;
}
