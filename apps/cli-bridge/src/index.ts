#!/usr/bin/env node

import { existsSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import open from 'open';

import {
  startLocalBridgeServer,
  type ReviewSession,
  type RunningLocalBridgeServer,
} from '@codex-complex-prompt/server';
import type { ReviewSubmit } from '@codex-complex-prompt/protocol';

import {
  CodexSessionInputAdapter,
  type CodexSessionInput,
} from './adapters/codex-session-input.js';
import { installCodexStopHook, removeCodexStopHook } from './codex-hook-config.js';
import {
  CODEX_COMPLEX_PROMPT_NAME,
  installCodexPrompt,
  removeCodexPrompt,
} from './codex-prompt-config.js';
import { runCodexStopHook } from './codex-stop-hook.js';

export interface CliBridgeOptions {
  readonly inputAdapter?: CodexSessionInput;
  readonly openBrowser?: (url: string) => Promise<void>;
  readonly webUrl?: string;
  readonly port?: number;
  readonly sessionTtlMs?: number;
  readonly promptTimeoutMs?: number;
  readonly review?: ReviewSession;
  readonly onReview?: (result: ReviewSubmit) => Promise<void>;
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
  const onReview = options.onReview;
  const serverOptions = {
    onPrompt: (prompt: string) => inputAdapter.submit(prompt),
    ...(staticDir === undefined ? {} : { staticDir }),
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.sessionTtlMs === undefined ? {} : { ttlMs: options.sessionTtlMs }),
    ...(options.promptTimeoutMs === undefined ? {} : { promptTimeoutMs: options.promptTimeoutMs }),
    ...(onReview === undefined ? {} : { onReview: (result: ReviewSubmit) => onReview(result) }),
  };
  const server = await startLocalBridgeServer(serverOptions);
  const session = server.createSession(
    options.review === undefined ? {} : { review: options.review },
  );
  const browserUrl = addToken(webUrl ?? server.url, session.token, server.url);
  const openBrowser =
    options.openBrowser ??
    (async (url: string) => {
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
  if (args[0] === 'hook' && args[1] === 'stop') {
    const input = await readStdin();
    const result = await runCodexStopHook(input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (args[0] === 'hook' && (args[1] === 'install' || args[1] === 'setup')) {
    const dryRun = args.includes('--dry-run');
    const promptResult = await installCodexPrompt({ dryRun });
    const result = await installCodexStopHook({
      dryRun,
      command: hookCommand(),
    });
    process.stdout.write(
      `${dryRun ? (result.changed ? 'Would install' : 'Already installed') : result.changed ? 'Installed' : 'Already installed'} Codex Stop hook in ${result.configPath}.\n`,
    );
    process.stdout.write(
      `${dryRun ? (promptResult.changed ? 'Would install' : 'Already installed') : promptResult.changed ? 'Installed' : 'Already installed'} /${CODEX_COMPLEX_PROMPT_NAME} prompt in ${promptResult.promptPath}.\n`,
    );
    if (dryRun)
      process.stdout.write(
        `${JSON.stringify({ config: result.config, prompt: promptResult.content }, null, 2)}\n`,
      );
    return;
  }
  if (args[0] === 'hook' && (args[1] === 'remove' || args[1] === 'uninstall')) {
    const dryRun = args.includes('--dry-run');
    const result = await removeCodexStopHook({
      dryRun,
      command: hookCommand(),
    });
    process.stdout.write(
      `${dryRun ? (result.changed ? 'Would remove' : 'No matching') : result.changed ? 'Removed' : 'No matching'} Codex Stop hook in ${result.configPath}.\n`,
    );
    const promptResult = await removeCodexPrompt({ dryRun });
    process.stdout.write(
      `${dryRun ? (promptResult.changed ? 'Would remove' : 'No matching') : promptResult.changed ? 'Removed' : 'No matching'} /${CODEX_COMPLEX_PROMPT_NAME} prompt in ${promptResult.promptPath}.\n`,
    );
    if (dryRun)
      process.stdout.write(
        `${JSON.stringify({ config: result.config, prompt: promptResult.content }, null, 2)}\n`,
      );
    return;
  }
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      'Usage: complex-prompt [hook stop|hook install|hook remove]\n\n' +
        'Run the local browser bridge, review Codex Stop events, or manage the Codex hook and /complex-prompt command.\n',
    );
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

function hookCommand(): string {
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
  installCodexStopHook,
  removeCodexStopHook,
  type CodexHookConfigOptions,
  type CodexHookConfigResult,
} from './codex-hook-config.js';
export {
  CODEX_COMPLEX_PROMPT_CONTENT,
  CODEX_COMPLEX_PROMPT_FILE_MARKER,
  CODEX_COMPLEX_PROMPT_NAME,
  defaultCodexPromptPath,
  installCodexPrompt,
  removeCodexPrompt,
  type CodexPromptConfigOptions,
  type CodexPromptConfigResult,
} from './codex-prompt-config.js';
export {
  extractReviewContent,
  parseCodexStopHookInput,
  runCodexStopHook,
  type CodexHookContinuation,
  type CodexHookOutput,
  type CodexStopHookInput,
  type CodexStopHookResult,
  type RunCodexStopHookOptions,
} from './codex-stop-hook.js';
