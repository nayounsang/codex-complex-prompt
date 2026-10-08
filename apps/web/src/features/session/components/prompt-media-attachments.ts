import type { Dispatch, SetStateAction } from 'react';
import {
  MAX_ATTACHMENT_IMAGE_BYTES,
  MAX_ATTACHMENT_VIDEO_BYTES,
} from '@codex-complex-prompt/protocol';
import { parseAttachmentResponse } from '../infrastructure/attachment-response.js';
import { MARKDOWN_UI_REPLACEMENT_MODEL } from '../../../shared/markdown/ui-replacements.js';
import { countMarkdownImageOccurrences } from '../../../shared/markdown/markdown-source-map.js';
import { MARKDOWN_ATTACHMENT_DIRECTORY } from '../../../shared/markdown/attachment-path.js';
import { identifyImageFormat } from '../../../shared/image-format.js';
import { getVideoExtension, getVideoMimeType } from '../../input/model/media-files.js';

const IMAGE_UPLOAD_FALLBACK_PATH = '/image-upload-failed.svg';

export interface PendingMediaMarkdown {
  readonly markdown: string;
  readonly occurrence: number;
}

interface SavePromptMediaDependencies {
  readonly getCurrentMarkdown: () => string;
  readonly updateMarkdownOverride: (markdown: string) => void;
  readonly attachmentEndpoint: () => string | null;
  readonly setAttachmentRefreshKey: Dispatch<SetStateAction<number>>;
  readonly setEditorResetVersion: Dispatch<SetStateAction<number>>;
  readonly pendingMediaMarkdownRef: { current: PendingMediaMarkdown[] };
  readonly currentMarkdownRef: { current: string };
}

export async function savePromptMediaFiles(
  files: readonly File[],
  options: { readonly placeholderId: string } | undefined,
  {
    getCurrentMarkdown,
    updateMarkdownOverride,
    attachmentEndpoint,
    setAttachmentRefreshKey,
    setEditorResetVersion,
    pendingMediaMarkdownRef,
    currentMarkdownRef,
  }: SavePromptMediaDependencies,
): Promise<string> {
  const initialMarkdown = getCurrentMarkdown();
  const selectedPlaceholderMarker =
    options === undefined ? undefined : `![${options.placeholderId}]()`;
  const selectedPlaceholderStart =
    selectedPlaceholderMarker === undefined
      ? -1
      : initialMarkdown.indexOf(selectedPlaceholderMarker);
  const placeholderMarker =
    selectedPlaceholderStart < 0 || selectedPlaceholderMarker === undefined
      ? undefined
      : `![${MARKDOWN_UI_REPLACEMENT_MODEL.mediaPlaceholder.pendingPrefix}${globalThis.crypto.randomUUID()}]()`;
  if (
    selectedPlaceholderStart >= 0 &&
    selectedPlaceholderMarker !== undefined &&
    placeholderMarker !== undefined
  ) {
    updateMarkdownOverride(
      `${initialMarkdown.slice(0, selectedPlaceholderStart)}${placeholderMarker}${initialMarkdown.slice(selectedPlaceholderStart + selectedPlaceholderMarker.length)}`,
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
        const result = parseAttachmentResponse(
          responseText,
          response.status,
          `Could not save the video (HTTP ${response.status}).`,
        );
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
      if (endpoint === null) throw new Error('Could not connect to the project attachment store.');
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
      const result = parseAttachmentResponse(
        responseText,
        response.status,
        `Could not save the image (HTTP ${response.status}).`,
      );
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
      : `${currentMarkdown.slice(0, placeholderStart)}${markdownImages[0]}${currentMarkdown.slice(placeholderStart + placeholderMarker.length)}`;
  updateMarkdownOverride(next);
  setEditorResetVersion((version) => version + 1);
  return hasFailedMediaUploads
    ? hasSavedAttachments
      ? 'Some media uploads failed'
      : 'Media upload failed'
    : 'Media upload complete';
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
