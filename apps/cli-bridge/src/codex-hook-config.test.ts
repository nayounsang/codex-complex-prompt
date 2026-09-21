import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CODEX_COMPLEX_PROMPT_HOOK_MARKER,
  installCodexStopHook,
  removeCodexStopHook,
} from './codex-hook-config.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Codex 훅 설정', () => {
  it('기존 훅을 보존하면서 패키지 소유 Stop 훅을 설치한다', async () => {
    const configPath = await createConfig({
      description: 'Existing hooks',
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'existing' }] }] },
    });

    const result = await installCodexStopHook({ configPath, command: 'complex-prompt hook stop' });
    const written = JSON.parse(await readFile(configPath, 'utf8')) as {
      hooks: Record<string, unknown[]>;
    };

    expect(result.changed).toBe(true);
    expect(written.hooks['SessionStart']).toHaveLength(1);
    expect(written.hooks['Stop']).toEqual([
      {
        hooks: [
          {
            type: 'command',
            command: 'complex-prompt hook stop',
            timeout: 120,
            statusMessage: CODEX_COMPLEX_PROMPT_HOOK_MARKER,
          },
        ],
      },
    ]);
  });

  it('드라이런에서는 훅 파일을 쓰지 않는다', async () => {
    const configPath = join(await createDirectory(), 'hooks.json');

    const result = await installCodexStopHook({ configPath, dryRun: true });

    expect(result.changed).toBe(true);
    await expect(readFile(configPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('설정된 디렉터리에 없는 훅 파일을 생성한다', async () => {
    const directory = await createDirectory();
    const configPath = join(directory, 'nested', 'hooks.json');

    const result = await installCodexStopHook({ configPath });

    expect(result.changed).toBe(true);
    expect(JSON.parse(await readFile(configPath, 'utf8'))).toHaveProperty('hooks.Stop');
  });

  it('이미 설치된 패키지 소유 훅을 변경하지 않는다', async () => {
    const configPath = await createConfig({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command: 'complex-prompt hook stop',
                timeout: 120,
                statusMessage: CODEX_COMPLEX_PROMPT_HOOK_MARKER,
              },
            ],
          },
        ],
      },
    });

    const result = await installCodexStopHook({ configPath });

    expect(result.changed).toBe(false);
  });

  it('잘못된 형식의 훅 JSON을 거부한다', async () => {
    const directory = await createDirectory();
    const configPath = join(directory, 'hooks.json');
    await writeFile(configPath, '{not-json', 'utf8');

    await expect(installCodexStopHook({ configPath })).rejects.toThrow('not valid JSON');
  });

  it('객체가 아닌 훅 필드를 거부한다', async () => {
    const configPath = await createConfig({ hooks: [] });

    await expect(installCodexStopHook({ configPath })).rejects.toThrow('must contain an object');
  });

  it('패키지 소유 Stop 훅만 제거한다', async () => {
    const configPath = await createConfig({
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'other-stop-hook' }] },
          {
            hooks: [
              {
                type: 'command',
                command: 'complex-prompt hook stop',
                statusMessage: CODEX_COMPLEX_PROMPT_HOOK_MARKER,
              },
            ],
          },
        ],
      },
    });

    await removeCodexStopHook({ configPath, command: 'complex-prompt hook stop' });
    const written = JSON.parse(await readFile(configPath, 'utf8')) as {
      hooks: { Stop: unknown[] };
    };

    expect(written.hooks.Stop).toEqual([
      { hooks: [{ type: 'command', command: 'other-stop-hook' }] },
    ]);
  });
});

async function createConfig(config: Record<string, unknown>): Promise<string> {
  const directory = await createDirectory();
  const configPath = join(directory, 'hooks.json');
  await writeFile(configPath, `${JSON.stringify(config)}\n`, 'utf8');
  return configPath;
}

async function createDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codex-hooks-test-'));
  temporaryDirectories.push(directory);
  return directory;
}
