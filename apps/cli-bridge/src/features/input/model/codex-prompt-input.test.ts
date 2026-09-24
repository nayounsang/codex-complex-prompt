import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveInitialMarkdown } from './codex-prompt-input.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe('복합 명령 초기 Markdown 입력 resolver', () => {
  it('자연어 입력을 앞뒤 공백 없이 초기 Markdown으로 반환한다', async () => {
    const result = await resolveInitialMarkdown('  테스트를 실행해줘  ');

    expect(result).toBe('테스트를 실행해줘');
  });

  it('URL 입력을 원문으로 반환한다', async () => {
    const result = await resolveInitialMarkdown('https://example.com/guide.md');

    expect(result).toBe('https://example.com/guide.md');
  });

  it('복합 입력 전체를 초기 Markdown으로 반환한다', async () => {
    const result = await resolveInitialMarkdown('이슈 #42를 조사하고 수정 계획을 작성해줘');

    expect(result).toBe('이슈 #42를 조사하고 수정 계획을 작성해줘');
  });

  it('현재 작업 디렉터리의 Markdown 파일 내용을 초기 Markdown으로 읽는다', async () => {
    const directory = await createTemporaryDirectory();
    const content = '# 파일 입력\n\n한글과 `특수문자`를 보존한다.';
    await writeFile(join(directory, 'prompt.md'), content, 'utf8');
    mockWorkingDirectory(directory);

    const result = await resolveInitialMarkdown('prompt.md');

    expect(result).toBe(content);
  });

  it('hook cwd를 기준으로 상대 Markdown 파일 경로를 읽는다', async () => {
    const directory = await createTemporaryDirectory();
    const content = '# Codex 프로젝트 입력';
    await writeFile(join(directory, 'task.md'), content, 'utf8');
    vi.spyOn(process, 'cwd').mockReturnValue('/unrelated/cli-directory');

    const result = await resolveInitialMarkdown('task.md', directory);

    expect(result).toBe(content);
  });

  it('현재 작업 디렉터리의 텍스트 파일 내용을 초기 Markdown으로 읽는다', async () => {
    const directory = await createTemporaryDirectory();
    const content = '첫 줄\n둘째 줄\n특수문자: <>&';
    await writeFile(join(directory, 'prompt.txt'), content, 'utf8');
    mockWorkingDirectory(directory);

    const result = await resolveInitialMarkdown('prompt.txt');

    expect(result).toBe(content);
  });

  it('존재하지 않는 파일 경로를 초기 Markdown 원문으로 반환한다', async () => {
    const directory = await createTemporaryDirectory();
    mockWorkingDirectory(directory);

    const result = await resolveInitialMarkdown('missing.md');

    expect(result).toBe('missing.md');
  });

  it('읽을 수 없는 파일 경로를 초기 Markdown 원문으로 반환한다', async () => {
    const directory = await createTemporaryDirectory();
    await mkdir(join(directory, 'directory.md'));
    mockWorkingDirectory(directory);

    const result = await resolveInitialMarkdown('directory.md');

    expect(result).toBe('directory.md');
  });

  it('파일 내용을 12,000자에서 뒤부터 자른다', async () => {
    const directory = await createTemporaryDirectory();
    const content = '가'.repeat(12_000) + '뒤에서 제거할 내용';
    await writeFile(join(directory, 'long.md'), content, 'utf8');
    mockWorkingDirectory(directory);

    const result = await resolveInitialMarkdown('long.md');

    expect(result).toBe('가'.repeat(12_000));
  });

  it('일반 입력을 12,000자에서 뒤부터 자른다', async () => {
    const input = 'x'.repeat(12_000) + '뒤에서 제거할 내용';

    const result = await resolveInitialMarkdown(input);

    expect(result).toBe('x'.repeat(12_000));
  });

  it('Codex CLI와 같은 Unicode code point 기준으로 자른다', async () => {
    const input = '😀'.repeat(12_000) + '뒤에서 제거할 내용';

    const result = await resolveInitialMarkdown(input);

    expect(result).toBe('😀'.repeat(12_000));
  });

  it('파일을 읽어도 원본 파일을 변경하지 않는다', async () => {
    const directory = await createTemporaryDirectory();
    const filePath = join(directory, 'unchanged.txt');
    const content = '원본 파일은 제출 과정에서 변경되지 않는다.';
    await writeFile(filePath, content, 'utf8');
    mockWorkingDirectory(directory);

    await resolveInitialMarkdown('unchanged.txt');

    await expect(readFile(filePath, 'utf8')).resolves.toBe(content);
  });
});

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'codex-complex-prompt-input-'));
  temporaryDirectories.push(directory);
  return directory;
}

function mockWorkingDirectory(directory: string): void {
  vi.spyOn(process, 'cwd').mockReturnValue(directory);
}
