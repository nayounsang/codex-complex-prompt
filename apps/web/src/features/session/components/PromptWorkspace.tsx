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
  MAX_ATTACHMENT_VIDEO_BYTES,
  MAX_PROMPT_LENGTH,
} from '@codex-complex-prompt/protocol';

import type { BridgeSession } from '../hooks/useBridgeSession.js';
import type {
  MarkdownEditorHandle,
  MediaFileOptions,
} from '../../input/components/MarkdownEditor.js';
import { PromptSessionShell } from '../../../app/components/PromptSessionShell.js';
import { SubmitFeedbackDialog } from '../../../app/components/SubmitFeedbackDialog.js';
import { useFeedbackAnnotations } from '../../feedback/hooks/useFeedbackAnnotations.js';
import { useFeedbackSubmission } from '../../feedback/hooks/useFeedbackSubmission.js';
import { useProjectTemplates } from '../../templates/hooks/useProjectTemplates.js';
import { removeMarkdownDrawingReferences } from '../../input/drawing-markdown.js';
import {
  countMarkdownImageOccurrences,
  getEmptyImageSourceRanges,
} from '../../../shared/markdown/markdown-source-map.js';
import { MARKDOWN_ATTACHMENT_DIRECTORY } from '../../../shared/markdown/attachment-path.js';
import { identifyImageFormat } from '../../../shared/image-format.js';
import { getVideoExtension, getVideoMimeType } from '../../input/model/media-files.js';

