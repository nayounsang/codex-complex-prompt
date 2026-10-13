import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { z } from 'zod';

import type { FeedbackModelCatalogEntry } from '@codex-complex-prompt/protocol';

const MODEL_LIST_TIMEOUT_MS = 5_000;
const MODEL_LIST_PAGE_SIZE = 100;

// Mirrors the fields used from Codex's app-server ModelListResponse schema.
// https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/json/v2/ModelListResponse.json
const CodexModelListResponseSchema = z.object({
  data: z.array(
    z
      .object({
        id: z.string(),
        model: z.string(),
        displayName: z.string(),
        description: z.string(),
        hidden: z.boolean(),
        isDefault: z.boolean(),
        defaultReasoningEffort: z.string().min(1),
        supportedReasoningEfforts: z.array(
          z.object({
            reasoningEffort: z.string().min(1),
            description: z.string(),
          }),
        ),
      })
      .passthrough(),
  ),
  nextCursor: z.string().nullable().optional(),
});

type CodexModelListResponse = z.infer<typeof CodexModelListResponseSchema>;

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
  const parsed = CodexModelListResponseSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const response: CodexModelListResponse = parsed.data;
  const entries = response.data.flatMap((model): FeedbackModelCatalogEntry[] => {
    const supportedReasoningEfforts = model.supportedReasoningEfforts.map((effort) => ({
      effort: effort.reasoningEffort,
      description: effort.description,
    }));
    if (
      model.hidden ||
      !supportedReasoningEfforts.some(({ effort }) => effort === model.defaultReasoningEffort)
    )
      return [];
    return [
      {
        model: model.model,
        displayName: model.displayName,
        supportedReasoningEfforts,
        defaultReasoningEffort: model.defaultReasoningEffort,
      },
    ];
  });
  return {
    entries,
    nextCursor: response.nextCursor ?? null,
  };
}
