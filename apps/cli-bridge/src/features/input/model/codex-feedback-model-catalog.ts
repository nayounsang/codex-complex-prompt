import { createInterface } from 'node:readline';
import { execa } from 'execa';
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

export async function loadCodexFeedbackModelCatalog(): Promise<
  readonly FeedbackModelCatalogEntry[]
> {
  const command = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const subprocess = execa(command, ['app-server', '--listen', 'stdio://'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'ignore',
    timeout: MODEL_LIST_TIMEOUT_MS,
    reject: false,
  });
  const lines = createInterface({ input: subprocess.stdout, crlfDelay: Infinity });
  try {
    const entries: FeedbackModelCatalogEntry[] = [];
    let requestId = 1;
    let cursor: string | null = null;
    let initialized = false;

    return await new Promise((resolve) => {
      let finished = false;

      function finish(result: readonly FeedbackModelCatalogEntry[]): void {
        if (finished) return;
        finished = true;
        lines.close();
        subprocess.kill();
        resolve(result);
      }

      function send(message: unknown): void {
        subprocess.stdin.write(`${JSON.stringify(message)}\n`);
      }

      function handleMessage(line: string): void {
        if (finished || line.trim() === '') return;
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

      lines.on('line', handleMessage);
      void subprocess.then(
        ({ timedOut }) => finish(timedOut ? [] : entries),
        () => finish([]),
      );
      send({
        id: 1,
        method: 'initialize',
        params: {
          clientInfo: { name: 'codex-complex-prompt', version: '0.1.0' },
        },
      });
    });
  } catch {
    lines.close();
    subprocess.kill();
    return [];
  }
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
