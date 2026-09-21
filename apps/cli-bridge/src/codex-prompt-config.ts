import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { defaultCodexHome } from './codex-hook-config.js';

export const CODEX_COMPLEX_PROMPT_NAME = 'complex-prompt';
export const CODEX_COMPLEX_PROMPT_FILE_MARKER = '<!-- codex-complex-prompt:managed -->';

export const CODEX_COMPLEX_PROMPT_CONTENT = `---
description: Draft a complex request and review the resulting Codex response in a browser.
argument-hint: "[PROMPT=<text>]"
---

${CODEX_COMPLEX_PROMPT_FILE_MARKER}
Use the Codex Complex Prompt workflow for the request below.

Treat the supplied arguments as the user's request. If no arguments are supplied, use the
current conversation context. Work through the request normally, and produce a clear final
response or implementation plan. The installed Codex Stop hook will open the browser review
when your response is complete.

Request:
$ARGUMENTS
`;

export interface CodexPromptConfigOptions {
  readonly promptPath?: string;
  readonly dryRun?: boolean;
}

export interface CodexPromptConfigResult {
  readonly promptPath: string;
  readonly changed: boolean;
  readonly content: string;
}

export async function installCodexPrompt(
  options: CodexPromptConfigOptions = {},
): Promise<CodexPromptConfigResult> {
  const promptPath = options.promptPath ?? defaultCodexPromptPath();
  const current = await readOptionalFile(promptPath);
  if (current !== undefined && !isOwnedPrompt(current)) {
    throw new Error(`Codex prompt file already exists and is not package-owned: ${promptPath}`);
  }
  const changed = current !== CODEX_COMPLEX_PROMPT_CONTENT;
  if (changed && options.dryRun !== true) await writePrompt(promptPath);
  return { promptPath, changed, content: CODEX_COMPLEX_PROMPT_CONTENT };
}

export async function removeCodexPrompt(
  options: CodexPromptConfigOptions = {},
): Promise<CodexPromptConfigResult> {
  const promptPath = options.promptPath ?? defaultCodexPromptPath();
  const current = await readOptionalFile(promptPath);
  const owned = current !== undefined && isOwnedPrompt(current);
  if (owned && options.dryRun !== true) await unlink(promptPath);
  return {
    promptPath,
    changed: owned,
    content: current ?? CODEX_COMPLEX_PROMPT_CONTENT,
  };
}

export function defaultCodexPromptPath(): string {
  return join(defaultCodexHome(), 'prompts', `${CODEX_COMPLEX_PROMPT_NAME}.md`);
}

function isOwnedPrompt(content: string): boolean {
  return content.includes(CODEX_COMPLEX_PROMPT_FILE_MARKER);
}

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function writePrompt(promptPath: string): Promise<void> {
  await mkdir(dirname(promptPath), { recursive: true });
  await writeFile(promptPath, CODEX_COMPLEX_PROMPT_CONTENT, 'utf8');
}
