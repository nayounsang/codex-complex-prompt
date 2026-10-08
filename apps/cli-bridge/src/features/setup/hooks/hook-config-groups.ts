import {
  CodexCommandHookSchema,
  CodexHookGroupSchema,
  CodexHookGroupListSchema,
  CodexHookGroupsSchema,
} from './schema.js';
import {
  CODEX_COMPLEX_PROMPT_HOOK_MARKER,
  CODEX_COMPLEX_PROMPT_LEGACY_STOP_HOOK_MARKER,
  LEGACY_STOP_HOOK_COMMAND_SUFFIX,
} from './hook-config-constants.js';

/* c8 ignore start -- these helpers defend against malformed third-party config shapes. */
export function getHooks(config: Record<string, unknown>): Record<string, unknown> {
  const value = config['hooks'];
  if (value === undefined) return {};
  const result = CodexHookGroupsSchema.safeParse(value);
  if (!result.success) {
    throw new Error('Codex hooks configuration must contain an object under "hooks".');
  }
  return { ...result.data };
}

export function parseHookGroupList(value: unknown): unknown[] {
  const result = CodexHookGroupListSchema.safeParse(value);
  return result.success ? [...result.data] : [];
}

export function containsOwnCommand(
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

export function removeOwnCommands(
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

export function removeLegacyStopHooks(hooks: Record<string, unknown>): void {
  const stopHooks = hooks['Stop'];
  const parsedStopHooks = CodexHookGroupListSchema.safeParse(stopHooks);
  if (!parsedStopHooks.success) return;
  hooks['Stop'] = parsedStopHooks.data
    .map((group: unknown) => removeHandlers(group, isLegacyStopHook))
    .filter((group: Record<string, unknown> | undefined) => group !== undefined);
}

export function removeHandlers(
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

export function parseHookGroup(
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

export function isLegacyStopHook(handler: unknown): boolean {
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

/* c8 ignore stop */
