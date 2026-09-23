#!/usr/bin/env node

import { existsSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import open from 'open';

import {
  startLocalBridgeServer,
  type RunningLocalBridgeServer,
} from '@codex-complex-prompt/server';

import {
  CodexSessionInputAdapter,
  type CodexSessionInputContext,
  type CodexSessionInput,
} from './adapters/codex-session-input.js';
import { installCodexUserPromptHook, removeCodexUserPromptHook } from './codex-hook-config.js';
import {
  CODEX_COMPLEX_PROMPT_NAME,
  installCodexSkill,
  installCodexPrompt,
  removeCodexSkill,
  removeCodexPrompt,
} from './codex-prompt-config.js';
import { runCodexUserPromptHook } from './features/input/codex-user-prompt-hook.js';
import { runCodexStopHook } from './features/feedback/codex-stop-hook.js';

export interface CliBridgeOptions {
  readonly inputAdapter?: CodexSessionInput;
  readonly initialMarkdown?: string;
  readonly feedbackLoop?: boolean;
  readonly openBrowser?: (url: string) => Promise<void>;
  readonly webUrl?: string;
  readonly port?: number;
  readonly sessionTtlMs?: number;
  readonly promptTimeoutMs?: number;
  readonly staticDir?: string;
}

export interface RunningCliBridge {
  readonly server: RunningLocalBridgeServer;
  readonly browserUrl: string;
  readonly browserOpened: boolean;
  readonly stop: () => Promise<void>;
}

export async function startCliBridge(options: CliBridgeOptions = {}): Promise<RunningCliBridge> {
  const webUrl = options.webUrl === undefined ? undefined : validateWebUrl(options.webUrl);
  const inputAdapter = options.inputAdapter ?? new CodexSessionInputAdapter();
  const staticDir = options.staticDir ?? resolveStaticDir();
  const serverOptions = {
    onPrompt: (prompt: string, context: CodexSessionInputContext) =>
      inputAdapter.submit(prompt, context),
    ...(staticDir === undefined ? {} : { staticDir }),
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.sessionTtlMs === undefined ? {} : { ttlMs: options.sessionTtlMs }),
    ...(options.promptTimeoutMs === undefined ? {} : { promptTimeoutMs: options.promptTimeoutMs }),
    ...(options.initialMarkdown === undefined ? {} : { initialMarkdown: options.initialMarkdown }),
    ...(options.feedbackLoop === undefined ? {} : { feedbackLoop: options.feedbackLoop }),
  };
  const server = await startLocalBridgeServer(serverOptions);
  const session = server.createSession();
  const browserUrl = addToken(webUrl ?? server.url, session.token, server.url);
  const openBrowser =
    options.openBrowser ??
    (async (url: string) => {
      const browserUrlFile = process.env['COMPLEX_PROMPT_BROWSER_URL_FILE'];
      if (browserUrlFile !== undefined) {
        await writeFile(browserUrlFile, url, 'utf8');
        return;
      }
      await open(url);
    });

  let browserOpened = true;
  try {
    await openBrowser(browserUrl);
  } catch {
    browserOpened = false;
  }

  return {
    server,
    browserUrl,
    browserOpened,
    stop: server.close,
  };
}

function addToken(baseUrl: string, token: string, bridgeUrl: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set('token', token);
  url.searchParams.set('bridge', bridgeUrl);
  return url.toString();
}

