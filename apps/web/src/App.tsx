import { type SyntheticEvent, useCallback, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { Dialog } from '@base-ui/react/dialog';
import { countPromptCharacters, MAX_PROMPT_LENGTH } from '@codex-complex-prompt/protocol';

import { useBridgeSession } from './bridge-session.js';
import type { MarkdownEditorHandle } from './features/input/MarkdownEditor.js';
import { PromptSessionShell } from './PromptSessionShell.js';
import { SubmitFeedbackDialog } from './SubmitFeedbackDialog.js';
import { useFeedbackAnnotations } from './features/feedback/useFeedbackAnnotations.js';
import { useFeedbackSubmission } from './features/feedback/useFeedbackSubmission.js';
import './styles.css';

export function App(): React.JSX.Element {
  const [markdownOverride, setMarkdownOverride] = useState<string | null>(null);
  const [mode, setMode] = useState<'edit' | 'feedback'>('edit');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [showEmptyFinishDialog, setShowEmptyFinishDialog] = useState(false);
  const [editorResetVersion, setEditorResetVersion] = useState(0);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const {
    state,
    error,
    closeInSeconds,
    initialMarkdown,
    feedbackLoop: sessionFeedbackLoop,
    templates,
    templatesError,
    saveTemplate,
    deleteTemplate,
    submit,
  } = useBridgeSession();
  const markdown = markdownOverride ?? initialMarkdown ?? '';
  const feedbackLoop = sessionFeedbackLoop;
  const feedback = useFeedbackAnnotations();
  const feedbackSubmission = useFeedbackSubmission({
    markdown,
    annotations: feedback.annotations,
    submit,
    onMarkdownChange: setMarkdownOverride,
    onComplete: () => {
      feedback.clearFeedback();
      setMode('edit');
    },
  });
  const isConnected = state === 'connected';
  const isSubmitting = state === 'submitting' || feedbackSubmission.isSubmitting;

  const handleMarkdownChange = useCallback((nextMarkdown: string): void => {
    setMarkdownOverride(nextMarkdown);
    setValidationError(null);
  }, []);

  const applyTemplate = useCallback((body: string): void => {
    setMarkdownOverride(body);
    setValidationError(null);
    setEditorResetVersion((version) => version + 1);
  }, []);

  const submitMarkdown = useCallback((): void => {
    const prompt = editorRef.current?.getMarkdown() ?? markdown;
    if (countPromptCharacters(prompt.trim()) > MAX_PROMPT_LENGTH) {
      setValidationError(
        `Markdown commands must be ${MAX_PROMPT_LENGTH.toLocaleString()} characters or fewer.`,
      );
      return;
    }
    setValidationError(null);
    void submit(prompt);
  }, [markdown, submit]);

  const handlePromptSubmit = useCallback((): void => {
    if (feedbackLoop) {
      const prompt = editorRef.current?.getMarkdown() ?? markdown;
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
      return;
    }
    if (feedback.annotations.length > 0) {
      setShowSubmitDialog(true);
      return;
    }
    submitMarkdown();
  }, [feedback.annotations.length, feedbackLoop, markdown, submit, submitMarkdown]);

  const handleApproveAnyway = useCallback((): void => {
    setShowSubmitDialog(false);
    submitMarkdown();
  }, [submitMarkdown]);

  return (
    <main className="shell">
      <header className="app-header">
        <div className="brand" aria-label="Codex Prompt">
          <span className="brand-mark" aria-hidden="true">
            ◇
          </span>
          <span>Codex Prompt</span>
        </div>
        <p className={`connection-status connection-status-${state}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          <span>
            {state === 'connecting' && 'Connecting'}
            {state === 'connected' && 'Connected'}
            {state === 'submitting' && 'Sending'}
            {state === 'success' && 'Sent'}
            {state === 'error' && (error ?? 'Something went wrong')}
            {state === 'disconnected' && 'Disconnected'}
          </span>
        </p>
      </header>
      <PromptSessionShell
        mode={mode}
        markdown={markdown}
        editorInitialMarkdown={markdownOverride ?? initialMarkdown ?? ''}
        editorRef={editorRef}
        isConnected={isConnected}
        isSubmitting={isSubmitting}
        feedback={feedback.annotations}
        globalFeedback={feedback.annotations.find((annotation) => annotation.scope === 'global')}
        pendingSelection={feedback.pendingSelection}
        validationError={validationError}
        feedbackError={feedbackSubmission.error}
        allowEmptySubmit={feedbackLoop}
        editorInitializationKey={`${initialMarkdown === null ? 'pending' : 'ready'}-${editorResetVersion}`}
        onModeChange={setMode}
        onMarkdownChange={handleMarkdownChange}
        onSubmit={handlePromptSubmit}
        onSendFeedback={() => {
          void feedbackSubmission.sendFeedback();
        }}
        onAddGlobalFeedback={feedback.addGlobalFeedback}
        onSelection={feedback.setPendingSelection}
        onAddFeedback={feedback.addFeedback}
        onCancelSelection={() => feedback.setPendingSelection(null)}
        onUpdateFeedback={feedback.updateFeedback}
        onDeleteFeedback={feedback.removeFeedback}
        templates={templates}
        templatesError={templatesError}
        onApplyTemplate={applyTemplate}
        onSaveTemplate={saveTemplate}
        onDeleteTemplate={deleteTemplate}
      />
      <form
        id="prompt-form"
        onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
          event.preventDefault();
          handlePromptSubmit();
        }}
        className="submit-proxy-form"
      >
        <Button type="submit" aria-label="Submit prompt" tabIndex={-1} />
      </form>
      {showSubmitDialog && (
        <SubmitFeedbackDialog
          onCancel={() => setShowSubmitDialog(false)}
          onSendFeedback={() => {
            setShowSubmitDialog(false);
            setMode('feedback');
            void feedbackSubmission.sendFeedback();
          }}
          onApproveAnyway={handleApproveAnyway}
        />
      )}
      {showEmptyFinishDialog && (
        <Dialog.Root open onOpenChange={(open) => !open && setShowEmptyFinishDialog(false)}>
          <Dialog.Portal>
            <Dialog.Backdrop className="dialog-backdrop" />
            <Dialog.Viewport className="dialog-viewport">
              <Dialog.Popup className="submit-dialog" role="alertdialog">
                <Dialog.Title>Submit an empty document?</Dialog.Title>
                <Dialog.Description>
                  The review has no Markdown to continue from. Codex will end the review without a
                  document to act on.
                </Dialog.Description>
                <div className="dialog-actions">
                  <Button
                    type="button"
                    className="button-quiet"
                    onClick={() => setShowEmptyFinishDialog(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    className="button-primary"
                    onClick={() => {
                      setShowEmptyFinishDialog(false);
                      void submit('', 'finish');
                    }}
                  >
                    Submit empty document
                  </Button>
                </div>
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      {closeInSeconds !== null && (
        <Dialog.Root open modal disablePointerDismissal>
          <Dialog.Portal>
            <Dialog.Backdrop className="countdown-backdrop" />
            <Dialog.Viewport className="dialog-viewport">
              <Dialog.Popup className="countdown-modal">
                <p className="eyebrow">COMMAND SENT</p>
                <Dialog.Title id="countdown-title">명령이 전송되었습니다</Dialog.Title>
                <Dialog.Description>{closeInSeconds}초 후 이 창이 닫힙니다.</Dialog.Description>
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </main>
  );
}
