import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { defaultCodexHome } from '../../../shared/codex-home.js';

export const CODEX_COMPLEX_PROMPT_NAME = 'complex-prompt';
export const CODEX_COMPLEX_PROMPT_FILE_MARKER = '<!-- codex-complex-prompt:managed -->';
export const CODEX_COMPLEX_SKILL_FILE_MARKER = '<!-- codex-complex-prompt:skill-managed -->';

export const CODEX_COMPLEX_PROMPT_CONTENT = `---
description: Open a browser command editor and send a complex command to Codex.
argument-hint: "[PROMPT=<text>]"
---

${CODEX_COMPLEX_PROMPT_FILE_MARKER}
This is a browser-only command entrypoint. Do not analyze or answer this request before the
UserPromptSubmit hook returns. Execute the command in its additionalContext. If it contains an AI
Feedback request, apply it to the complete Current Markdown included with that request and return
the complete revised Markdown only, without a summary or code fence. The Stop hook will reopen the
browser editor with your response. Continue the feedback loop when the user chooses Send Feedback;
when the user chooses Submit, treat the accepted Markdown as the final request and execute its
command without reopening the browser.
`;

export const CODEX_COMPLEX_SKILL_CONTENT = `---
name: ${CODEX_COMPLEX_PROMPT_NAME}
description: Open the browser command editor for complex requests and send one command to Codex.
---

${CODEX_COMPLEX_SKILL_FILE_MARKER}
This is a browser-only command entrypoint. Do not analyze or answer the request before the installed
UserPromptSubmit hook returns. Execute the command in its additionalContext. If it contains an AI
Feedback request, apply it to the complete Current Markdown included with that request and return
the complete revised Markdown only, without a summary or code fence. The Stop hook will reopen the
browser editor with your response. Continue the feedback loop when the user chooses Send Feedback;
when the user chooses Submit, treat the accepted Markdown as the final request and execute its
command without reopening the browser.
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

export interface CodexSkillConfigOptions {
  readonly skillPath?: string;
  readonly dryRun?: boolean;
}

export interface CodexSkillConfigResult {
  readonly skillPath: string;
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

export async function installCodexSkill(
  options: CodexSkillConfigOptions = {},
): Promise<CodexSkillConfigResult> {
  const skillPath = options.skillPath ?? defaultCodexSkillPath();
  const current = await readOptionalFile(skillPath);
  if (current !== undefined && !isOwnedSkill(current)) {
    throw new Error(`Codex skill file already exists and is not package-owned: ${skillPath}`);
  }
  const changed = current !== CODEX_COMPLEX_SKILL_CONTENT;
  if (changed && options.dryRun !== true) await writeSkill(skillPath);
  return { skillPath, changed, content: CODEX_COMPLEX_SKILL_CONTENT };
}

export async function removeCodexSkill(
  options: CodexSkillConfigOptions = {},
): Promise<CodexSkillConfigResult> {
  const skillPath = options.skillPath ?? defaultCodexSkillPath();
  const current = await readOptionalFile(skillPath);
  const owned = current !== undefined && isOwnedSkill(current);
  if (owned && options.dryRun !== true) await unlink(skillPath);
  return {
    skillPath,
    changed: owned,
    content: current ?? CODEX_COMPLEX_SKILL_CONTENT,
  };
}

export function defaultCodexPromptPath(): string {
  return join(defaultCodexHome(), 'prompts', `${CODEX_COMPLEX_PROMPT_NAME}.md`);
}

export function defaultCodexSkillPath(): string {
  return join(defaultCodexHome(), 'skills', CODEX_COMPLEX_PROMPT_NAME, 'SKILL.md');
}

function isOwnedPrompt(content: string): boolean {
  return content.includes(CODEX_COMPLEX_PROMPT_FILE_MARKER);
}

function isOwnedSkill(content: string): boolean {
  return content.includes(CODEX_COMPLEX_SKILL_FILE_MARKER);
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

async function writeSkill(skillPath: string): Promise<void> {
  await mkdir(dirname(skillPath), { recursive: true });
  await writeFile(skillPath, CODEX_COMPLEX_SKILL_CONTENT, 'utf8');
}
