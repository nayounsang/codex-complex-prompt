import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { countMarkdownImageOccurrences } from '../../../shared/markdown/markdown-source-map.js';
import { MARKDOWN_ATTACHMENT_DIRECTORY } from '../../../shared/markdown/attachment-path.js';
import { removeMarkdownDrawingReferences } from '../../input/drawing-markdown.js';
import type {
  MarkdownEditorHandle,
  MediaFileOptions,
} from '../../input/components/MarkdownEditor.js';
import { parseAttachmentResponse } from '../infrastructure/attachment-response.js';
import {
  savePromptMediaFiles,
  type PendingMediaMarkdown,
} from '../components/prompt-media-attachments.js';

export interface PromptDrawingData {
  readonly id?: string;
  readonly scene?: string;
}

interface UsePromptWorkspaceAttachmentsOptions {
  readonly markdown: string;
  readonly editorRef: RefObject<MarkdownEditorHandle | null>;
  readonly attachmentUrl: string | null;
  readonly attachmentToken: string | null;
  readonly onMarkdownChange: (markdown: string) => void;
  readonly onEditorReset: () => void;
  readonly onValidationError: (message: string) => void;
}

export function usePromptWorkspaceAttachments({
  markdown,
  editorRef,
  attachmentUrl,
  attachmentToken,
  onMarkdownChange,
  onEditorReset,
  onValidationError,
}: UsePromptWorkspaceAttachmentsOptions) {
  const currentMarkdownRef = useRef(markdown);
  const pendingMediaMarkdownRef = useRef<PendingMediaMarkdown[]>([]);
  const pendingMediaSavesRef = useRef(new Set<Promise<void>>());
  const pendingMediaSaveResultsRef = useRef(new Map<Promise<void>, string>());
  const isWaitingForMediaSavesRef = useRef(false);
  const [isWaitingForMediaSaves, setIsWaitingForMediaSaves] = useState(false);
  const [mediaUploadStatus, setMediaUploadStatus] = useState('');
  const [attachmentRefreshKey, setAttachmentRefreshKey] = useState(0);
  const [drawing, setDrawing] = useState<PromptDrawingData | null>(null);

  const updateMarkdownOverride = useCallback(
    (nextMarkdown: string): void => {
      currentMarkdownRef.current = nextMarkdown;
      onMarkdownChange(nextMarkdown);
    },
    [onMarkdownChange],
  );
  const includePendingMediaMarkdown = useCallback((current: string): string => {
    const pendingMedia = [...pendingMediaMarkdownRef.current];
    const markdownOccurrences = countMarkdownImageOccurrences(
      current,
      pendingMedia.map((media) => media.markdown),
    );
    const remainingMedia: PendingMediaMarkdown[] = [];
    const missingMedia: string[] = [];
    for (const media of pendingMedia) {
      if ((markdownOccurrences.get(media.markdown) ?? 0) < media.occurrence) {
        remainingMedia.push(media);
        missingMedia.push(media.markdown);
      }
    }
    pendingMediaMarkdownRef.current = remainingMedia;
    if (missingMedia.length === 0) return current;
    return `${current.trimEnd()}${current.trim() === '' ? '' : '\n\n'}${missingMedia.join('\n\n')}`;
  }, []);
  const getCurrentMarkdown = useCallback(
    (): string =>
      includePendingMediaMarkdown(editorRef.current?.getMarkdown() ?? currentMarkdownRef.current),
    [editorRef, includePendingMediaMarkdown],
  );

  useEffect(
    function syncCurrentMarkdownRef() {
      currentMarkdownRef.current = markdown;
    },
    [markdown],
  );

  const attachmentEndpoint = useCallback(
    (id?: string, extension?: string): string | null => {
      if (attachmentUrl === null || attachmentToken === null) return null;
      const suffix =
        id === undefined ? '' : `/${id}${extension === undefined ? '' : `.${extension}`}`;
      return `${attachmentUrl}${suffix}?token=${encodeURIComponent(attachmentToken)}`;
    },
    [attachmentToken, attachmentUrl],
  );

  const openDrawing = useCallback(
    async (id?: string): Promise<void> => {
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
        onValidationError(
          reason instanceof Error ? reason.message : 'Could not load the drawing file.',
        );
      }
    },
    [attachmentEndpoint, onValidationError],
  );

  const saveDrawing = useCallback(
    async (input: { id?: string; png: string; scene: string }): Promise<void> => {
      const endpoint = attachmentEndpoint();
      if (endpoint === null) throw new Error('Could not connect to the project attachment store.');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const responseText = await response.text();
      const result = parseAttachmentResponse(
        responseText,
        response.status,
        `The drawing server returned an invalid response (HTTP ${response.status}).`,
      );
      if (!response.ok || result.id === undefined)
        throw new Error(result.error ?? 'Could not save the drawing.');
      setAttachmentRefreshKey((refreshKey) => refreshKey + 1);
      if (input.id === undefined) {
        const current = getCurrentMarkdown();
        const next = `${current.trimEnd()}${current.trim() === '' ? '' : '\n\n'}![Drawing](${MARKDOWN_ATTACHMENT_DIRECTORY}/${result.id}.png)`;
        updateMarkdownOverride(next);
      } else {
        updateMarkdownOverride(getCurrentMarkdown());
      }
      onEditorReset();
    },
    [attachmentEndpoint, getCurrentMarkdown, onEditorReset, updateMarkdownOverride],
  );

  const handleMediaFiles = useCallback(
    (files: readonly File[], options?: MediaFileOptions): Promise<void> => {
      const save = savePromptMediaFiles(files, options, {
        getCurrentMarkdown,
        updateMarkdownOverride,
        attachmentEndpoint,
        setAttachmentRefreshKey,
        setEditorResetVersion: onEditorReset,
        pendingMediaMarkdownRef,
        currentMarkdownRef,
      });
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
    },
    [attachmentEndpoint, getCurrentMarkdown, onEditorReset, updateMarkdownOverride],
  );

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

  const deleteDrawing = useCallback(
    async (id: string): Promise<void> => {
      const endpoint = attachmentEndpoint(id);
      if (endpoint === null) return;
      try {
        const response = await fetch(endpoint, { method: 'DELETE' });
        if (!response.ok && response.status !== 404)
          throw new Error('Could not delete the drawing file.');
        updateMarkdownOverride(removeMarkdownDrawingReferences(getCurrentMarkdown(), id));
        onEditorReset();
      } catch (reason) {
        onValidationError(
          reason instanceof Error ? reason.message : 'Could not delete the drawing file.',
        );
      }
    },
    [
      attachmentEndpoint,
      getCurrentMarkdown,
      onEditorReset,
      onValidationError,
      updateMarkdownOverride,
    ],
  );

  return {
    attachmentRefreshKey,
    closeDrawing: () => setDrawing(null),
    deleteDrawing,
    drawing,
    getCurrentMarkdown,
    handleMediaFiles,
    hasPendingMediaSaves: () => pendingMediaSavesRef.current.size > 0,
    includePendingMediaMarkdown,
    isWaitingForMediaSaves,
    isWaitingForMediaSavesRef,
    mediaUploadStatus,
    openDrawing,
    saveDrawing,
    setAttachmentRefreshKey,
    setDrawing,
    waitForPendingMediaSaves,
  };
}
