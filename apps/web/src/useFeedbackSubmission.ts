import { useCallback, useState } from 'react';

import type { PromptResult } from './bridge-session.js';
import { serializeFeedback } from './feedback-serializer.js';
import type { FeedbackAnnotation } from './feedback-types.js';

interface FeedbackSubmissionOptions {
  readonly markdown: string;
  readonly annotations: readonly FeedbackAnnotation[];
  readonly bridgeUrl: string | null;
  readonly submit: (prompt: string, mode?: 'edit' | 'feedback') => Promise<PromptResult>;
  readonly onMarkdownChange: (markdown: string) => void;
  readonly onComplete: () => void;
}

interface FeedbackSubmission {
  readonly isSubmitting: boolean;
  readonly error: string | null;
  readonly reopenError: string | null;
  readonly retryReopen: () => void;
  readonly sendFeedback: () => Promise<void>;
}

export function useFeedbackSubmission(options: FeedbackSubmissionOptions): FeedbackSubmission {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reopenError, setReopenError] = useState<string | null>(null);
  const [pendingReopen, setPendingReopen] = useState<{
    readonly token: string;
    readonly markdown: string;
  } | null>(null);

  const reopenSession = useCallback(
    (token: string, markdown: string): void => {
      const bridge = options.bridgeUrl ?? window.location.origin;
      const nextUrl = new URL(window.location.href);
      nextUrl.search = '';
      nextUrl.searchParams.set('token', token);
      nextUrl.searchParams.set('bridge', bridge);
      nextUrl.searchParams.set('markdown', markdown);
      try {
        const nextWindow = window.open(nextUrl.toString(), '_blank');
        if (nextWindow === null) throw new Error('The browser blocked the new session window.');
        setPendingReopen(null);
        setReopenError(null);
        window.close();
      } catch {
        setPendingReopen({ token, markdown });
        setReopenError('최신 Markdown은 반영되었습니다. 새 세션을 열려면 다시 시도하세요.');
      }
    },
    [options.bridgeUrl],
  );

  const retryReopen = useCallback((): void => {
    if (pendingReopen === null) return;
    reopenSession(pendingReopen.token, pendingReopen.markdown);
  }, [pendingReopen, reopenSession]);

  const sendFeedback = useCallback(async (): Promise<void> => {
    if (isSubmitting || options.annotations.length === 0) return;
    setIsSubmitting(true);
    setError(null);
    setReopenError(null);
    const prompt = serializeFeedback(options.markdown, options.annotations);
    try {
      const result = await options.submit(prompt, 'feedback');
      if (result.status === 'failed') {
        setError(result.error ?? 'The feedback could not be sent.');
        return;
      }
      const latestMarkdown = result.prompt ?? options.markdown;
      if (result.prompt !== undefined) options.onMarkdownChange(result.prompt);
      options.onComplete();
      if (result.nextSession !== undefined) {
        reopenSession(result.nextSession.token, latestMarkdown);
      }
    } catch {
      setError('The feedback could not be sent.');
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, options, reopenSession]);

  return { isSubmitting, error, reopenError, retryReopen, sendFeedback };
}
