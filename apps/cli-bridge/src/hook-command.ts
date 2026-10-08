import { PlannotatorHookPayloadSchema } from './features/setup/hooks/schema.js';
import { runCodexUserPromptHook } from './features/input/hooks/codex-user-prompt-hook.js';
import { runCodexStopHook } from './features/feedback/hooks/codex-stop-hook.js';
import { runCodexPlannotatorStopHook } from './features/feedback/hooks/codex-plannotator-stop-hook.js';

export async function runHookCommand(args: readonly string[]): Promise<boolean> {
  if (args[0] === 'hook' && args[1] === 'prompt' && args.length === 2) {
    const input = await readStdin();
    const result = await runCodexUserPromptHook(input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return true;
  }
  if (args[0] === 'hook' && args[1] === 'stop' && args.length === 2) {
    const input = await readStdin();
    const result = await runCodexStopHook(input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return true;
  }
  if (args[0] === 'hook' && args[1] === 'plannotator-stop' && args.length === 3) {
    const originalCommand = PlannotatorHookPayloadSchema.parse(
      JSON.parse(Buffer.from(args[2] ?? '', 'base64url').toString('utf8')),
    );
    const command =
      process.platform === 'win32' && typeof originalCommand.commandWindows === 'string'
        ? originalCommand.commandWindows
        : originalCommand.command;
    if (typeof command !== 'string')
      throw new Error('The original Plannotator command is invalid.');
    const result = await runCodexPlannotatorStopHook(await readStdin(), command);
    if (result.skipped) process.stdout.write('{"continue":true}\n');
    else if (result.exitCode !== undefined) process.exitCode = result.exitCode;
    return true;
  }
  return false;
}

export function hookPromptCommand(): string {
  const entrypoint = process.argv[1];
  return entrypoint === undefined
    ? 'complex-prompt hook prompt'
    : `${quoteShell(entrypoint)} hook prompt`;
}

export function hookStopCommand(): string {
  const entrypoint = process.argv[1];
  return entrypoint === undefined
    ? 'complex-prompt hook stop'
    : `${quoteShell(entrypoint)} hook stop`;
}

export function hookPlannotatorStopCommand(): string {
  const entrypoint = process.argv[1];
  return entrypoint === undefined
    ? 'complex-prompt hook plannotator-stop'
    : `${quoteShell(entrypoint)} hook plannotator-stop`;
}

export function hookWindowsCommand(subcommand: string): string {
  const entrypoint = process.argv[1];
  return entrypoint === undefined
    ? `complex-prompt hook ${subcommand}`
    : `${quoteWindows(process.execPath)} ${quoteWindows(entrypoint)} hook ${subcommand}`;
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function quoteWindows(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function readStdin(): Promise<string> {
  let input = '';
  for await (const chunk of process.stdin as AsyncIterable<string | Buffer>) {
    input += typeof chunk === 'string' ? chunk : chunk.toString();
  }
  return input;
}
