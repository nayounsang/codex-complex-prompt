import { createInterface } from 'node:readline';
import { execa } from 'execa';
import { JSONRPCClient, type JSONRPCRequest } from 'json-rpc-2.0';
import { z } from 'zod';

import type { FeedbackModelCatalogEntry } from '@codex-complex-prompt/protocol';

const MODEL_LIST_TIMEOUT_MS = 5_000;
const MODEL_LIST_PAGE_SIZE = 100;
const CodexRPCResponseIdSchema = z.union([z.string(), z.number()]);
const CodexRPCResultSchema = z
  .object({ id: CodexRPCResponseIdSchema, result: z.unknown() })
  .passthrough()
  .refine((message) => 'result' in message);
const CodexRPCErrorSchema = z
  .object({
    id: CodexRPCResponseIdSchema,
    error: z.object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    }),
  })
  .passthrough();

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
type CodexModel = CodexModelListResponse['data'][number];

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
  const client = new JSONRPCClient((message: JSONRPCRequest) =>
    writeCodexMessage(subprocess.stdin, message),
  );
  const requests = client.timeout(MODEL_LIST_TIMEOUT_MS);
  const responseReader = readCodexResponses(lines, client);
  // The original promise is awaited in finally; attach now to prevent an early unhandled rejection.
  void responseReader.catch(() => undefined);
  const entries: FeedbackModelCatalogEntry[] = [];
  try {
    let cursor: string | null = null;
    await requests.request('initialize', {
      clientInfo: { name: 'codex-complex-prompt', version: '0.1.0' },
    });
    client.notify('initialized', undefined, undefined);

    do {
      const response: unknown = await requests.request('model/list', {
        limit: MODEL_LIST_PAGE_SIZE,
        cursor,
        includeHidden: false,
      });
      const page = parseModelPage(response);
      if (page === undefined) return entries;
      entries.push(...page.entries);
      cursor = page.nextCursor;
    } while (cursor !== null);

    return entries;
  } catch {
    return entries;
  } finally {
    lines.close();
    subprocess.kill();
    client.rejectAllPendingRequests('Codex app-server stopped before responding');
    await subprocess;
    await responseReader;
  }
}

function writeCodexMessage(
  stdin: ReturnType<typeof execa>['stdin'],
  message: JSONRPCRequest,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stdin === null) {
      reject(new Error('Codex app-server stdin is unavailable'));
      return;
    }
    // Codex uses JSON-RPC-shaped messages but omits the JSON-RPC 2.0 version field on the wire.
    stdin.write(`${JSON.stringify({ ...message, jsonrpc: undefined })}\n`, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function readCodexResponses(
  lines: ReturnType<typeof createInterface>,
  client: JSONRPCClient,
): Promise<void> {
  for await (const line of lines) {
    try {
      const message: unknown = JSON.parse(line);
      const result = CodexRPCResultSchema.safeParse(message);
      if (result.success) {
        client.receive({ jsonrpc: '2.0', ...result.data });
        continue;
      }
      const error = CodexRPCErrorSchema.safeParse(message);
      if (error.success) {
        client.receive({ jsonrpc: '2.0', ...error.data });
      }
    } catch {
      // Ignore malformed output and let the request timeout decide the result.
    }
  }
  client.rejectAllPendingRequests('Codex app-server closed its output');
}

function parseModelPage(
  value: unknown,
):
  | { readonly entries: FeedbackModelCatalogEntry[]; readonly nextCursor: string | null }
  | undefined {
  const parsed = CodexModelListResponseSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const response: CodexModelListResponse = parsed.data;
  const entries = response.data
    .map(toFeedbackModelCatalogEntry)
    .filter((entry): entry is FeedbackModelCatalogEntry => entry !== undefined);
  return {
    entries,
    nextCursor: response.nextCursor ?? null,
  };
}

function toFeedbackModelCatalogEntry(model: CodexModel): FeedbackModelCatalogEntry | undefined {
  const supportedReasoningEfforts = model.supportedReasoningEfforts.map((effort) => ({
    effort: effort.reasoningEffort,
    description: effort.description,
  }));
  if (
    model.hidden ||
    !supportedReasoningEfforts.some(({ effort }) => effort === model.defaultReasoningEffort)
  ) {
    return undefined;
  }
  return {
    model: model.model,
    displayName: model.displayName,
    supportedReasoningEfforts,
    defaultReasoningEffort: model.defaultReasoningEffort,
  };
}
