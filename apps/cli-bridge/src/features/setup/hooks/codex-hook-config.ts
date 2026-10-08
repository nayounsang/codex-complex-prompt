import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { defaultCodexHome } from '../../../shared/codex-home.js';
import { CODEX_HOOK_TIMEOUT_SECONDS } from '../../../shared/hook-timeouts.js';
import {
  containsOwnCommand,
  getHooks,
  parseHookGroupList,
  removeLegacyStopHooks,
  removeOwnCommands,
} from './hook-config-groups.js';
import { wrapPlannotatorCommands, restorePlannotatorCommands } from './plannotator-hook-config.js';
import {
  CODEX_COMPLEX_PROMPT_HOOK_MARKER,
  CODEX_COMPLEX_PROMPT_STOP_HOOK_MARKER,
} from './hook-config-constants.js';
export {
  CODEX_COMPLEX_PROMPT_HOOK_MARKER,
  CODEX_COMPLEX_PROMPT_STOP_HOOK_MARKER,
  CODEX_COMPLEX_PROMPT_PLANNOTATOR_WRAPPER_MARKER,
  CODEX_COMPLEX_PROMPT_LEGACY_STOP_HOOK_MARKER,
} from './hook-config-constants.js';
import { CodexHooksFileSchema } from './schema.js';

export interface CodexHookConfigOptions {
  readonly configPath?: string;
  readonly command?: string;
  readonly commandWindows?: string;
  readonly stopCommand?: string;
  readonly stopCommandWindows?: string;
  readonly plannotatorStopCommand?: string;
  readonly plannotatorStopCommandWindows?: string;
  readonly dryRun?: boolean;
}

export interface CodexHookConfigResult {
  readonly configPath: string;
  readonly changed: boolean;
  readonly config: Record<string, unknown>;
  readonly command: string;
}

export async function installCodexUserPromptHook(
  options: CodexHookConfigOptions = {},
): Promise<CodexHookConfigResult> {
  const configPath = options.configPath ?? defaultHooksPath();
  const command = options.command ?? 'complex-prompt hook prompt';
  const stopCommand = options.stopCommand ?? 'complex-prompt hook stop';
  const plannotatorStopCommand =
    options.plannotatorStopCommand ?? 'complex-prompt hook plannotator-stop';
  const plannotatorStopCommandWindows = options.plannotatorStopCommandWindows;
  const config = await readHooksConfig(configPath);
  const hooks = getHooks(config);
  removeLegacyStopHooks(hooks);
  const userPromptHooks = parseHookGroupList(hooks['UserPromptSubmit']);
  const nextUserPromptHooks = userPromptHooks.filter(
    (group) => !containsOwnCommand(group, command),
  );
  nextUserPromptHooks.push({
    hooks: [
      {
        type: 'command',
        command,
        ...(options.commandWindows === undefined ? {} : { commandWindows: options.commandWindows }),
        timeout: CODEX_HOOK_TIMEOUT_SECONDS,
        statusMessage: CODEX_COMPLEX_PROMPT_HOOK_MARKER,
      },
    ],
  });
  hooks['UserPromptSubmit'] = nextUserPromptHooks;
  const stopHooks = parseHookGroupList(hooks['Stop']);
  const wrappedStopHooks = stopHooks.map((group) =>
    wrapPlannotatorCommands(group, plannotatorStopCommand, plannotatorStopCommandWindows),
  );
  hooks['Stop'] = wrappedStopHooks;
  const nextStopHooks = wrappedStopHooks.filter(
    (group) => !containsOwnCommand(group, stopCommand, CODEX_COMPLEX_PROMPT_STOP_HOOK_MARKER),
  );
  nextStopHooks.push({
    hooks: [
      {
        type: 'command',
        command: stopCommand,
        ...(options.stopCommandWindows === undefined
          ? {}
          : { commandWindows: options.stopCommandWindows }),
        timeout: CODEX_HOOK_TIMEOUT_SECONDS,
        statusMessage: CODEX_COMPLEX_PROMPT_STOP_HOOK_MARKER,
      },
    ],
  });
  hooks['Stop'] = nextStopHooks;
  const nextConfig = { ...config, hooks };
  const changed = JSON.stringify(config) !== JSON.stringify(nextConfig);
  if (changed && options.dryRun !== true) await writeHooksConfig(configPath, nextConfig);
  return { configPath, changed, config: nextConfig, command };
}

export async function removeCodexUserPromptHook(
  options: CodexHookConfigOptions = {},
): Promise<CodexHookConfigResult> {
  const configPath = options.configPath ?? defaultHooksPath();
  const command = options.command ?? 'complex-prompt hook prompt';
  const stopCommand = options.stopCommand ?? 'complex-prompt hook stop';
  const config = await readHooksConfig(configPath);
  const hooks = getHooks(config);
  const userPromptHooks = parseHookGroupList(hooks['UserPromptSubmit']);
  const nextUserPromptHooks = userPromptHooks
    .map((group) => removeOwnCommands(group, command))
    .filter((group) => group !== undefined);
  hooks['UserPromptSubmit'] = nextUserPromptHooks;
  const stopHooks = parseHookGroupList(hooks['Stop']);
  hooks['Stop'] = stopHooks
    .map((group) => restorePlannotatorCommands(group))
    .map((group) => removeOwnCommands(group, stopCommand, CODEX_COMPLEX_PROMPT_STOP_HOOK_MARKER))
    .filter((group) => group !== undefined);
  removeLegacyStopHooks(hooks);
  const nextConfig = { ...config, hooks };
  const changed = JSON.stringify(config) !== JSON.stringify(nextConfig);
  if (changed && options.dryRun !== true) await writeHooksConfig(configPath, nextConfig);
  return { configPath, changed, config: nextConfig, command };
}

export function defaultHooksPath(): string {
  return join(defaultCodexHome(), 'hooks.json');
}

async function readHooksConfig(configPath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(configPath, 'utf8');
    const result = CodexHooksFileSchema.safeParse(JSON.parse(raw));
    if (!result.success) {
      throw new Error(`Codex hooks file must contain a JSON object: ${configPath}`);
    }
    return result.data;
  } catch (error) {
    if (isMissingFile(error)) return {};
    if (error instanceof SyntaxError)
      throw new Error(`Codex hooks file is not valid JSON: ${configPath}`);
    throw error;
  }
}

async function writeHooksConfig(
  configPath: string,
  config: Record<string, unknown>,
): Promise<void> {
  await import('node:fs/promises').then(({ mkdir }) =>
    mkdir(dirname(configPath), { recursive: true }),
  );
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
/* c8 ignore stop */

export { defaultCodexHome } from '../../../shared/codex-home.js';
