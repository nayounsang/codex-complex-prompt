import { z } from 'zod';

import { getMediaMimeType } from '@codex-complex-prompt/milkdown-plugins/media/core';
import { MARKDOWN_UI_REPLACEMENT_MODEL } from './ui-replacements.js';

export interface MediaEmbedTarget {
  readonly id: string;
  readonly mount: HTMLDivElement;
  readonly container: HTMLElement;
  readonly image: HTMLImageElement;
  readonly path: string;
  readonly alt: string;
  readonly mimeType: string | null;
  readonly isHighlighted: boolean;
}

let nextMediaEmbedId = 0;
const mediaEmbedIds = new WeakMap<HTMLImageElement, string>();
export const INERT_MEDIA_IMAGE_SRC = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

export function getMediaImageSource(image: HTMLImageElement): string | null {
  return image.dataset['mediaSource'] ?? image.dataset['videoSource'] ?? image.getAttribute('src');
}

const MediaEmbedImageSchema = z.lazy(() =>
  z.object({
    image: z
      .instanceof(HTMLImageElement)
      .refine((image) => image.closest('.media-embed-mount') === null)
      .refine((image) => !image.classList.contains('ProseMirror-separator'))
      .refine((image) => image.closest('[data-media-placeholder="true"]') === null),
    container: z.instanceof(HTMLElement),
    path: z.string(),
    alt: z
      .string()
      .refine((alt) => !alt.startsWith(MARKDOWN_UI_REPLACEMENT_MODEL.mediaPlaceholder.markerPrefix))
      .refine(
        (alt) => !alt.startsWith(MARKDOWN_UI_REPLACEMENT_MODEL.mediaPlaceholder.pendingPrefix),
      ),
    isHighlighted: z.boolean(),
  }),
);

export function createMediaEmbedTargets(
  root: ParentNode,
  mountRoot?: HTMLElement,
  containers?: readonly HTMLElement[],
): MediaEmbedTarget[] {
  const mountContainer = mountRoot ?? (root instanceof HTMLElement ? root : null);
  if (mountContainer === null) return [];
  const targets: MediaEmbedTarget[] = [];
  const proseMirror =
    root instanceof Element && root.matches('.ProseMirror')
      ? root
      : root.querySelector('.ProseMirror');
  const images =
    containers === undefined
      ? Array.from((proseMirror ?? root).querySelectorAll<HTMLImageElement>('img'))
      : containers.flatMap((container) =>
          Array.from(container.querySelectorAll<HTMLImageElement>('img')),
        );
  for (const image of images) {
    const path = getMediaImageSource(image) ?? '';
    const parsedImage = MediaEmbedImageSchema.safeParse({
      image,
      container: image.closest('p') ?? image.parentElement,
      path,
      alt: image.alt,
      isHighlighted: image.classList.contains('feedback-image-highlight'),
    });
    if (!parsedImage.success) continue;
    if (path !== '' && image.dataset['mediaSource'] === undefined) {
      image.dataset['mediaSource'] = path;
      image.dataset['mediaPending'] = 'true';
      delete image.dataset['videoSource'];
      image.setAttribute('aria-hidden', 'true');
      image.setAttribute('src', INERT_MEDIA_IMAGE_SRC);
    }
    const { image: sourceImage, container, alt, isHighlighted } = parsedImage.data;

    const mimeType = path === '' ? null : getMediaMimeType(path);
    const id = mediaEmbedIds.get(sourceImage) ?? `media-embed-${nextMediaEmbedId++}`;
    mediaEmbedIds.set(sourceImage, id);

    let mount = mountContainer.querySelector<HTMLDivElement>(
      `.media-embed-mount[data-media-embed-id="${id}"]`,
    );
    if (mount === null) {
      mount = document.createElement('div');
      mount.className = 'media-embed-mount';
      mount.contentEditable = 'false';
      mountContainer.append(mount);
    }
    mount.dataset['mediaEmbedId'] = id;
    targets.push({
      id,
      mount,
      container,
      image: sourceImage,
      path,
      alt,
      mimeType,
      isHighlighted,
    });
  }
  return targets;
}

export function getMediaEmbedAffectedContainers(
  root: ParentNode,
  records: readonly MutationRecord[],
): HTMLElement[] {
  const containers = new Set<HTMLElement>();
  const affectedContainerSchema = z
    .instanceof(HTMLElement)
    .refine((container) => container.closest('.media-embed-mount') === null)
    .refine((container) => container !== root)
    .refine((container) => !container.matches('.ProseMirror'))
    .refine((container) => root.contains(container));
  const includeContainer = (node: Node): void => {
    const element = node instanceof Element ? node : node.parentElement;
    const container =
      element?.closest('p') ?? (element instanceof HTMLImageElement ? element.parentElement : null);
    const parsedContainer = affectedContainerSchema.safeParse(container);
    if (parsedContainer.success) containers.add(parsedContainer.data);
  };
  for (const record of records) {
    includeContainer(record.target);
    record.addedNodes.forEach((node) => {
      includeContainer(node);
      if (node instanceof Element) {
        node.querySelectorAll('p').forEach((paragraph) => containers.add(paragraph));
      }
    });
  }
  return [...containers];
}

export function updateMediaEmbedTargets(
  root: ParentNode,
  current: readonly MediaEmbedTarget[],
  mountRoot?: HTMLElement,
  containers?: readonly HTMLElement[],
): MediaEmbedTarget[] {
  const mountContainer = mountRoot ?? (root instanceof HTMLElement ? root : null);
  const changed = createMediaEmbedTargets(root, mountContainer ?? undefined, containers);
  const retained = current.filter(
    (target) =>
      target.image.isConnected &&
      root.contains(target.image) &&
      mountContainer?.contains(target.mount) === true &&
      containers !== undefined &&
      !containers.includes(target.container),
  );
  const next = [...retained, ...changed];
  const nextMounts = new Set(next.map((target) => target.mount));
  current.forEach((target) => {
    if (nextMounts.has(target.mount)) return;
    target.mount.remove();
  });
  return next;
}

export function haveSameMediaEmbedTargets(
  current: readonly MediaEmbedTarget[],
  next: readonly MediaEmbedTarget[],
): boolean {
  return (
    current.length === next.length &&
    current.every((target, index) => {
      const nextTarget = next[index];
      if (nextTarget === undefined) return false;
      const properties = Object.entries(target);
      return (
        properties.length === Object.keys(nextTarget).length &&
        properties.every(([key, value]) => Reflect.get(nextTarget, key) === value)
      );
    })
  );
}
