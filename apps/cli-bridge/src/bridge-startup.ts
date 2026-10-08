import { existsSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import open from 'open';
import {
  startLocalBridgeServer,
  type RunningLocalBridgeServer,
} from '@codex-complex-prompt/server';
import {
  CodexSessionInputAdapter,
  type CodexSessionInput,
  type CodexSessionInputContext,
} from './features/input/adapters/codex-session-input.js';
import { createProjectAttachmentStore } from './features/attachments/project-attachments.js';
import { createProjectTemplateStore } from './features/templates/storage/project-templates.js';
import { DEFAULT_BRIDGE_SESSION_TTL_MS } from './shared/hook-timeouts.js';

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
  readonly projectDirectory?: string;
  readonly templatesError?: string;
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
  const templateStore =
    options.projectDirectory === undefined
      ? undefined
      : createProjectTemplateStore(options.projectDirectory);
  const attachmentStore =
    options.projectDirectory === undefined
      ? undefined
      : createProjectAttachmentStore(options.projectDirectory);
  const serverOptions = {
    onPrompt: (prompt: string, context: CodexSessionInputContext) =>
      inputAdapter.submit(prompt, context),
    ...(staticDir === undefined ? {} : { staticDir }),
    ...(options.port === undefined ? {} : { port: options.port }),
    ttlMs: options.sessionTtlMs ?? DEFAULT_BRIDGE_SESSION_TTL_MS,
    ...(options.promptTimeoutMs === undefined ? {} : { promptTimeoutMs: options.promptTimeoutMs }),
    ...(options.initialMarkdown === undefined ? {} : { initialMarkdown: options.initialMarkdown }),
    ...(options.feedbackLoop === undefined ? {} : { feedbackLoop: options.feedbackLoop }),
    ...(templateStore === undefined ? {} : { templateStore }),
    ...(attachmentStore === undefined ? {} : { attachmentStore }),
    ...(options.templatesError === undefined ? {} : { templatesError: options.templatesError }),
  };
  const server = await startLocalBridgeServer(serverOptions);
  const session = server.createSession();
  const browserUrl = addToken(webUrl ?? server.url, session.token, server.url);
  const openBrowser =
    options.openBrowser ??
    (async (url: string) => {
      const browserUrlFile = process.env['COMPLEX_PROMPT_BROWSER_URL_FILE'];
      if (browserUrlFile !== undefined) {
        const temporaryUrlFile = `${browserUrlFile}.tmp`;
        await writeFile(temporaryUrlFile, url, 'utf8');
        await rename(temporaryUrlFile, browserUrlFile);
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
