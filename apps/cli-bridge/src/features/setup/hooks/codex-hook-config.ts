import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { defaultCodexHome } from '../../../shared/codex-home.js';
import { CODEX_HOOK_TIMEOUT_SECONDS } from '../../../shared/hook-timeouts.js';
import {
  CodexCommandHookSchema,
  CodexHookGroupSchema,
  CodexHookGroupListSchema,
  CodexHookGroupsSchema,
  CodexHooksFileSchema,
  PlannotatorHookPayloadSchema,
} from './schema.js';

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

/* c8 ignore start -- these helpers defend against malformed third-party config shapes. */
function getHooks(config: Record<string, unknown>): Record<string, unknown> {
  const value = config['hooks'];
  if (value === undefined) return {};
  const result = CodexHookGroupsSchema.safeParse(value);
  if (!result.success) {
    throw new Error('Codex hooks configuration must contain an object under "hooks".');
  }
  return { ...result.data };
}

function parseHookGroupList(value: unknown): unknown[] {
  const result = CodexHookGroupListSchema.safeParse(value);
  return result.success ? [...result.data] : [];
}

function containsOwnCommand(
  group: unknown,
  command: string,
  marker = CODEX_COMPLEX_PROMPT_HOOK_MARKER,
): boolean {
  const parsedGroup = parseHookGroup(group);
  if (parsedGroup === undefined) return false;
  const handlers = parsedGroup.handlers;
  if (handlers === undefined) return false;
  return handlers.some((handler) => {
    const parsedHandler = CodexCommandHookSchema.safeParse(handler);
    return (
      parsedHandler.success &&
      (parsedHandler.data.command === command || parsedHandler.data.statusMessage === marker)
    );
  });
}

