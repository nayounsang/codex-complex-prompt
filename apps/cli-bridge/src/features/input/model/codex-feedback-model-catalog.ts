import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import type { FeedbackModelCatalogEntry } from '@codex-complex-prompt/protocol';

const MODEL_LIST_TIMEOUT_MS = 5_000;
const MODEL_LIST_PAGE_SIZE = 100;

export function loadCodexFeedbackModelCatalog(): Promise<readonly FeedbackModelCatalogEntry[]> {
  return new Promise((resolve) => {
    const command = process.platform === 'win32' ? 'codex.exe' : 'codex';
    let child: ChildProcess;
    try {
      child = spawn(command, ['app-server', '--listen', 'stdio://'], {
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch {
      resolve([]);
      return;
    }

    const entries: FeedbackModelCatalogEntry[] = [];
    let buffer = '';
    let requestId = 1;
    let cursor: string | null = null;
    let initialized = false;
    let finished = false;
    const timeout = setTimeout(() => finish([]), MODEL_LIST_TIMEOUT_MS);

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line !== '') handleMessage(line);
        newlineIndex = buffer.indexOf('\n');
      }
    });
    child.once('error', () => finish([]));
    child.once('close', () => finish(entries));

    function finish(result: readonly FeedbackModelCatalogEntry[]): void {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      child.kill();
      resolve(result);
    }

    function send(message: unknown): void {
      child.stdin?.write(`${JSON.stringify(message)}\n`);
    }

    function handleMessage(line: string): void {
      let message: unknown;
      try {
        message = JSON.parse(line) as unknown;
      } catch {
        return;
      }
      if (typeof message !== 'object' || message === null || !('id' in message)) return;
      const response = message as { id: unknown; error?: unknown; result?: unknown };
      if (response.id === 1 && !initialized) {
        if (response.error !== undefined) {
          finish([]);
          return;
        }
        initialized = true;
        send({ method: 'initialized' });
        requestModelPage();
        return;
      }
      if (response.id !== requestId || response.error !== undefined) {
        if (response.id === requestId) finish(entries);
        return;
      }
      const page = parseModelPage(response.result);
      if (page === undefined) {
        finish(entries);
        return;
      }
      entries.push(...page.entries);
      cursor = page.nextCursor;
      if (cursor === null) finish(entries);
      else requestModelPage();
    }

    function requestModelPage(): void {
      requestId += 1;
      send({
        id: requestId,
        method: 'model/list',
        params: { limit: MODEL_LIST_PAGE_SIZE, cursor, includeHidden: false },
      });
    }

    send({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'codex-complex-prompt', version: '0.1.0' },
      },
    });
  });
}

function parseModelPage(
  value: unknown,
):
  | { readonly entries: FeedbackModelCatalogEntry[]; readonly nextCursor: string | null }
  | undefined {
  if (typeof value !== 'object' || value === null || !('data' in value)) return undefined;
  const response = value as { data: unknown; nextCursor?: unknown };
  if (!Array.isArray(response.data)) return undefined;
  const entries = response.data.flatMap((value): FeedbackModelCatalogEntry[] => {
    if (typeof value !== 'object' || value === null) return [];
    const model = value as {
      model?: unknown;
      id?: unknown;
      displayName?: unknown;
      hidden?: unknown;
      supportedReasoningEfforts?: unknown;
      defaultReasoningEffort?: unknown;
    };
    const name = typeof model.model === 'string' ? model.model : model.id;
    if (
      model.hidden === true ||
      typeof name !== 'string' ||
      typeof model.supportedReasoningEfforts !== 'object' ||
      model.supportedReasoningEfforts === null ||
      !Array.isArray(model.supportedReasoningEfforts) ||
      typeof model.defaultReasoningEffort !== 'string'
    ) {
      return [];
    }
    const supportedReasoningEfforts = model.supportedReasoningEfforts.flatMap((effortValue) => {
      if (typeof effortValue !== 'object' || effortValue === null) return [];
      const effort = effortValue as { reasoningEffort?: unknown; description?: unknown };
      return typeof effort.reasoningEffort === 'string'
        ? [
            {
              effort: effort.reasoningEffort,
              description: typeof effort.description === 'string' ? effort.description : '',
            },
          ]
        : [];
    });
    if (!supportedReasoningEfforts.some(({ effort }) => effort === model.defaultReasoningEffort))
      return [];
    return [
      {
        model: name,
        displayName: typeof model.displayName === 'string' ? model.displayName : name,
        supportedReasoningEfforts,
        defaultReasoningEffort: model.defaultReasoningEffort,
      },
    ];
  });
  return {
    entries,
    nextCursor: typeof response.nextCursor === 'string' ? response.nextCursor : null,
  };
}
