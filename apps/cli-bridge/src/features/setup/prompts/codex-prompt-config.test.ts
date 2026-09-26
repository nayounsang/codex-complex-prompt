import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CODEX_COMPLEX_PROMPT_CONTENT,
  CODEX_COMPLEX_PROMPT_FILE_MARKER,
  CODEX_COMPLEX_SKILL_CONTENT,
  CODEX_COMPLEX_SKILL_FILE_MARKER,
  defaultCodexPromptPath,
  defaultCodexSkillPath,
  installCodexSkill,
  installCodexPrompt,
  removeCodexSkill,
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

describe('Codex 호환 prompt 설정', () => {
  it('호환 prompt가 AI Feedback 중 승인을 미루고 Plan Mode Submit 뒤 승인을 요청하도록 안내한다', () => {
    expect(CODEX_COMPLEX_PROMPT_CONTENT).toContain('Do not analyze or answer');
    expect(CODEX_COMPLEX_PROMPT_CONTENT).toContain('Stop hook will reopen the');
    expect(CODEX_COMPLEX_PROMPT_CONTENT).toContain('revised Markdown only');
    expect(CODEX_COMPLEX_PROMPT_CONTENT).toContain('additionalContext');
    expect(CODEX_COMPLEX_PROMPT_CONTENT).toContain('Do not call ExitPlanMode during AI Feedback');
    expect(CODEX_COMPLEX_PROMPT_CONTENT).toContain(
      'after the user chooses Submit to end the review',
    );
  });

  it('없는 prompt 파일에 package 소유 호환 prompt를 생성한다', async () => {
    const promptPath = join(await createDirectory(), 'prompts', 'complex-prompt.md');

    const result = await installCodexPrompt({ promptPath });

    expect(result.changed).toBe(true);
    expect(await readFile(promptPath, 'utf8')).toBe(CODEX_COMPLEX_PROMPT_CONTENT);
    expect(result.content).toContain(CODEX_COMPLEX_PROMPT_FILE_MARKER);
  });

  it('CODEX_HOME이 지정되면 기본 호환 prompt 경로를 그 아래로 계산한다', async () => {
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

  it('드라이런에서는 호환 prompt 파일을 쓰지 않는다', async () => {
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

  it('없는 prompt 파일을 제거할 때 변경하지 않는다', async () => {
    const promptPath = join(await createDirectory(), 'complex-prompt.md');

    const result = await removeCodexPrompt({ promptPath });

    expect(result.changed).toBe(false);
  });

  it('읽는 중 오류가 발생한 prompt 경로를 거부한다', async () => {
    const promptPath = await createDirectory();

    await expect(installCodexPrompt({ promptPath })).rejects.toThrow();
  });
});

describe('Codex skill 설정', () => {
  it('skill이 AI Feedback 루프를 유지하고 Plan Mode Submit 뒤 승인을 요청하도록 안내한다', () => {
    expect(CODEX_COMPLEX_SKILL_CONTENT).toContain('Do not analyze or answer');
    expect(CODEX_COMPLEX_SKILL_CONTENT).toContain('Stop hook will reopen the');
    expect(CODEX_COMPLEX_SKILL_CONTENT).toContain('revised Markdown only');
    expect(CODEX_COMPLEX_SKILL_CONTENT).toContain('additionalContext');
    expect(CODEX_COMPLEX_SKILL_CONTENT).toContain('Do not call ExitPlanMode during AI Feedback');
    expect(CODEX_COMPLEX_SKILL_CONTENT).toContain(
      'after the user chooses Submit to end the review',
    );
    expect(CODEX_COMPLEX_SKILL_CONTENT).toContain('call ExitPlanMode');
  });

  it('없는 skill 파일에 package 소유 skill을 생성한다', async () => {
    const skillPath = join(await createDirectory(), 'skills', 'complex-prompt', 'SKILL.md');

    const result = await installCodexSkill({ skillPath });

    expect(result.changed).toBe(true);
    expect(await readFile(skillPath, 'utf8')).toBe(CODEX_COMPLEX_SKILL_CONTENT);
    expect(result.content).toContain(CODEX_COMPLEX_SKILL_FILE_MARKER);
  });

  it('CODEX_HOME이 지정되면 기본 skill 경로를 그 아래로 계산한다', async () => {
    const codexHome = await createDirectory();
    const previousCodexHome = process.env['CODEX_HOME'];
    process.env['CODEX_HOME'] = codexHome;

    try {
      const result = await installCodexSkill();

      expect(defaultCodexSkillPath()).toBe(join(codexHome, 'skills', 'complex-prompt', 'SKILL.md'));
      expect(result.skillPath).toBe(defaultCodexSkillPath());
    } finally {
      restoreCodexHome(previousCodexHome);
    }
  });

  it('드라이런에서는 skill 파일을 쓰지 않는다', async () => {
    const skillPath = join(await createDirectory(), 'skills', 'complex-prompt', 'SKILL.md');

    const result = await installCodexSkill({ skillPath, dryRun: true });

    expect(result.changed).toBe(true);
    await expect(readFile(skillPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('사용자 소유 skill 파일을 덮어쓰지 않는다', async () => {
    const skillPath = join(await createDirectory(), 'SKILL.md');
    await writeFile(skillPath, 'user skill', 'utf8');

    await expect(installCodexSkill({ skillPath })).rejects.toThrow('not package-owned');
    expect(await readFile(skillPath, 'utf8')).toBe('user skill');
  });

  it('package 소유 skill 파일만 제거한다', async () => {
    const skillPath = join(await createDirectory(), 'SKILL.md');
    await writeFile(skillPath, CODEX_COMPLEX_SKILL_CONTENT, 'utf8');

    const result = await removeCodexSkill({ skillPath });

    expect(result.changed).toBe(true);
    await expect(readFile(skillPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('없는 skill 파일을 제거할 때 변경하지 않는다', async () => {
    const skillPath = join(await createDirectory(), 'SKILL.md');

    const result = await removeCodexSkill({ skillPath });

    expect(result.changed).toBe(false);
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
