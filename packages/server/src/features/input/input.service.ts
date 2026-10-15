import { Inject, Injectable } from '@nestjs/common';
import { encodeServerMessage, type ServerMessage } from '@codex-complex-prompt/protocol';
import { omitBy } from 'es-toolkit';
import type { WebSocket } from 'ws';

import { ON_PROMPT } from '../../runtime/tokens.js';
import type { LocalBridgeServerOptions, PromptContext } from '../../shared/types.js';
import { PromptSubmitDtoSchema, type PromptSubmitDto } from './dto/prompt-submit.dto.js';

@Injectable()
export class InputService {
  public constructor(
    @Inject(ON_PROMPT) private readonly onPrompt: LocalBridgeServerOptions['onPrompt'],
  ) {}

  public createPromptMessageHandler(
    webSocket: WebSocket,
    sessionId: string,
    promptTimeoutMs: number,
  ): (submission: PromptSubmitDto) => Promise<void> {
    const submissions = new Set<string>();
    let submissionQueue = Promise.resolve();

    return async (submission: PromptSubmitDto): Promise<void> => {
      const dto = PromptSubmitDtoSchema.parse(submission);
      const queuedSubmission = submissionQueue.then(() =>
        this.submitPrompt(webSocket, sessionId, promptTimeoutMs, submissions, dto),
      );
      submissionQueue = queuedSubmission.catch(() => undefined);
      await queuedSubmission;
    };
  }

  private async submitPrompt(
    webSocket: WebSocket,
    sessionId: string,
    promptTimeoutMs: number,
    submissions: Set<string>,
    submission: PromptSubmitDto,
  ): Promise<void> {
    if (submissions.has(submission.submissionId)) {
      sendError(webSocket, 'duplicate_submission', 'This submission has already been received.');
      return;
    }
    submissions.add(submission.submissionId);
    try {
      const context = omitBy(
        {
          sessionId,
          submissionId: submission.submissionId,
          mode: submission.mode ?? 'edit',
          sendFeedbackToSubagent: submission.sendFeedbackToSubagent ?? false,
          feedbackModel:
            submission.sendFeedbackToSubagent === true ? submission.feedbackModel : undefined,
        },
        (value) => value === undefined,
      ) as PromptContext;
      const latestMarkdown = await withTimeout(
        this.onPrompt(submission.prompt, context),
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