function resolveStaticDir(): string | undefined {
  const candidates = [
    fileURLToPath(new URL('../web/dist', import.meta.url)),
    fileURLToPath(new URL('../../web/dist', import.meta.url)),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function validateWebUrl(webUrl: string): string {
  let url: URL;
  try {
    url = new URL(webUrl);
  } catch {
    throw new Error('The web URL must be a valid local HTTP(S) URL.');
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  if (!isLoopback || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('The web URL must point to a loopback HTTP(S) server without credentials.');
  }
  return url.toString();
}

/* c8 ignore start -- CLI bootstrap is covered by the opt-in smoke test. */
/* c8 ignore next */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === 'hook' && args[1] === 'prompt' && args.length === 2) {
    const input = await readStdin();
    const result = await runCodexUserPromptHook(input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (args[0] === 'hook' && args[1] === 'stop' && args.length === 2) {
    const input = await readStdin();
    const result = await runCodexStopHook(input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (
    args[0] === 'hook' &&
    (args[1] === 'install' || args[1] === 'setup') &&
    (args.length === 2 || (args.length === 3 && args[2] === '--dry-run'))
  ) {
    const dryRun = args[2] === '--dry-run';
    const skillResult = await installCodexSkill({ dryRun });
    const promptResult = await installCodexPrompt({ dryRun });
    const result = await installCodexUserPromptHook({
      dryRun,
      command: hookPromptCommand(),
      stopCommand: hookStopCommand(),
    });
    process.stdout.write(
      `${dryRun ? (result.changed ? 'Would install' : 'Already installed') : result.changed ? 'Installed' : 'Already installed'} Codex UserPromptSubmit and Stop hooks in ${result.configPath}.\n`,
    );
    process.stdout.write(
      `${dryRun ? (skillResult.changed ? 'Would install' : 'Already installed') : skillResult.changed ? 'Installed' : 'Already installed'} $${CODEX_COMPLEX_PROMPT_NAME} skill in ${skillResult.skillPath}.\n`,
    );
    process.stdout.write(
      `${dryRun ? (promptResult.changed ? 'Would install' : 'Already installed') : promptResult.changed ? 'Installed' : 'Already installed'} compatibility prompt in ${promptResult.promptPath}.\n`,
    );
    if (dryRun)
      process.stdout.write(
        `${JSON.stringify({ config: result.config, skill: skillResult.content, prompt: promptResult.content }, null, 2)}\n`,
      );
    return;
  }
  if (
    args[0] === 'hook' &&
    (args[1] === 'remove' || args[1] === 'uninstall') &&
    (args.length === 2 || (args.length === 3 && args[2] === '--dry-run'))
  ) {
    const dryRun = args[2] === '--dry-run';
    const result = await removeCodexUserPromptHook({
      dryRun,
      command: hookPromptCommand(),
      stopCommand: hookStopCommand(),
    });
    process.stdout.write(
      `${dryRun ? (result.changed ? 'Would remove' : 'No matching') : result.changed ? 'Removed' : 'No matching'} Codex UserPromptSubmit and Stop hooks in ${result.configPath}.\n`,
    );
    const skillResult = await removeCodexSkill({ dryRun });
    process.stdout.write(
      `${dryRun ? (skillResult.changed ? 'Would remove' : 'No matching') : skillResult.changed ? 'Removed' : 'No matching'} $${CODEX_COMPLEX_PROMPT_NAME} skill in ${skillResult.skillPath}.\n`,
    );
    const promptResult = await removeCodexPrompt({ dryRun });
    process.stdout.write(
      `${dryRun ? (promptResult.changed ? 'Would remove' : 'No matching') : promptResult.changed ? 'Removed' : 'No matching'} compatibility prompt in ${promptResult.promptPath}.\n`,
    );
    if (dryRun)
      process.stdout.write(
        `${JSON.stringify({ config: result.config, skill: skillResult.content, prompt: promptResult.content }, null, 2)}\n`,
      );
    return;
  }
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      'Usage: complex-prompt [hook prompt|hook stop|hook install|hook remove]\n\n' +
        'Open a browser command editor for $complex-prompt and manage its Codex hook and skill.\n',
    );
    return;
  }
  if (args.length > 0) {
    process.stderr.write(`Unknown command: ${args.join(' ')}\n`);
    process.exitCode = 1;
    return;
  }
  if (args.length === 0) {
    process.stderr.write(
      'This CLI is opened by the installed Codex UserPromptSubmit hook. ' +
        'Run `complex-prompt hook install` first, then invoke $complex-prompt in Codex.\n',
    );
    process.exitCode = 1;
    return;
  }
  const webUrl = process.env['COMPLEX_PROMPT_WEB_URL'];
  const bridge = await startCliBridge({
    ...(webUrl === undefined ? {} : { webUrl }),
    ...(process.env['COMPLEX_PROMPT_NO_BROWSER'] === '1'
      ? { openBrowser: () => Promise.reject(new Error('Browser opening disabled.')) }
      : {}),
  });
  if (bridge.browserOpened) {
    process.stdout.write('Browser opening was successful.\n');
  } else {
    process.stdout.write(
      `Browser could not be opened. Open this URL manually:\n${bridge.browserUrl}\n`,
    );
  }

  /* c8 ignore next -- signal shutdown is exercised by the opt-in smoke environment. */
  const shutdown = (): void => {
    void bridge.stop().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function hookPromptCommand(): string {
  const entrypoint = process.argv[1];
  return entrypoint === undefined
    ? 'complex-prompt hook prompt'
    : `${quoteShell(entrypoint)} hook prompt`;
}

function hookStopCommand(): string {
  const entrypoint = process.argv[1];
  return entrypoint === undefined
    ? 'complex-prompt hook stop'
    : `${quoteShell(entrypoint)} hook stop`;
}

function quoteShell(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function readStdin(): Promise<string> {
  let input = '';
  for await (const chunk of process.stdin as AsyncIterable<string | Buffer>) {
    input += typeof chunk === 'string' ? chunk : chunk.toString();
  }
  return input;
}

if (isCliEntrypoint()) {
  void main();
}

function isCliEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  if (entrypoint === undefined) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(entrypoint);
  } catch {
    return false;
  }
}
/* c8 ignore stop */

export {
  CodexSessionInputAdapter,
  MockCodexSessionInputAdapter,
} from './adapters/codex-session-input.js';
export {
  installCodexUserPromptHook,
  removeCodexUserPromptHook,
  type CodexHookConfigOptions,
  type CodexHookConfigResult,
} from './codex-hook-config.js';
export { runCodexStopHook } from './features/feedback/codex-stop-hook.js';
export {
  CODEX_COMPLEX_PROMPT_CONTENT,
  CODEX_COMPLEX_PROMPT_FILE_MARKER,
  CODEX_COMPLEX_PROMPT_NAME,
  CODEX_COMPLEX_SKILL_CONTENT,
  CODEX_COMPLEX_SKILL_FILE_MARKER,
  defaultCodexPromptPath,
  defaultCodexSkillPath,
  installCodexSkill,
  installCodexPrompt,
  removeCodexSkill,
  removeCodexPrompt,
  type CodexPromptConfigOptions,
  type CodexPromptConfigResult,
  type CodexSkillConfigOptions,
  type CodexSkillConfigResult,
} from './codex-prompt-config.js';
export {
  parseCodexUserPromptHookInput,
  runCodexUserPromptHook,
  type CodexUserPromptHookOutput,
  type RunCodexUserPromptHookOptions,
} from './features/input/codex-user-prompt-hook.js';
