import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CODEX_COMPLEX_PROMPT_HOOK_MARKER,
  CODEX_COMPLEX_PROMPT_LEGACY_STOP_HOOK_MARKER,
  CODEX_COMPLEX_PROMPT_PLANNOTATOR_WRAPPER_MARKER,
  CODEX_COMPLEX_PROMPT_STOP_HOOK_MARKER,
  defaultCodexHome,
  defaultHooksPath,
  installCodexUserPromptHook,
  removeCodexUserPromptHook,
} from './codex-hook-config.js';
import { CODEX_HOOK_TIMEOUT_SECONDS } from '../../../shared/hook-timeouts.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('Codex UserPromptSubmit 훅 설정', () => {
  it('기존 설정을 보존하면서 명령 편집기 훅을 설치한다', async () => {
    const configPath = await createConfig({
      description: 'Existing hooks',
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: 'plannotator hook stop' }] },
          {
            hooks: [
              {
                type: 'command',
                command: 'complex-prompt hook stop',
                statusMessage: CODEX_COMPLEX_PROMPT_LEGACY_STOP_HOOK_MARKER,
              },
            ],
          },
        ],
      },
    });

    const result = await installCodexUserPromptHook({
      configPath,
      command: 'complex-prompt hook prompt',
    });
    const written = JSON.parse(await readFile(configPath, 'utf8')) as {
      description: string;
      hooks: Record<string, unknown[]>;
    };

    expect(result.changed).toBe(true);
    expect(written.description).toBe('Existing hooks');
    const plannotatorHook = written.hooks['Stop']?.[0] as {
      hooks: Array<{ command: string; statusMessage: string }>;
    };
    expect(plannotatorHook.hooks[0]?.command).toMatch(/^complex-prompt hook plannotator-stop /);
    expect(plannotatorHook.hooks[0]?.statusMessage).toBe(
      CODEX_COMPLEX_PROMPT_PLANNOTATOR_WRAPPER_MARKER,
    );
    const payload = plannotatorHook.hooks[0]?.command.split(' ').at(-1) ?? '';
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))).toMatchObject({
      command: 'plannotator hook stop',
    });
    expect(written.hooks['Stop']?.[1]).toEqual({
      hooks: [
        {
          type: 'command',
          command: 'complex-prompt hook stop',
          timeout: CODEX_HOOK_TIMEOUT_SECONDS,
          statusMessage: CODEX_COMPLEX_PROMPT_STOP_HOOK_MARKER,
        },
      ],
    });
    expect(written.hooks['UserPromptSubmit']).toEqual([
      {
        hooks: [
          {
            type: 'command',
            command: 'complex-prompt hook prompt',
            timeout: CODEX_HOOK_TIMEOUT_SECONDS,
            statusMessage: CODEX_COMPLEX_PROMPT_HOOK_MARKER,
          },
        ],
      },
    ]);
  });

  it('드라이런에서는 훅 파일을 쓰지 않는다', async () => {
    const configPath = join(await createDirectory(), 'hooks.json');

    const result = await installCodexUserPromptHook({ configPath, dryRun: true });

    expect(result.changed).toBe(true);
    await expect(readFile(configPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('CODEX_HOME이 지정되면 기본 훅 경로를 그 아래로 계산한다', async () => {
    const codexHome = await createDirectory();
    const previousCodexHome = process.env['CODEX_HOME'];
    process.env['CODEX_HOME'] = codexHome;

    try {
      const result = await installCodexUserPromptHook();

      expect(defaultCodexHome()).toBe(codexHome);
      expect(defaultHooksPath()).toBe(join(codexHome, 'hooks.json'));
      expect(result.configPath).toBe(join(codexHome, 'hooks.json'));
      expect(result.command).toBe('complex-prompt hook prompt');
    } finally {
      restoreCodexHome(previousCodexHome);
    }
  });

  it('이미 설치된 명령 편집기 훅은 중복 설치하지 않는다', async () => {
    const configPath = await createConfig({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command: 'complex-prompt hook stop',
                timeout: CODEX_HOOK_TIMEOUT_SECONDS,
                statusMessage: CODEX_COMPLEX_PROMPT_STOP_HOOK_MARKER,
              },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: 'command',
                command: 'complex-prompt hook prompt',
                timeout: CODEX_HOOK_TIMEOUT_SECONDS,
                statusMessage: CODEX_COMPLEX_PROMPT_HOOK_MARKER,
              },
            ],
          },
        ],
      },
    });

    const result = await installCodexUserPromptHook({ configPath });

    expect(result.changed).toBe(false);
  });

  it('재설치해도 Plannotator 래퍼를 중복 추가하지 않는다', async () => {
    const configPath = await createConfig({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'plannotator hook stop' }] }],
      },
    });

    await installCodexUserPromptHook({ configPath });
    const result = await installCodexUserPromptHook({ configPath });

    expect(result.changed).toBe(false);
    const installed = result.config['hooks'] as {
      Stop: Array<{ hooks: Array<{ command: string }> }>;
    };
    expect(installed.Stop[0]?.hooks).toHaveLength(1);
    expect(installed.Stop[0]?.hooks[0]?.command).toMatch(/^complex-prompt hook plannotator-stop /);
  });

  it('hook remove에서 Plannotator의 원래 명령과 statusMessage를 복원한다', async () => {
    const configPath = await createConfig({
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command: 'plannotator hook stop --flag',
                statusMessage: 'Reviewing plan',
              },
            ],
          },
        ],
      },
    });
    await installCodexUserPromptHook({ configPath });

    await removeCodexUserPromptHook({ configPath });

    const restored = JSON.parse(await readFile(configPath, 'utf8')) as {
      hooks: { Stop: unknown[] };
    };
    expect(restored.hooks.Stop).toEqual([
      {
        hooks: [
          {
            type: 'command',
            command: 'plannotator hook stop --flag',
            statusMessage: 'Reviewing plan',
          },
        ],
      },
    ]);
  });

  it('패키지 소유 훅만 제거하고 다른 훅은 보존한다', async () => {
    const configPath = await createConfig({
      hooks: {
        Stop: [{ hooks: [{ type: 'command', command: 'other-stop' }] }],
        UserPromptSubmit: [
          { hooks: [{ type: 'command', command: 'other-hook' }] },
          {
            hooks: [
              {
                type: 'command',
                command: 'complex-prompt hook prompt',
                statusMessage: CODEX_COMPLEX_PROMPT_HOOK_MARKER,
              },
            ],
          },
        ],
      },
    });

    await removeCodexUserPromptHook({ configPath, command: 'complex-prompt hook prompt' });
    const written = JSON.parse(await readFile(configPath, 'utf8')) as {
      hooks: { Stop: unknown[]; UserPromptSubmit: unknown[] };
    };

    expect(written.hooks.Stop).toEqual([{ hooks: [{ type: 'command', command: 'other-stop' }] }]);
    expect(written.hooks.UserPromptSubmit).toEqual([
      { hooks: [{ type: 'command', command: 'other-hook' }] },
    ]);
  });

  it('UserPromptSubmit 훅이 없으면 빈 목록을 유지한다', async () => {
    const configPath = await createConfig({ hooks: { Stop: [] } });

    const result = await removeCodexUserPromptHook({ configPath, dryRun: true });

    expect(result.changed).toBe(true);
    expect(result.config['hooks']).toEqual({ Stop: [], UserPromptSubmit: [] });
  });

  it('잘못된 훅 JSON을 거부한다', async () => {
    const configPath = join(await createDirectory(), 'hooks.json');
    await writeFile(configPath, '{not-json', 'utf8');

    await expect(installCodexUserPromptHook({ configPath })).rejects.toThrow('not valid JSON');
  });

  it('객체가 아닌 hooks 필드를 거부한다', async () => {
    const configPath = await createConfig({ hooks: [] });

    await expect(installCodexUserPromptHook({ configPath })).rejects.toThrow(
      'must contain an object',
    );
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

function restoreCodexHome(value: string | undefined): void {
  if (value === undefined) delete process.env['CODEX_HOME'];
  else process.env['CODEX_HOME'] = value;
}
