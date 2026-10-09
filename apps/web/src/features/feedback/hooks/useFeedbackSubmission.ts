import { useCallback, useState } from 'react';
import { serializeFeedback } from '@codex-complex-prompt/core/feedback';
import { countPromptCharacters, MAX_PROMPT_LENGTH } from '@codex-complex-prompt/protocol';

import type { PromptResult } from '../../session/hooks/useBridgeSession.js';
import type { FeedbackAnnotation } from '../model/feedback-types.js';

interface FeedbackSubmissionOptions {
  readonly markdown: string;
  readonly annotations: readonly FeedbackAnnotation[];
  readonly submit: (
    prompt: string,
    mode?: 'edit' | 'feedback',
    options?: { readonly sendFeedbackToSubagent?: boolean },
  ) => Promise<PromptResult>;
  readonly sendFeedbackToSubagent: boolean;
  readonly onMarkdownChange: (markdown: string) => void;
  readonly onComplete: () => void;
}

interface FeedbackSubmission {
  readonly isSubmitting: boolean;
  readonly error: string | null;
  readonly sendFeedback: (markdown?: string) => Promise<void>;
}

export function useFeedbackSubmission(options: FeedbackSubmissionOptions): FeedbackSubmission {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendFeedback = useCallback(
    async (markdown = options.markdown): Promise<void> => {
      if (isSubmitting || options.annotations.length === 0) return;
      setIsSubmitting(true);
      setError(null);
      const prompt = serializeFeedback(markdown, options.annotations);
      if (countPromptCharacters(prompt.trim()) > MAX_PROMPT_LENGTH) {
        setError(`Feedback must be ${MAX_PROMPT_LENGTH.toLocaleString()} characters or fewer.`);
        setIsSubmitting(false);
        return;
      }
      try {
        const result = await options.submit(prompt, 'feedback', {
          sendFeedbackToSubagent: options.sendFeedbackToSubagent,
        });
        if (result.status === 'failed') {
          setError(result.error ?? 'The feedback could not be sent.');
          return;
        }
        if (result.prompt !== undefined) options.onMarkdownChange(result.prompt);
        options.onComplete();
      } catch {
        setError('The feedback could not be sent.');
      } finally {
        setIsSubmitting(false);
      }
    },
    [isSubmitting, options],
  );

  return { isSubmitting, error, sendFeedback };
}
