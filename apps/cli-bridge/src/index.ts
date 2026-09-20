import { fileURLToPath, pathToFileURL } from 'node:url';

import open from 'open';

import {
  startLocalBridgeServer,
  type RunningLocalBridgeServer,
} from '@codex-complex-prompt/server';

import {
  CodexSessionInputAdapter,
  type CodexSessionInput,
} from './adapters/codex-session-input.js';

export interface CliBridgeOptions {
  readonly inputAdapter?: CodexSessionInput;
  readonly openBrowser?: (url: string) => Promise<void>;
  readonly webUrl?: string;
  readonly port?: number;
  readonly sessionTtlMs?: number;
  readonly promptTimeoutMs?: number;
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
  const serverOptions = {
    onPrompt: (prompt: string) => inputAdapter.submit(prompt),
    staticDir: fileURLToPath(new URL('../../web/dist', import.meta.url)),
    ...(options.port === undefined ? {} : { port: options.port }),
    ...(options.sessionTtlMs === undefined ? {} : { ttlMs: options.sessionTtlMs }),
    ...(options.promptTimeoutMs === undefined ? {} : { promptTimeoutMs: options.promptTimeoutMs }),
  };
  const server = await startLocalBridgeServer(serverOptions);
  const session = server.createSession();
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
  const webUrl = process.env['COMPLEX_PROMPT_WEB_URL'];
  const bridge = await startCliBridge(webUrl === undefined ? {} : { webUrl });
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
/* c8 ignore stop */

export {
  CodexSessionInputAdapter,
  MockCodexSessionInputAdapter,
} from './adapters/codex-session-input.js';
