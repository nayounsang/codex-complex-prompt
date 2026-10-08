import { type SyntheticEvent, useCallback, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { countPromptCharacters, MAX_PROMPT_LENGTH } from '@codex-complex-prompt/protocol';

import type { BridgeSession } from '../hooks/useBridgeSession.js';
import type { MarkdownEditorHandle } from '../../input/components/MarkdownEditor.js';
import { PromptSessionShell } from '../../../app/components/PromptSessionShell.js';
import { PromptWorkspaceDialogs } from './PromptWorkspaceDialogs.js';
import { useFeedbackAnnotations } from '../../feedback/hooks/useFeedbackAnnotations.js';
import { useFeedbackSubmission } from '../../feedback/hooks/useFeedbackSubmission.js';
import { useProjectTemplates } from '../../templates/hooks/useProjectTemplates.js';
import { usePromptWorkspaceAttachments } from '../hooks/usePromptWorkspaceAttachments.js';

interface PromptWorkspaceProps {
  readonly bridgeSession: BridgeSession;
}

export function PromptWorkspace({ bridgeSession }: PromptWorkspaceProps): React.JSX.Element {
  const [markdownOverride, setMarkdownOverride] = useState<string | null>(null);
  const [mode, setMode] = useState<'edit' | 'feedback'>('edit');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [showEmptyFinishDialog, setShowEmptyFinishDialog] = useState(false);
  const [editorResetVersion, setEditorResetVersion] = useState(0);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const { feedbackLoop, submit } = bridgeSession;
  const markdown = markdownOverride ?? bridgeSession.initialMarkdown ?? '';
  const updateMarkdownOverride = useCallback((nextMarkdown: string): void => {
    setMarkdownOverride(nextMarkdown);
  }, []);
  const feedback = useFeedbackAnnotations();
  const feedbackSubmission = useFeedbackSubmission({
    markdown,
    annotations: feedback.annotations,
    submit,
    onMarkdownChange: updateMarkdownOverride,
    onComplete: () => {
      feedback.clearFeedback();
      setMode('edit');
    },
  });
  const sendFeedback = feedbackSubmission.sendFeedback;
  const projectTemplates = useProjectTemplates({
    snapshot: bridgeSession.templateSnapshot,
    requestChange: bridgeSession.requestTemplateChange,
  });
  const { attachmentUrl, attachmentToken } = bridgeSession;
  const resetEditor = useCallback((): void => {
    setEditorResetVersion((version) => version + 1);
  }, []);
  const attachments = usePromptWorkspaceAttachments({
    markdown,
    editorRef,
    attachmentUrl,
    attachmentToken,
    onMarkdownChange: updateMarkdownOverride,
    onEditorReset: resetEditor,
    onValidationError: setValidationError,
  });
  const {
    attachmentRefreshKey,
    closeDrawing,
    deleteDrawing,
    drawing,
    getCurrentMarkdown,
    handleMediaFiles,
    hasPendingMediaSaves,
    includePendingMediaMarkdown,
    isWaitingForMediaSavesRef,
    mediaUploadStatus,
    openDrawing,
    saveDrawing,
    waitForPendingMediaSaves,
  } = attachments;
  const isConnected = bridgeSession.state === 'connected';
  const isSubmitting =
    bridgeSession.state === 'submitting' ||
    feedbackSubmission.isSubmitting ||
    attachments.isWaitingForMediaSaves;
  const withPromptAfterMediaSaves = useCallback(
    (onPromptReady: (prompt: string) => void): void => {
      if (isWaitingForMediaSavesRef.current) return;
      if (!hasPendingMediaSaves()) {
        onPromptReady(getCurrentMarkdown());
        return;
      }
      void waitForPendingMediaSaves().then(() => onPromptReady(getCurrentMarkdown()));
    },
    [getCurrentMarkdown, hasPendingMediaSaves, isWaitingForMediaSavesRef, waitForPendingMediaSaves],
  );

  const sendFeedbackAfterMediaSaves = useCallback((): void => {
    withPromptAfterMediaSaves((prompt) => {
      void sendFeedback(prompt);
    });
  }, [sendFeedback, withPromptAfterMediaSaves]);

  const handleMarkdownChange = useCallback(
    (nextMarkdown: string): void => {
      updateMarkdownOverride(includePendingMediaMarkdown(nextMarkdown));
      setValidationError(null);
    },
    [includePendingMediaMarkdown, updateMarkdownOverride],
  );

  const applyTemplate = useCallback(
    (body: string): void => {
      updateMarkdownOverride(body);
      setValidationError(null);
      resetEditor();
    },
    [resetEditor, updateMarkdownOverride],
  );

  const submitMarkdown = useCallback((): void => {
    withPromptAfterMediaSaves((prompt) => {
      if (countPromptCharacters(prompt.trim()) > MAX_PROMPT_LENGTH) {
        setValidationError(
          `Markdown commands must be ${MAX_PROMPT_LENGTH.toLocaleString()} characters or fewer.`,
        );
        return;
      }
      setValidationError(null);
      void submit(prompt);
    });
  }, [submit, withPromptAfterMediaSaves]);

  const handlePromptSubmit = useCallback((): void => {
    if (isWaitingForMediaSavesRef.current) return;
    if (feedbackLoop) {
      withPromptAfterMediaSaves((prompt) => {
        if (countPromptCharacters(prompt.trim()) > MAX_PROMPT_LENGTH) {
          setValidationError(
            `Markdown commands must be ${MAX_PROMPT_LENGTH.toLocaleString()} characters or fewer.`,
          );
          return;
        }
        setValidationError(null);
        if (prompt.trim() === '') {
          setShowEmptyFinishDialog(true);
          return;
        }
        void submit(prompt, 'finish');
      });
      return;
    }
    if (feedback.annotations.length > 0) {
      setShowSubmitDialog(true);
      return;
    }
    void submitMarkdown();
  }, [
    feedback.annotations.length,
    feedbackLoop,
    isWaitingForMediaSavesRef,
    submit,
    submitMarkdown,
    withPromptAfterMediaSaves,
  ]);

  const handleApproveAnyway = useCallback((): void => {
    setShowSubmitDialog(false);
    void submitMarkdown();
  }, [submitMarkdown]);

  return (
    <>
      <PromptSessionShell
        session={{
          mode,
          isConnected,
          isSubmitting,
          allowEmptySubmit: bridgeSession.feedbackLoop,
          onModeChange: setMode,
          onSubmit: () => {
            void handlePromptSubmit();
          },
          onSendFeedback: sendFeedbackAfterMediaSaves,
        }}
        editor={{
          markdown,
          initialMarkdown: markdownOverride ?? bridgeSession.initialMarkdown ?? '',
          ref: editorRef,
          validationError,
          initializationKey: `${bridgeSession.initialMarkdown === null ? 'pending' : 'ready'}-${editorResetVersion}`,
          onMarkdownChange: handleMarkdownChange,
        }}
        feedback={{
          annotations: feedback.annotations,
          globalAnnotation: feedback.annotations.find(
            (annotation) => annotation.scope === 'global',
          ),
          pendingSelection: feedback.pendingSelection,
          error: feedbackSubmission.error,
          onAddGlobal: feedback.addGlobalFeedback,
          onSelection: feedback.setPendingSelection,
          onAdd: feedback.addFeedback,
          onCancelSelection: () => feedback.setPendingSelection(null),
          onUpdate: feedback.updateFeedback,
          onDelete: feedback.removeFeedback,
        }}
        drawings={{
          onMediaFiles: handleMediaFiles,
          mediaUploadStatus,
          onDraw: () => {
            void openDrawing();
          },
          onEdit: (id) => {
            void openDrawing(id);
          },
          onDelete: (id) => {
            void deleteDrawing(id);
          },
          attachmentUrl,
          attachmentToken,
          attachmentRefreshKey,
        }}
        templates={{
          items: projectTemplates.templates,
          error: projectTemplates.error,
          onApply: applyTemplate,
          onSave: projectTemplates.save,
          onDelete: projectTemplates.remove,
        }}
      />

      <form
        id="prompt-form"
        onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
          event.preventDefault();
          void handlePromptSubmit();
        }}
        className="submit-proxy-form"
      >
        <Button type="submit" aria-label="Submit prompt" tabIndex={-1} />
      </form>
      <PromptWorkspaceDialogs
        drawing={drawing}
        onSaveDrawing={saveDrawing}
        onCloseDrawing={closeDrawing}
        showSubmitDialog={showSubmitDialog}
        setShowSubmitDialog={setShowSubmitDialog}
        onSendFeedback={() => {
          setShowSubmitDialog(false);
          setMode('feedback');
          sendFeedbackAfterMediaSaves();
        }}
        onApproveAnyway={handleApproveAnyway}
        showEmptyFinishDialog={showEmptyFinishDialog}
        onCloseEmptyFinishDialog={() => setShowEmptyFinishDialog(false)}
        onSubmitEmptyDocument={() => {
          setShowEmptyFinishDialog(false);
          void bridgeSession.submit('', 'finish');
        }}
        closeInSeconds={bridgeSession.closeInSeconds}
      />
    </>
  );
}
