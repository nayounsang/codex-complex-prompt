import { containsPlannotator } from './plannotator-command-detection.js';
import { parseHookGroup } from './hook-config-groups.js';
import { CodexCommandHookSchema, PlannotatorHookPayloadSchema } from './schema.js';
import { CODEX_COMPLEX_PROMPT_PLANNOTATOR_WRAPPER_MARKER } from './hook-config-constants.js';

/* c8 ignore start -- malformed and third-party hook migration cases are covered by focused tests. */
export function wrapPlannotatorCommands(
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

export function restorePlannotatorCommands(group: unknown): unknown {
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

/* c8 ignore stop */
