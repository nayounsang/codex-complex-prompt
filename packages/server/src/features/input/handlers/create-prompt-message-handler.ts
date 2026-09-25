import {
  encodeServerMessage,
  type PromptSubmit,
  type ServerMessage,
} from '@codex-complex-prompt/protocol';
import type { WebSocket } from 'ws';

import type { LocalBridgeServerOptions } from '../../../shared/types.js';

export function createPromptMessageHandler(
  webSocket: WebSocket,
  sessionId: string,
  onPrompt: LocalBridgeServerOptions['onPrompt'],
  promptTimeoutMs: number,
): (submission: PromptSubmit) => Promise<void> {
  const submissions = new Set<string>();
  let submissionQueue = Promise.resolve();

  return async function handlePromptMessage(submission: PromptSubmit): Promise<void> {
    const queuedSubmission = submissionQueue.then(() => submitPrompt(submission));
    submissionQueue = queuedSubmission.catch(() => undefined);
    await queuedSubmission;
  };

  async function submitPrompt(submission: PromptSubmit): Promise<void> {
    if (submissions.has(submission.submissionId)) {
      sendError(webSocket, 'duplicate_submission', 'This submission has already been received.');
      return;
    }
    submissions.add(submission.submissionId);
    try {
      const latestMarkdown = await withTimeout(
        onPrompt(submission.prompt, {
          sessionId,
          submissionId: submission.submissionId,
          mode: submission.mode ?? 'edit',
        }),
        promptTimeoutMs,
      );
      send(webSocket, {
        type: 'prompt.result',
        submissionId: submission.submissionId,
        status: 'accepted',
        ...(latestMarkdown === undefined ? {} : { prompt: latestMarkdown }),
      });
    } catch {
      send(webSocket, {
        type: 'prompt.result',
        submissionId: submission.submissionId,
        status: 'failed',
        error: 'The Codex session could not accept this prompt.',
      });
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('The prompt adapter timed out.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function send(webSocket: WebSocket, message: ServerMessage): void {
  if (webSocket.readyState === webSocket.OPEN) webSocket.send(encodeServerMessage(message));
}

function sendError(
  webSocket: WebSocket,
  code: Extract<ServerMessage, { type: 'session.error' }>['code'],
  message: string,
): void {
  send(webSocket, { type: 'session.error', code, message });
}
