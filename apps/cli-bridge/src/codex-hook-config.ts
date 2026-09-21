import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const CODEX_COMPLEX_PROMPT_HOOK_MARKER = 'Codex Complex Prompt command editor';
export const CODEX_COMPLEX_PROMPT_LEGACY_STOP_HOOK_MARKER = 'Codex Complex Prompt browser review';
const LEGACY_STOP_HOOK_COMMAND_SUFFIX = ' hook stop';

export interface CodexHookConfigOptions {
  readonly configPath?: string;
  readonly command?: string;
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
  const config = await readHooksConfig(configPath);
  const hooks = getHooks(config);
  const userPromptHooks = Array.isArray(hooks['UserPromptSubmit'])
    ? [...hooks['UserPromptSubmit']]
    : [];
  const nextUserPromptHooks = userPromptHooks.filter(
    (group) => !containsOwnCommand(group, command),
  );
  nextUserPromptHooks.push({
    hooks: [
      {
        type: 'command',
        command,
        timeout: 120,
        statusMessage: CODEX_COMPLEX_PROMPT_HOOK_MARKER,
      },
    ],
  });
  hooks['UserPromptSubmit'] = nextUserPromptHooks;
  removeLegacyStopHooks(hooks);
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
  const config = await readHooksConfig(configPath);
  const hooks = getHooks(config);
  const userPromptHooks = Array.isArray(hooks['UserPromptSubmit'])
    ? [...hooks['UserPromptSubmit']]
    : [];
  const nextUserPromptHooks = userPromptHooks
    .map((group) => removeOwnCommands(group, command))
    .filter((group) => group !== undefined);
  hooks['UserPromptSubmit'] = nextUserPromptHooks;
  removeLegacyStopHooks(hooks);
  const nextConfig = { ...config, hooks };
  const changed = JSON.stringify(config) !== JSON.stringify(nextConfig);
  if (changed && options.dryRun !== true) await writeHooksConfig(configPath, nextConfig);
  return { configPath, changed, config: nextConfig, command };
}

export function defaultHooksPath(): string {
  return join(defaultCodexHome(), 'hooks.json');
}

export function defaultCodexHome(): string {
  return process.env['CODEX_HOME'] ?? join(homedir(), '.codex');
}

async function readHooksConfig(configPath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Codex hooks file must contain a JSON object: ${configPath}`);
    }
    return parsed as Record<string, unknown>;
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

/* c8 ignore start -- these helpers defend against malformed third-party config shapes. */
function getHooks(config: Record<string, unknown>): Record<string, unknown[]> {
  const value = config['hooks'];
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Codex hooks configuration must contain an object under "hooks".');
  }
  return { ...(value as Record<string, unknown[]>) };
}

function containsOwnCommand(group: unknown, command: string): boolean {
  if (group === null || typeof group !== 'object' || Array.isArray(group)) return false;
  const handlers = (group as Record<string, unknown>)['hooks'];
  if (!Array.isArray(handlers)) return false;
  return handlers.some(
    (handler) =>
      handler !== null &&
      typeof handler === 'object' &&
      (handler as Record<string, unknown>)['type'] === 'command' &&
      ((handler as Record<string, unknown>)['command'] === command ||
        isOwnStatusMessage((handler as Record<string, unknown>)['statusMessage'])),
  );
}

function removeOwnCommands(group: unknown, command: string): Record<string, unknown> | undefined {
  if (group === null || typeof group !== 'object' || Array.isArray(group))
    return group as undefined;
  const record = group as Record<string, unknown>;
  const handlers = record['hooks'];
  if (!Array.isArray(handlers)) return record;
  const remaining = handlers.filter(
    (handler) =>
      !(
        handler !== null &&
        typeof handler === 'object' &&
        (handler as Record<string, unknown>)['type'] === 'command' &&
        ((handler as Record<string, unknown>)['command'] === command ||
          isOwnStatusMessage((handler as Record<string, unknown>)['statusMessage']))
      ),
  );
  return remaining.length === 0 ? undefined : { ...record, hooks: remaining };
}

function removeLegacyStopHooks(hooks: Record<string, unknown[]>): void {
  const stopHooks = hooks['Stop'];
  if (!Array.isArray(stopHooks)) return;
  hooks['Stop'] = stopHooks
    .map((group) => removeHandlers(group, isLegacyStopHook))
    .filter((group) => group !== undefined);
}

function removeHandlers(
  group: unknown,
  shouldRemove: (handler: unknown) => boolean,
): Record<string, unknown> | undefined {
  if (group === null || typeof group !== 'object' || Array.isArray(group))
    return group as undefined;
  const record = group as Record<string, unknown>;
  const handlers = record['hooks'];
  if (!Array.isArray(handlers)) return record;
  const remaining = handlers.filter((handler) => !shouldRemove(handler));
  return remaining.length === 0 ? undefined : { ...record, hooks: remaining };
}

function isLegacyStopHook(handler: unknown): boolean {
  if (handler === null || typeof handler !== 'object' || Array.isArray(handler)) return false;
  const record = handler as Record<string, unknown>;
  if (record['type'] !== 'command') return false;
  if (record['statusMessage'] === CODEX_COMPLEX_PROMPT_LEGACY_STOP_HOOK_MARKER) return true;
  const command = record['command'];
  return (
    typeof command === 'string' &&
    command.includes('complex-prompt') &&
    command.endsWith(LEGACY_STOP_HOOK_COMMAND_SUFFIX)
  );
}

function isOwnStatusMessage(value: unknown): boolean {
  return value === CODEX_COMPLEX_PROMPT_HOOK_MARKER;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
/* c8 ignore stop */
