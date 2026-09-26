import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { defaultCodexHome } from '../../../shared/codex-home.js';
import { CODEX_HOOK_TIMEOUT_SECONDS } from '../../../shared/hook-timeouts.js';

export const CODEX_COMPLEX_PROMPT_HOOK_MARKER = 'Codex Complex Prompt command editor';
export const CODEX_COMPLEX_PROMPT_STOP_HOOK_MARKER = 'Codex Complex Prompt feedback editor';
export const CODEX_COMPLEX_PROMPT_PLANNOTATOR_WRAPPER_MARKER =
  'Codex Complex Prompt conditional Plannotator hook';
export const CODEX_COMPLEX_PROMPT_LEGACY_STOP_HOOK_MARKER = 'Codex Complex Prompt browser review';
const LEGACY_STOP_HOOK_COMMAND_SUFFIX = ' hook stop';

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
        ...(options.commandWindows === undefined ? {} : { commandWindows: options.commandWindows }),
        timeout: CODEX_HOOK_TIMEOUT_SECONDS,
        statusMessage: CODEX_COMPLEX_PROMPT_HOOK_MARKER,
      },
    ],
  });
  hooks['UserPromptSubmit'] = nextUserPromptHooks;
  const stopHooks = Array.isArray(hooks['Stop']) ? [...hooks['Stop']] : [];
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
  const userPromptHooks = Array.isArray(hooks['UserPromptSubmit'])
    ? [...hooks['UserPromptSubmit']]
    : [];
  const nextUserPromptHooks = userPromptHooks
    .map((group) => removeOwnCommands(group, command))
    .filter((group) => group !== undefined);
  hooks['UserPromptSubmit'] = nextUserPromptHooks;
  const stopHooks = Array.isArray(hooks['Stop']) ? [...hooks['Stop']] : [];
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

function containsOwnCommand(
  group: unknown,
  command: string,
  marker = CODEX_COMPLEX_PROMPT_HOOK_MARKER,
): boolean {
  if (group === null || typeof group !== 'object' || Array.isArray(group)) return false;
  const handlers = (group as Record<string, unknown>)['hooks'];
  if (!Array.isArray(handlers)) return false;
  return handlers.some(
    (handler) =>
      handler !== null &&
      typeof handler === 'object' &&
      (handler as Record<string, unknown>)['type'] === 'command' &&
      ((handler as Record<string, unknown>)['command'] === command ||
        (handler as Record<string, unknown>)['statusMessage'] === marker),
  );
}

function wrapPlannotatorCommands(
  group: unknown,
  wrapperCommand: string,
  wrapperCommandWindows: string | undefined,
): unknown {
  if (group === null || typeof group !== 'object' || Array.isArray(group)) return group;
  const record = group as Record<string, unknown>;
  const handlers = record['hooks'];
  if (!Array.isArray(handlers)) return record;
  const typedHandlers: unknown[] = handlers;
  let changed = false;
  const nextHandlers = typedHandlers.map((handler) => {
    if (handler === null || typeof handler !== 'object' || Array.isArray(handler)) return handler;
    const item = handler as Record<string, unknown>;
    if (item['type'] !== 'command' || typeof item['command'] !== 'string') return handler;
    if (item['statusMessage'] === CODEX_COMPLEX_PROMPT_PLANNOTATOR_WRAPPER_MARKER) {
      const original =
        getPlannotatorPayload(item['command']) ??
        (typeof item['commandWindows'] === 'string'
          ? getPlannotatorPayload(item['commandWindows'])
          : undefined);
      if (original === undefined) return handler;
      changed = true;
      return wrapPlannotatorPayload(item, original, wrapperCommand, wrapperCommandWindows);
    }
    const windowsCommand = item['commandWindows'];
    const original = {
      command: item['command'],
      ...(typeof windowsCommand === 'string' ? { commandWindows: windowsCommand } : {}),
      statusMessage: item['statusMessage'],
    };
    const wrapsCommand = containsPlannotator(original.command);
    const wrapsWindowsCommand =
      wrapperCommandWindows !== undefined &&
      containsPlannotator(original.commandWindows ?? original.command);
    if (!wrapsCommand && !wrapsWindowsCommand) return handler;
    changed = true;
    return wrapPlannotatorPayload(item, original, wrapperCommand, wrapperCommandWindows);
  });
  return changed ? { ...record, hooks: nextHandlers } : record;
}

