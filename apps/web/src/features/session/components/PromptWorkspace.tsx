import {
  type SyntheticEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Button } from '@base-ui/react/button';
import { Dialog } from '@base-ui/react/dialog';
import {
  countPromptCharacters,
  MAX_ATTACHMENT_IMAGE_BYTES,
  MAX_PROMPT_LENGTH,
} from '@codex-complex-prompt/protocol';

import type { BridgeSession } from '../hooks/useBridgeSession.js';
import type { MarkdownEditorHandle } from '../../input/components/MarkdownEditor.js';
import { PromptSessionShell } from '../../../app/components/PromptSessionShell.js';
import { SubmitFeedbackDialog } from '../../../app/components/SubmitFeedbackDialog.js';
import { useFeedbackAnnotations } from '../../feedback/hooks/useFeedbackAnnotations.js';
import { useFeedbackSubmission } from '../../feedback/hooks/useFeedbackSubmission.js';
import { useProjectTemplates } from '../../templates/hooks/useProjectTemplates.js';
import { removeMarkdownDrawingReferences } from '../../input/drawing-markdown.js';
import { MARKDOWN_ATTACHMENT_DIRECTORY } from '../../../shared/markdown/attachment-path.js';
import { identifyImageFormat } from '../../../shared/image-format.js';

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

const IMAGE_UPLOAD_FALLBACK_PATH = '/image-upload-failed.svg';