const DrawingDialog = lazy(async () => {
  (window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/';
  const module = await import('../../input/DrawingDialog.js');
  return { default: module.DrawingDialog };
});

interface ActiveDrawing {
  readonly id?: string;
  readonly scene?: string;
}

interface PendingMediaMarkdown {
  readonly markdown: string;
  // Prevent an older identical image line in the draft from consuming this append.
  readonly occurrence: number;
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
  const [isWaitingForMediaSaves, setIsWaitingForMediaSaves] = useState(false);
  const [mediaUploadStatus, setMediaUploadStatus] = useState('');
  const [drawing, setDrawing] = useState<ActiveDrawing | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const currentMarkdownRef = useRef(markdownOverride ?? bridgeSession.initialMarkdown ?? '');
  const pendingMediaMarkdownRef = useRef<PendingMediaMarkdown[]>([]);
  const pendingMediaSavesRef = useRef(new Set<Promise<void>>());
  const pendingMediaSaveResultsRef = useRef(new Map<Promise<void>, string>());
  const isWaitingForMediaSavesRef = useRef(false);
  const { feedbackLoop, submit } = bridgeSession;
  const markdown = markdownOverride ?? bridgeSession.initialMarkdown ?? '';
  const updateMarkdownOverride = useCallback((nextMarkdown: string): void => {
    currentMarkdownRef.current = nextMarkdown;
    setMarkdownOverride(nextMarkdown);
  }, []);
  const includePendingMediaMarkdown = useCallback((markdown: string): string => {
    const pendingMedia = [...pendingMediaMarkdownRef.current];
    const markdownOccurrences = countMarkdownImageOccurrences(
      markdown,
      pendingMedia.map((media) => media.markdown),
    );
    const remainingMedia: PendingMediaMarkdown[] = [];
    const missingMedia: string[] = [];
    for (const media of pendingMedia) {
      const available = markdownOccurrences.get(media.markdown) ?? 0;
      if (available < media.occurrence) {
        remainingMedia.push(media);
        missingMedia.push(media.markdown);
      }
    }
    pendingMediaMarkdownRef.current = remainingMedia;
    if (missingMedia.length === 0) return markdown;
    return `${markdown.trimEnd()}${markdown.trim() === '' ? '' : '\n\n'}${missingMedia.join('\n\n')}`;
  }, []);
  const getCurrentMarkdown = useCallback(
    (): string =>
      includePendingMediaMarkdown(editorRef.current?.getMarkdown() ?? currentMarkdownRef.current),
    [includePendingMediaMarkdown],
  );
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
    isWaitingForMediaSaves;
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
      const currentMarkdown = getCurrentMarkdown();
      const next = `${currentMarkdown.trimEnd()}${currentMarkdown.trim() === '' ? '' : '\n\n'}![Drawing](${MARKDOWN_ATTACHMENT_DIRECTORY}/${result.id}.png)`;
      updateMarkdownOverride(next);
      setEditorResetVersion((version) => version + 1);
    } else {
      updateMarkdownOverride(getCurrentMarkdown());
      setEditorResetVersion((version) => version + 1);
    }
  };

  const saveMediaFiles = async (
    files: readonly File[],
    options?: MediaFileOptions,
  ): Promise<string> => {
    const initialMarkdown = getCurrentMarkdown();
    const placeholderRange =
      options?.emptyImageIndex === undefined
        ? undefined
        : getEmptyImageSourceRanges(initialMarkdown)[options.emptyImageIndex];
    const placeholderMarker =
      placeholderRange === undefined
        ? undefined
        : `![media-upload-pending-${globalThis.crypto.randomUUID()}]()`;
    if (placeholderRange !== undefined && placeholderMarker !== undefined) {
      updateMarkdownOverride(
        `${initialMarkdown.slice(0, placeholderRange.start)}${placeholderMarker}${initialMarkdown.slice(placeholderRange.end)}`,
      );
      setEditorResetVersion((version) => version + 1);
    }
    const markdownImages: string[] = [];
    let hasSavedAttachments = false;
    let hasFailedMediaUploads = false;
    for (const file of files) {
      try {
        const videoMimeType = getVideoMimeType(file);
        const videoExtension = getVideoExtension(file);
        if (
          file.size >
          (videoExtension === null ? MAX_ATTACHMENT_IMAGE_BYTES : MAX_ATTACHMENT_VIDEO_BYTES)
        ) {
          throw new Error('Media files must be 25 MB or smaller.');
        }
        if (videoMimeType !== null && videoExtension !== null) {
          const video = await readFileAsDataUrl(file, videoMimeType);
          const endpoint = attachmentEndpoint();
          if (endpoint === null)
            throw new Error('Could not connect to the project attachment store.');
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video, extension: videoExtension }),
          });
          const responseText = await response.text();
          let result: { id?: string; extension?: string; error?: string };
          try {
            result = JSON.parse(responseText) as {
              id?: string;
              extension?: string;
              error?: string;
            };
          } catch {
            throw new Error(
              responseText.trim() || `Could not save the video (HTTP ${response.status}).`,
            );
          }
          if (!response.ok || result.id === undefined)
            throw new Error(result.error ?? 'Could not save the video.');
          hasSavedAttachments = true;
          markdownImages.push(
            `![](${MARKDOWN_ATTACHMENT_DIRECTORY}/${result.id}.${result.extension ?? videoExtension})`,
          );
          continue;
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
        hasFailedMediaUploads = true;
        const isVideo = getVideoMimeType(file) !== null;
        markdownImages.push(
          `![${isVideo ? 'Video' : 'Image'} upload failed: ${escapeMarkdownAlt(file.name)}](${IMAGE_UPLOAD_FALLBACK_PATH})`,
        );
      }
    }
    const editorMarkdown = getCurrentMarkdown();
    const currentMarkdown =
      placeholderMarker !== undefined &&
      !editorMarkdown.includes(placeholderMarker) &&
      currentMarkdownRef.current.includes(placeholderMarker)
        ? currentMarkdownRef.current
        : editorMarkdown;
    const currentOccurrences = countMarkdownImageOccurrences(currentMarkdown, markdownImages);
    const appendedOccurrences = new Map<string, number>();
    for (const image of markdownImages) {
      const appended = appendedOccurrences.get(image) ?? 0;
      pendingMediaMarkdownRef.current.push({
        markdown: image,
        occurrence: (currentOccurrences.get(image) ?? 0) + appended + 1,
      });
      appendedOccurrences.set(image, appended + 1);
    }
    if (hasSavedAttachments) setAttachmentRefreshKey((refreshKey) => refreshKey + 1);
    const placeholderStart =
      placeholderMarker === undefined ? -1 : currentMarkdown.indexOf(placeholderMarker);
    const next =
      placeholderStart < 0 || placeholderMarker === undefined
        ? `${currentMarkdown.trimEnd()}${currentMarkdown.trim() === '' ? '' : '\n\n'}${markdownImages.join('\n\n')}`
        : `${currentMarkdown.slice(0, placeholderStart)}${markdownImages[0] ?? ''}${currentMarkdown.slice(placeholderStart + placeholderMarker.length)}${markdownImages
            .slice(1)
            .map((image) => `\n\n${image}`)
            .join('')}`;
    updateMarkdownOverride(next);
    setEditorResetVersion((version) => version + 1);
    return hasFailedMediaUploads
      ? hasSavedAttachments
        ? 'Some media uploads failed'
        : 'Media upload failed'
      : 'Media upload complete';
  };

  const handleMediaFiles = (files: readonly File[], options?: MediaFileOptions): Promise<void> => {
    const save = saveMediaFiles(files, options);
    const trackedSave = save.then(() => undefined);
    pendingMediaSavesRef.current.add(trackedSave);
    setMediaUploadStatus('Uploading media');
    const finish = (status: string): void => {
      pendingMediaSavesRef.current.delete(trackedSave);
      pendingMediaSaveResultsRef.current.set(trackedSave, status);
      if (pendingMediaSavesRef.current.size > 0) {
        setMediaUploadStatus('Uploading media');
        return;
      }
      const results = [...pendingMediaSaveResultsRef.current.values()];
      pendingMediaSaveResultsRef.current.clear();
      const hasFailures = results.some((result) => result !== 'Media upload complete');
      const hasSuccesses = results.some((result) => result !== 'Media upload failed');
      setMediaUploadStatus(
        hasFailures && hasSuccesses
          ? 'Some media uploads failed'
          : hasFailures
            ? 'Media upload failed'
            : 'Media upload complete',
      );
    };
    void save.then(finish, () => finish('Media upload failed'));
    return trackedSave;
  };

  const waitForPendingMediaSaves = useCallback(async (): Promise<void> => {
    if (pendingMediaSavesRef.current.size === 0) return;
    isWaitingForMediaSavesRef.current = true;
    setIsWaitingForMediaSaves(true);
    try {
      while (pendingMediaSavesRef.current.size > 0) {
        const saves = [...pendingMediaSavesRef.current];
        await Promise.all(saves);
      }
    } finally {
      isWaitingForMediaSavesRef.current = false;
      setIsWaitingForMediaSaves(false);
    }
  }, []);

  const withPromptAfterMediaSaves = useCallback(
    (onPromptReady: (prompt: string) => void): void => {
      if (isWaitingForMediaSavesRef.current) return;
      if (pendingMediaSavesRef.current.size === 0) {
        onPromptReady(getCurrentMarkdown());
        return;
      }
      void waitForPendingMediaSaves().then(() => onPromptReady(getCurrentMarkdown()));
    },
    [getCurrentMarkdown, waitForPendingMediaSaves],
  );

  const sendFeedbackAfterMediaSaves = useCallback((): void => {
    withPromptAfterMediaSaves((prompt) => {
      void sendFeedback(prompt);
    });
  }, [sendFeedback, withPromptAfterMediaSaves]);

  const deleteDrawing = async (id: string): Promise<void> => {
    const endpoint = attachmentEndpoint(id);
    if (endpoint === null) return;
    try {
      const response = await fetch(endpoint, { method: 'DELETE' });
      if (!response.ok && response.status !== 404)
        throw new Error('Could not delete the drawing file.');
      const next = removeMarkdownDrawingReferences(getCurrentMarkdown(), id);
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
      updateMarkdownOverride(includePendingMediaMarkdown(nextMarkdown));
      setValidationError(null);
    },
    [includePendingMediaMarkdown, updateMarkdownOverride],
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
            sendFeedbackAfterMediaSaves();
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
