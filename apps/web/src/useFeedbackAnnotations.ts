import { useCallback, useState } from 'react';

import type { FeedbackAnnotation, SelectionAnchor } from './feedback-types.js';

interface FeedbackAnnotations {
  readonly annotations: FeedbackAnnotation[];
  readonly pendingSelection: SelectionAnchor | null;
  readonly setPendingSelection: (selection: SelectionAnchor | null) => void;
  readonly addFeedback: (feedback: string) => void;
  readonly addGlobalFeedback: (feedback: string) => void;
  readonly updateFeedback: (id: string, feedback: string) => void;
  readonly removeFeedback: (id: string) => void;
  readonly clearFeedback: () => void;
}

export function useFeedbackAnnotations(): FeedbackAnnotations {
  const [annotations, setAnnotations] = useState<FeedbackAnnotation[]>([]);
  const [pendingSelection, setPendingSelection] = useState<SelectionAnchor | null>(null);

  const addFeedback = useCallback(
    (feedback: string): void => {
      const trimmed = feedback.trim();
      if (trimmed === '') return;
      setAnnotations((current) => [
        ...current,
        pendingSelection === null
          ? { id: crypto.randomUUID(), scope: 'global', feedback: trimmed }
          : {
              id: crypto.randomUUID(),
              scope: 'selection',
              quote: pendingSelection.quote,
              start: pendingSelection.start,
              end: pendingSelection.end,
              feedback: trimmed,
            },
      ]);
      setPendingSelection(null);
    },
    [pendingSelection],
  );

  const addGlobalFeedback = useCallback((feedback: string): void => {
    const trimmed = feedback.trim();
    if (trimmed === '') return;
    setAnnotations((current) => {
      const existing = current.find((annotation) => annotation.scope === 'global');
      if (existing !== undefined) {
        return current.map((annotation) =>
          annotation.id === existing.id ? { ...annotation, feedback: trimmed } : annotation,
        );
      }
      return [...current, { id: crypto.randomUUID(), scope: 'global', feedback: trimmed }];
    });
  }, []);

  const updateFeedback = useCallback((id: string, feedback: string): void => {
    const trimmed = feedback.trim();
    if (trimmed === '') return;
    setAnnotations((current) =>
      current.map((annotation) =>
        annotation.id === id ? { ...annotation, feedback: trimmed } : annotation,
      ),
    );
  }, []);

  const removeFeedback = useCallback((id: string): void => {
    setAnnotations((current) => current.filter((annotation) => annotation.id !== id));
  }, []);

  const clearFeedback = useCallback((): void => {
    setAnnotations([]);
    setPendingSelection(null);
  }, []);

  return {
    annotations,
    pendingSelection,
    setPendingSelection,
    addFeedback,
    addGlobalFeedback,
    updateFeedback,
    removeFeedback,
    clearFeedback,
  };
}
