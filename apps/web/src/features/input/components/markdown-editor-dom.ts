import { createAttachmentImageUrl } from '../../../attachment-image-url.js';
import {
  getConfiguredAttachmentId,
  getMarkdownAttachmentExtension,
  getMarkdownAttachmentId,
} from '../../../shared/markdown/attachment-path.js';
import { MARKDOWN_UI_REPLACEMENT_MODEL } from '../../../shared/markdown/ui-replacements.js';

export interface DrawingEditTarget {
  readonly id: string;
  readonly image: HTMLImageElement;
  readonly editable: boolean;
}

function isIgnorableMediaPlaceholderChild(child: ChildNode, image: HTMLImageElement): boolean {
  return (
    child === image ||
    (child instanceof HTMLImageElement && child.classList.contains('ProseMirror-separator')) ||
    (child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim() === '') ||
    (child instanceof HTMLBRElement && child.classList.contains('ProseMirror-trailingBreak'))
  );
}

function isDedicatedMediaPlaceholder(paragraph: HTMLParagraphElement): boolean {
  const image = paragraph.querySelector(':scope > img');
  return (
    image instanceof HTMLImageElement &&
    image.getAttribute('src') === '' &&
    Array.from(paragraph.childNodes).every((child) =>
      isIgnorableMediaPlaceholderChild(child, image),
    )
  );
}

function isMediaPlaceholderUploading(paragraph: HTMLParagraphElement): boolean {
  const image = paragraph.querySelector(':scope > img');
  return (
    image instanceof HTMLImageElement &&
    image.getAttribute('src') === '' &&
    image
      .getAttribute('alt')
      ?.startsWith(MARKDOWN_UI_REPLACEMENT_MODEL.mediaPlaceholder.pendingPrefix) === true
  );
}

export function syncMediaPlaceholderAccessibility(root: HTMLElement, readOnly: boolean): void {
  const dedicatedPlaceholders = Array.from(
    root.querySelectorAll<HTMLParagraphElement>('.ProseMirror p'),
  ).filter(isDedicatedMediaPlaceholder);
  const currentPlaceholders = new Set(dedicatedPlaceholders);
  root.querySelectorAll<HTMLParagraphElement>('p[data-media-placeholder]').forEach((paragraph) => {
    if (readOnly || !currentPlaceholders.has(paragraph)) {
      paragraph.removeAttribute('data-media-placeholder');
      paragraph.removeAttribute('data-markdown-ui-replacement');
      paragraph.removeAttribute('role');
      paragraph.removeAttribute('tabindex');
      paragraph.removeAttribute('aria-label');
      paragraph.removeAttribute('aria-disabled');
    }
  });
  if (readOnly) return;
  dedicatedPlaceholders.forEach((paragraph) => {
    const isUploading = isMediaPlaceholderUploading(paragraph);
    paragraph.setAttribute('data-media-placeholder', 'true');
    paragraph.dataset['markdownUiReplacement'] =
      MARKDOWN_UI_REPLACEMENT_MODEL.mediaPlaceholder.kind;
    paragraph.setAttribute('role', 'button');
    paragraph.setAttribute('tabindex', isUploading ? '-1' : '0');
    paragraph.setAttribute('aria-label', isUploading ? 'Uploading media' : 'Add media');
    if (isUploading) paragraph.setAttribute('aria-disabled', 'true');
    else paragraph.removeAttribute('aria-disabled');
  });
}

export function getDrawingIdFromImage(
  image: HTMLImageElement,
  attachmentUrl: string | null | undefined,
  attachmentToken: string | null | undefined,
): string | null {
  const source = image.getAttribute('src');
  if (source === null) return null;
  const markdownId = getMarkdownAttachmentId(source);
  if (markdownId !== null) return markdownId;
  if (attachmentUrl == null || attachmentToken == null) return null;
  try {
    const imageUrl = new URL(source, document.baseURI);
    if (imageUrl.searchParams.get('token') !== attachmentToken) return null;
    return getConfiguredAttachmentId(source, attachmentUrl);
  } catch {
    return null;
  }
}

export function replaceAttachmentImageUrls(
  root: HTMLDivElement,
  attachmentUrl: string | null | undefined,
  attachmentToken: string | null | undefined,
  attachmentRefreshKey: number,
): void {
  if (
    attachmentUrl === null ||
    attachmentUrl === undefined ||
    attachmentToken === null ||
    attachmentToken === undefined
  )
    return;
  for (const image of root.querySelectorAll<HTMLImageElement>('img[src]')) {
    const source = image.getAttribute('src');
    const id = source === null ? null : getMarkdownAttachmentId(source);
    const extension = source === null ? null : getMarkdownAttachmentExtension(source);
    if (id === null || extension === null) continue;
    const url = createAttachmentImageUrl(
      attachmentUrl,
      id,
      attachmentToken,
      attachmentRefreshKey,
      extension,
    );
    image.tabIndex = 0;
    image.dataset['drawingId'] = id;
    image.dataset['markdownUiReplacement'] = MARKDOWN_UI_REPLACEMENT_MODEL.drawing.kind;
    image.setAttribute('role', 'button');
    image.setAttribute('aria-label', `Drawing actions: ${image.alt.trim() || 'Drawing'}`);
    if (['mp4', 'mov', 'webm'].includes(extension)) {
      image.dataset['videoSource'] = url;
      const inertImage = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
      if (image.src !== inertImage) image.src = inertImage;
    } else if (image.src !== url) {
      image.src = url;
    }
  }
}