export function PromptWorkspace({ bridgeSession }: PromptWorkspaceProps): React.JSX.Element {
  const [markdownOverride, setMarkdownOverride] = useState<string | null>(null);
  const [mode, setMode] = useState<'edit' | 'feedback'>('edit');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [showEmptyFinishDialog, setShowEmptyFinishDialog] = useState(false);
  const [editorResetVersion, setEditorResetVersion] = useState(0);
  const [attachmentRefreshKey, setAttachmentRefreshKey] = useState(0);
  const [isWaitingForImageSaves, setIsWaitingForImageSaves] = useState(false);
  const [drawing, setDrawing] = useState<ActiveDrawing | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const currentMarkdownRef = useRef(markdownOverride ?? bridgeSession.initialMarkdown ?? '');
  const pendingImageSavesRef = useRef(new Set<Promise<void>>());
  const isWaitingForImageSavesRef = useRef(false);
  const { feedbackLoop, submit } = bridgeSession;
  const markdown = markdownOverride ?? bridgeSession.initialMarkdown ?? '';
  const updateMarkdownOverride = useCallback((nextMarkdown: string): void => {
    currentMarkdownRef.current = nextMarkdown;
    setMarkdownOverride(nextMarkdown);
  }, []);
  useEffect(
    function syncCurrentMarkdownRef() {
      currentMarkdownRef.current = markdown;
    },
    [markdown],
  );
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
  const isConnected = bridgeSession.state === 'connected';
  const isSubmitting =
    bridgeSession.state === 'submitting' ||
    feedbackSubmission.isSubmitting ||
    isWaitingForImageSaves;
  const { attachmentUrl, attachmentToken } = bridgeSession;
  const attachmentEndpoint = (id?: string, extension?: string): string | null => {
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
      if (!response.ok) throw new Error('Could not load the drawing file.');
      setDrawing({ id, scene: await response.text() });
    } catch (reason) {
      setValidationError(
        reason instanceof Error ? reason.message : 'Could not load the drawing file.',
      );
    }
  };

  const saveDrawing = async (input: { id?: string; png: string; scene: string }): Promise<void> => {
    const endpoint = attachmentEndpoint();
    if (endpoint === null) throw new Error('Could not connect to the project attachment store.');
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
          `The drawing server returned an invalid response (HTTP ${response.status}).`,
      );
    }
    if (!response.ok || result.id === undefined)
      throw new Error(result.error ?? 'Could not save the drawing.');
    setAttachmentRefreshKey((refreshKey) => refreshKey + 1);
    if (input.id === undefined) {
      const currentMarkdown = currentMarkdownRef.current;
      const next = `${currentMarkdown.trimEnd()}${currentMarkdown.trim() === '' ? '' : '\n\n'}![Drawing](${MARKDOWN_ATTACHMENT_DIRECTORY}/${result.id}.png)`;
      updateMarkdownOverride(next);
      setEditorResetVersion((version) => version + 1);
    } else {
      updateMarkdownOverride(currentMarkdownRef.current);
      setEditorResetVersion((version) => version + 1);
    }
  };

  const saveImageFiles = async (files: readonly File[]): Promise<void> => {
    const markdownImages: string[] = [];
    let hasSavedAttachments = false;
    for (const file of files) {
      try {
        if (file.size > MAX_ATTACHMENT_IMAGE_BYTES) {
          throw new Error('Image files must be 25 MB or smaller.');
        }
        const sourceMimeType = file.type || 'application/octet-stream';
        const sourceImage = await readFileAsDataUrl(file, sourceMimeType);
        const format = await identifyImageFormat(file, file.name);
        const image = sourceImage.replace(/^data:[^;,]+;/, `data:${format.mimeType};`);
        const endpoint = attachmentEndpoint();
        if (endpoint === null)
          throw new Error('Could not connect to the project attachment store.');
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image,
            extension: format.extension,
            scene: JSON.stringify({ type: 'image' }),
          }),
        });
        const responseText = await response.text();
        let result: { id?: string; extension?: string; error?: string };
        try {
          result = JSON.parse(responseText) as { id?: string; error?: string };
        } catch {
          throw new Error(
            responseText.trim() || `Could not save the image (HTTP ${response.status}).`,
          );
        }
        if (!response.ok || result.id === undefined)
          throw new Error(result.error ?? 'Could not save the image.');
        hasSavedAttachments = true;
        markdownImages.push(
          `![${escapeMarkdownAlt(file.name)}](${MARKDOWN_ATTACHMENT_DIRECTORY}/${result.id}.${result.extension ?? format.extension})`,
        );
      } catch {
        markdownImages.push(
          `![Image upload failed: ${escapeMarkdownAlt(file.name)}](${IMAGE_UPLOAD_FALLBACK_PATH})`,
        );
      }
    }
    const currentMarkdown = currentMarkdownRef.current;
    if (hasSavedAttachments) setAttachmentRefreshKey((refreshKey) => refreshKey + 1);
    const next = `${currentMarkdown.trimEnd()}${currentMarkdown.trim() === '' ? '' : '\n\n'}${markdownImages.join('\n\n')}`;
    updateMarkdownOverride(next);
    setEditorResetVersion((version) => version + 1);
  };

  const handleImageFiles = (files: readonly File[]): Promise<void> => {
    const save = saveImageFiles(files);
    pendingImageSavesRef.current.add(save);
    void save.then(() => pendingImageSavesRef.current.delete(save));
    return save.then(() => undefined);
  };

  const waitForPendingImageSaves = useCallback(async (): Promise<void> => {
    if (pendingImageSavesRef.current.size === 0) return;
    isWaitingForImageSavesRef.current = true;
    setIsWaitingForImageSaves(true);
    try {
      while (pendingImageSavesRef.current.size > 0) {
        const saves = [...pendingImageSavesRef.current];
        await Promise.all(saves);
      }
    } finally {
      isWaitingForImageSavesRef.current = false;
      setIsWaitingForImageSaves(false);
    }
  }, []);

  const withPromptAfterImageSaves = useCallback(
    (onPromptReady: (prompt: string) => void): void => {
      if (isWaitingForImageSavesRef.current) return;
      const getCurrentPrompt = (): string => currentMarkdownRef.current;
      if (pendingImageSavesRef.current.size === 0) {
        onPromptReady(getCurrentPrompt());
        return;
      }
      void waitForPendingImageSaves().then(() => onPromptReady(getCurrentPrompt()));
    },
    [waitForPendingImageSaves],
  );

  const sendFeedbackAfterImageSaves = useCallback((): void => {
    withPromptAfterImageSaves((prompt) => {
      void sendFeedback(prompt);
    });
  }, [sendFeedback, withPromptAfterImageSaves]);

  const deleteDrawing = async (id: string): Promise<void> => {
    const endpoint = attachmentEndpoint(id);
    if (endpoint === null) return;
    try {
      const response = await fetch(endpoint, { method: 'DELETE' });
      if (!response.ok && response.status !== 404)
        throw new Error('Could not delete the drawing file.');
      const next = removeMarkdownDrawingReferences(currentMarkdownRef.current, id);
      updateMarkdownOverride(next);
      setEditorResetVersion((version) => version + 1);
    } catch (reason) {
      setValidationError(
        reason instanceof Error ? reason.message : 'Could not delete the drawing file.',
      );
    }
  };

  const handleMarkdownChange = useCallback(
    (nextMarkdown: string): void => {
      updateMarkdownOverride(nextMarkdown);
      setValidationError(null);
    },
    [updateMarkdownOverride],
  );

  const applyTemplate = useCallback(
    (body: string): void => {
      updateMarkdownOverride(body);
      setValidationError(null);
      setEditorResetVersion((version) => version + 1);
    },
    [updateMarkdownOverride],
  );

  const submitMarkdown = useCallback((): void => {
    withPromptAfterImageSaves((prompt) => {
      if (countPromptCharacters(prompt.trim()) > MAX_PROMPT_LENGTH) {
        setValidationError(
          `Markdown commands must be ${MAX_PROMPT_LENGTH.toLocaleString()} characters or fewer.`,
        );
        return;
      }
      setValidationError(null);
      void submit(prompt);
    });
  }, [submit, withPromptAfterImageSaves]);

  const handlePromptSubmit = useCallback((): void => {
    if (isWaitingForImageSavesRef.current) return;
    if (feedbackLoop) {
      withPromptAfterImageSaves((prompt) => {
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
    submit,
    submitMarkdown,
    withPromptAfterImageSaves,
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
          onSendFeedback: sendFeedbackAfterImageSaves,
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
          onImageFiles: handleImageFiles,
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
              Opening drawing editor…
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
          void handlePromptSubmit();
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
            sendFeedbackAfterImageSaves();
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
                <Dialog.Title id="countdown-title">Command sent</Dialog.Title>
                <Dialog.Description>
                  This window will close in {bridgeSession.closeInSeconds} seconds.
                </Dialog.Description>
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </>
  );
}

function readFileAsDataUrl(file: Blob, mimeType: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result.replace(/^data:[^;,]+;/, `data:${mimeType};`))
        : reject(new Error('Could not read the image.'));
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.readAsDataURL(file);
  });
}

function escapeMarkdownAlt(value: string): string {
  return value.replace(/[\\\[\]]/g, '\\$&').replace(/[\r\n]+/g, ' ');
}
