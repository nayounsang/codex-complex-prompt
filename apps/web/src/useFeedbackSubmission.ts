import { useCallback, useState } from 'react';
import { countPromptCharacters, MAX_PROMPT_LENGTH } from '@codex-complex-prompt/protocol';

import type { PromptResult } from './bridge-session.js';
import { serializeFeedback } from './feedback-serializer.js';
import type { FeedbackAnnotation } from './feedback-types.js';

interface FeedbackSubmissionOptions {
  readonly markdown: string;
  readonly annotations: readonly FeedbackAnnotation[];
  readonly submit: (prompt: string, mode?: 'edit' | 'feedback') => Promise<PromptResult>;
  readonly onMarkdownChange: (markdown: string) => void;
  readonly onComplete: () => void;
}

interface FeedbackSubmission {
  readonly isSubmitting: boolean;
  readonly error: string | null;
  readonly sendFeedback: () => Promise<void>;
}

export function useFeedbackSubmission(options: FeedbackSubmissionOptions): FeedbackSubmission {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendFeedback = useCallback(async (): Promise<void> => {
    if (isSubmitting || options.annotations.length === 0) return;
    setIsSubmitting(true);
    setError(null);
    const prompt = serializeFeedback(options.markdown, options.annotations);
    if (countPromptCharacters(prompt.trim()) > MAX_PROMPT_LENGTH) {
      setError(`Feedback must be ${MAX_PROMPT_LENGTH.toLocaleString()} characters or fewer.`);
      setIsSubmitting(false);
      return;
    }
    try {
      const result = await options.submit(prompt, 'feedback');
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
  }, [isSubmitting, options]);

  return { isSubmitting, error, sendFeedback };
}