function wrapPlannotatorCommands(
  group: unknown,
  wrapperCommand: string,
  wrapperCommandWindows: string | undefined,
): unknown {
  const parsedGroup = parseHookGroup(group);
  if (parsedGroup === undefined) return group;
  const { record, handlers } = parsedGroup;
  if (handlers === undefined) return record;
  const typedHandlers: unknown[] = handlers;
  let changed = false;
  const nextHandlers = typedHandlers.map((handler) => {
    const parsedHandler = CodexCommandHookSchema.safeParse(handler);
    if (!parsedHandler.success || parsedHandler.data.command === undefined) return handler;
    const item = parsedHandler.data as Record<string, unknown>;
    if (item['statusMessage'] === CODEX_COMPLEX_PROMPT_PLANNOTATOR_WRAPPER_MARKER) {
      const original =
        getPlannotatorPayload(parsedHandler.data.command) ??
        (typeof item['commandWindows'] === 'string'
          ? getPlannotatorPayload(item['commandWindows'])
          : undefined);
      if (original === undefined) return handler;
      changed = true;
      return wrapPlannotatorPayload(item, original, wrapperCommand, wrapperCommandWindows);
    }
    const windowsCommand = parsedHandler.data.commandWindows;
    const original = {
      command: parsedHandler.data.command,
      ...(typeof windowsCommand === 'string' ? { commandWindows: windowsCommand } : {}),
      statusMessage: parsedHandler.data.statusMessage,
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
    const result = PlannotatorHookPayloadSchema.safeParse(parsed);
    if (!result.success) return undefined;
    const value = result.data;
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
  return shellCommandContainsPlannotator(command);
}

function shellCommandContainsPlannotator(command: string): boolean {
  const tokens = tokenizeShellCommand(command);
  const segments: string[][] = [[]];
  for (const token of tokens) {
    if (token.operator && [';', '&&', '||', '|', '|&', '&', '(', ')', '\n'].includes(token.value)) {
      segments.push([]);
    } else if (!token.operator) {
      segments[segments.length - 1]?.push(token.value);
    }
  }

  return segments.some((segment) => commandSegmentContainsPlannotator(segment));
}

interface ShellToken {
  readonly value: string;
  readonly operator: boolean;
}

function tokenizeShellCommand(command: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let value = '';
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let tokenStarted = false;

  const pushWord = (): void => {
    if (!tokenStarted) return;
    tokens.push({ value, operator: false });
    value = '';
    tokenStarted = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === undefined) continue;
    if (escaped) {
      value += character;
      tokenStarted = true;
      escaped = false;
      continue;
    }
    if (quote === "'") {
      if (character === "'") quote = undefined;
      else value += character;
      tokenStarted = true;
      continue;
    }
    if (character === '\\' && quote !== '"') {
      escaped = true;
      tokenStarted = true;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = undefined;
      else value += character;
      tokenStarted = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (character === '#') {
      const startsComment = !tokenStarted && (index === 0 || /\s/.test(command[index - 1] ?? ''));
      if (startsComment) {
        while (index < command.length && command[index] !== '\n') index += 1;
        pushWord();
        tokens.push({ value: '\n', operator: true });
        continue;
      }
    }
    if (/\s/.test(character)) {
      pushWord();
      if (character === '\n') tokens.push({ value: '\n', operator: true });
      continue;
    }
    const operator = ['&&', '||', '|&', ';;', ';&', '|', '&', ';', '(', ')'].find((candidate) =>
      command.startsWith(candidate, index),
    );
    if (operator !== undefined) {
      pushWord();
      tokens.push({ value: operator, operator: true });
      index += operator.length - 1;
      continue;
    }
    value += character;
    tokenStarted = true;
  }
  if (escaped) value += '\\';
  pushWord();
  return tokens;
}

function commandSegmentContainsPlannotator(segment: string[]): boolean {
  if (segment.length === 0) return false;
  let commandIndex = 0;
  while (segment[commandIndex] !== undefined && isShellAssignment(segment[commandIndex] ?? '')) {
    commandIndex += 1;
  }
  const executable = segment[commandIndex];
  if (executable === undefined) return false;
  const commandName = getExecutableName(executable);

  if (isPlannotatorExecutable(executable)) {
    return segment[commandIndex + 1]?.toLowerCase() === 'hook';
  }
  if (commandName === 'npx') {
    const executableIndex = getNpxExecutableIndex(segment, commandIndex + 1);
    return (
      executableIndex !== undefined &&
      isPlannotatorExecutable(segment[executableIndex] ?? '') &&
      segment[executableIndex + 1]?.toLowerCase() === 'hook'
    );
  }
  if (['sh', 'bash', 'dash', 'zsh', 'ksh'].includes(commandName)) {
    const commandFlagIndex = segment.findIndex(
      (argument, index) => index > commandIndex && argument === '-c',
    );
    const script = commandFlagIndex < 0 ? undefined : segment[commandFlagIndex + 1];
    return script !== undefined && shellCommandContainsPlannotator(script);
  }
  return false;
}

function getNpxExecutableIndex(segment: string[], startIndex: number): number | undefined {
  let index = startIndex;
  while (index < segment.length) {
    const argument = segment[index] ?? '';
    if (argument === '--') return index + 1;
    if (!argument.startsWith('-')) return index;
    if (['-p', '--package'].includes(argument)) index += 2;
    else index += 1;
  }
  return undefined;
}

function isShellAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function isPlannotatorExecutable(token: string): boolean {
  return getExecutableName(token) === 'plannotator';
}

function getExecutableName(token: string): string {
  const basename = token.toLowerCase().split(/[\\/]/).at(-1) ?? '';
  return basename.replace(/\.(?:cmd|exe|bat)$/, '');
}

function restorePlannotatorCommands(group: unknown): unknown {
  const parsedGroup = parseHookGroup(group);
  if (parsedGroup === undefined) return group;
  const { record, handlers } = parsedGroup;
  if (handlers === undefined) return record;
  const typedHandlers: unknown[] = handlers;
  let changed = false;
  const nextHandlers = typedHandlers.map((handler) => {
    const parsedHandler = CodexCommandHookSchema.safeParse(handler);
    if (!parsedHandler.success) return handler;
    const item = parsedHandler.data as Record<string, unknown>;
    if (
      item['statusMessage'] !== CODEX_COMPLEX_PROMPT_PLANNOTATOR_WRAPPER_MARKER ||
      parsedHandler.data.command === undefined
    )
      return handler;
    const decoded =
      getPlannotatorPayload(parsedHandler.data.command ?? '') ??
      (typeof parsedHandler.data.commandWindows === 'string'
        ? getPlannotatorPayload(parsedHandler.data.commandWindows)
        : undefined);
    if (decoded === undefined) return handler;
    changed = true;
    const restored: Record<string, unknown> = { ...item, command: decoded.command };
    if (decoded.commandWindows !== undefined) restored['commandWindows'] = decoded.commandWindows;
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
  const parsedGroup = parseHookGroup(group);
  if (parsedGroup === undefined) return group as undefined;
  const { record, handlers } = parsedGroup;
  if (handlers === undefined) return record;
  const remaining = handlers.filter((handler) => {
    const parsedHandler = CodexCommandHookSchema.safeParse(handler);
    return !(
      parsedHandler.success &&
      (parsedHandler.data.command === command || parsedHandler.data.statusMessage === marker)
    );
  });
  return remaining.length === 0 ? undefined : { ...record, hooks: remaining };
}

function removeLegacyStopHooks(hooks: Record<string, unknown>): void {
  const stopHooks = hooks['Stop'];
  const parsedStopHooks = CodexHookGroupListSchema.safeParse(stopHooks);
  if (!parsedStopHooks.success) return;
  hooks['Stop'] = parsedStopHooks.data
    .map((group: unknown) => removeHandlers(group, isLegacyStopHook))
    .filter((group: Record<string, unknown> | undefined) => group !== undefined);
}

function removeHandlers(
  group: unknown,
  shouldRemove: (handler: unknown) => boolean,
): Record<string, unknown> | undefined {
  const parsedGroup = parseHookGroup(group);
  if (parsedGroup === undefined) return group as undefined;
  const { record, handlers } = parsedGroup;
  if (handlers === undefined) return record;
  const remaining = handlers.filter((handler) => !shouldRemove(handler));
  return remaining.length === 0 ? undefined : { ...record, hooks: remaining };
}

function parseHookGroup(
  group: unknown,
): { readonly record: Record<string, unknown>; readonly handlers?: unknown[] } | undefined {
  const result = CodexHookGroupSchema.safeParse(group);
  if (!result.success) return undefined;
  const hooks = CodexHookGroupListSchema.safeParse(result.data['hooks']);
  return {
    record: result.data,
    ...(hooks.success ? { handlers: hooks.data } : {}),
  };
}

function isLegacyStopHook(handler: unknown): boolean {
  const result = CodexCommandHookSchema.safeParse(handler);
  if (!result.success) return false;
  if (result.data.statusMessage === CODEX_COMPLEX_PROMPT_LEGACY_STOP_HOOK_MARKER) return true;
  const command = result.data.command;
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