function wrapPlannotatorPayload(
  item: Record<string, unknown>,
  original: { command: string; commandWindows?: string; statusMessage?: unknown },
  wrapperCommand: string,
  wrapperCommandWindows: string | undefined,
): Record<string, unknown> {
  const payload = Buffer.from(JSON.stringify(original), 'utf8').toString('base64url');
  const wrapsCommand = containsPlannotator(original.command);
  const wrapsWindowsCommand =
    wrapperCommandWindows !== undefined &&
    containsPlannotator(original.commandWindows ?? original.command);
  return {
    ...item,
    ...(wrapsCommand ? { command: `${wrapperCommand} ${payload}` } : {}),
    ...(wrapsWindowsCommand ? { commandWindows: `${wrapperCommandWindows} ${payload}` } : {}),
    statusMessage: CODEX_COMPLEX_PROMPT_PLANNOTATOR_WRAPPER_MARKER,
  };
}

function getPlannotatorPayload(
  command: string,
): { command: string; commandWindows?: string; statusMessage?: unknown } | undefined {
  const payloadSeparator = command.lastIndexOf(' ');
  if (payloadSeparator < 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(command.slice(payloadSeparator + 1), 'base64url').toString('utf8'),
    );
    if (parsed === null || typeof parsed !== 'object' || !('command' in parsed)) return undefined;
    const value = parsed as {
      command?: unknown;
      commandWindows?: unknown;
      statusMessage?: unknown;
    };
    if (typeof value.command !== 'string') return undefined;
    return {
      command: value.command,
      ...(typeof value.commandWindows === 'string' ? { commandWindows: value.commandWindows } : {}),
      statusMessage: value.statusMessage,
    };
  } catch {
    return undefined;
  }
}

function containsPlannotator(command: string): boolean {
  return command.toLowerCase().includes('plannotator');
}

function restorePlannotatorCommands(group: unknown): unknown {
  if (group === null || typeof group !== 'object' || Array.isArray(group)) return group;
  const record = group as Record<string, unknown>;
  const handlers = record['hooks'];
  if (!Array.isArray(handlers)) return record;
  const typedHandlers: unknown[] = handlers;
  let changed = false;
  const nextHandlers = typedHandlers.map((handler) => {
    if (handler === null || typeof handler !== 'object' || Array.isArray(handler)) return handler;
    const item = handler as Record<string, unknown>;
    if (
      item['type'] !== 'command' ||
      item['statusMessage'] !== CODEX_COMPLEX_PROMPT_PLANNOTATOR_WRAPPER_MARKER ||
      typeof item['command'] !== 'string'
    )
      return handler;
    const decoded =
      getPlannotatorPayload(item['command']) ??
      (typeof item['commandWindows'] === 'string'
        ? getPlannotatorPayload(item['commandWindows'])
        : undefined);
    if (decoded === undefined) return handler;
    changed = true;
    const restored: Record<string, unknown> = { ...item, command: decoded.command };
    if (typeof decoded.commandWindows === 'string')
      restored['commandWindows'] = decoded.commandWindows;
    else delete restored['commandWindows'];
    if (typeof decoded.statusMessage === 'string')
      restored['statusMessage'] = decoded.statusMessage;
    else delete restored['statusMessage'];
    return restored;
  });
  return changed ? { ...record, hooks: nextHandlers } : record;
}

function removeOwnCommands(
  group: unknown,
  command: string,
  marker = CODEX_COMPLEX_PROMPT_HOOK_MARKER,
): Record<string, unknown> | undefined {
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
          (handler as Record<string, unknown>)['statusMessage'] === marker)
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

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
/* c8 ignore stop */

export { defaultCodexHome } from '../../../shared/codex-home.js';
