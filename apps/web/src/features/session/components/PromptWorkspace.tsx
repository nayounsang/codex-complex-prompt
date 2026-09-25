import { type SyntheticEvent, lazy, Suspense, useCallback, useRef, useState } from 'react';
import { Button } from '@base-ui/react/button';
import { Dialog } from '@base-ui/react/dialog';
import { countPromptCharacters, MAX_PROMPT_LENGTH } from '@codex-complex-prompt/protocol';

import type { BridgeSession } from '../hooks/useBridgeSession.js';
import type { MarkdownEditorHandle } from '../../input/components/MarkdownEditor.js';
import { PromptSessionShell } from '../../../app/components/PromptSessionShell.js';
import { SubmitFeedbackDialog } from '../../../app/components/SubmitFeedbackDialog.js';
import { useFeedbackAnnotations } from '../../feedback/hooks/useFeedbackAnnotations.js';
import { useFeedbackSubmission } from '../../feedback/hooks/useFeedbackSubmission.js';
import { useProjectTemplates } from '../../templates/hooks/useProjectTemplates.js';
import {
  findMarkdownDrawingReferences,
  removeMarkdownDrawingReferences,
} from '../../input/drawing-markdown.js';

const DrawingDialog = lazy(async () => {
  (window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/';
  const module = await import('../../input/DrawingDialog.js');
  return { default: module.DrawingDialog };
});

interface ActiveDrawing {
  readonly id?: string;
  readonly scene?: string;
}

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
  const [attachmentRefreshKey, setAttachmentRefreshKey] = useState(0);
  const [drawing, setDrawing] = useState<ActiveDrawing | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const { feedbackLoop, submit } = bridgeSession;
  const markdown = markdownOverride ?? bridgeSession.initialMarkdown ?? '';
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
  const projectTemplates = useProjectTemplates({
    snapshot: bridgeSession.templateSnapshot,
    requestChange: bridgeSession.requestTemplateChange,
  });
  const isConnected = bridgeSession.state === 'connected';
  const isSubmitting = bridgeSession.state === 'submitting' || feedbackSubmission.isSubmitting;
  const { attachmentUrl, attachmentToken } = bridgeSession;
  const drawings = findMarkdownDrawingReferences(markdown);

  const attachmentEndpoint = (id?: string, extension?: 'png' | 'json'): string | null => {
    if (attachmentUrl === null || attachmentToken === null) return null;
    const suffix =
      id === undefined ? '' : `/${id}${extension === undefined ? '' : `.${extension}`}`;
    return `${attachmentUrl}${suffix}?token=${encodeURIComponent(attachmentToken)}`;
  };

  const openDrawing = async (id?: string): Promise<void> => {
    if (id === undefined) {
      setDrawing({});
      return;
    }
    const endpoint = attachmentEndpoint(id, 'json');
    if (endpoint === null) return;
    try {
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error('그림 파일을 불러오지 못했습니다.');
      setDrawing({ id, scene: await response.text() });
    } catch (reason) {
      setValidationError(
        reason instanceof Error ? reason.message : '그림 파일을 불러오지 못했습니다.',
      );
    }
  };

  const saveDrawing = async (input: { id?: string; png: string; scene: string }): Promise<void> => {
    const endpoint = attachmentEndpoint();
    if (endpoint === null) throw new Error('프로젝트 첨부 저장소에 연결되지 않았습니다.');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const responseText = await response.text();
    let result: { id?: string; error?: string };
    try {
      result = JSON.parse(responseText) as { id?: string; error?: string };
    } catch {
      throw new Error(
        responseText.trim() ||
          `그림 저장 서버가 올바른 응답을 반환하지 않았습니다. (HTTP ${response.status})`,
      );
    }
    if (!response.ok || result.id === undefined)
      throw new Error(result.error ?? '그림을 저장하지 못했습니다.');
    setAttachmentRefreshKey((refreshKey) => refreshKey + 1);
    if (input.id === undefined) {
      const next = `${markdown.trimEnd()}${markdown.trim() === '' ? '' : '\n\n'}![Drawing](.complex-prompt/attachments/${result.id}.png)`;
      setMarkdownOverride(next);
      setEditorResetVersion((version) => version + 1);
    } else {
      setMarkdownOverride(editorRef.current?.getMarkdown() ?? markdown);
      setEditorResetVersion((version) => version + 1);
    }
  };

  const deleteDrawing = async (id: string): Promise<void> => {
    const endpoint = attachmentEndpoint(id);
    if (endpoint === null) return;
    try {
      const response = await fetch(endpoint, { method: 'DELETE' });
      if (!response.ok && response.status !== 404)
        throw new Error('그림 파일을 삭제하지 못했습니다.');
      const next = removeMarkdownDrawingReferences(markdown, id);
      setMarkdownOverride(next);
      setEditorResetVersion((version) => version + 1);
    } catch (reason) {
      setValidationError(
        reason instanceof Error ? reason.message : '그림 파일을 삭제하지 못했습니다.',
      );
    }
  };

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
    <>
      <PromptSessionShell
        session={{
          mode,
          isConnected,
          isSubmitting,
          allowEmptySubmit: bridgeSession.feedbackLoop,
          onModeChange: setMode,
          onSubmit: handlePromptSubmit,
          onSendFeedback: () => {
            void feedbackSubmission.sendFeedback();
          },
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
          items: drawings,
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
      {drawing !== null && (
        <Suspense
          fallback={
            <p className="prompt-limit" role="status">
              그림 편집기를 여는 중…
            </p>
          }
        >
          <DrawingDialog
            open
            {...(drawing.scene === undefined ? {} : { initialScene: drawing.scene })}
            {...(drawing.id === undefined ? {} : { attachmentId: drawing.id })}
            onSave={saveDrawing}
            onClose={() => setDrawing(null)}
          />
        </Suspense>
      )}
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
                      void bridgeSession.submit('', 'finish');
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
      {bridgeSession.closeInSeconds !== null && (
        <Dialog.Root open modal disablePointerDismissal>
          <Dialog.Portal>
            <Dialog.Backdrop className="countdown-backdrop" />
            <Dialog.Viewport className="dialog-viewport">
              <Dialog.Popup className="countdown-modal">
                <p className="eyebrow">COMMAND SENT</p>
                <Dialog.Title id="countdown-title">명령이 전송되었습니다</Dialog.Title>
                <Dialog.Description>
                  {bridgeSession.closeInSeconds}초 후 이 창이 닫힙니다.
                </Dialog.Description>
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </>
  );
}
