import { MARKDOWN_UI_REPLACEMENT_MODEL } from './ui-replacements.js';

export interface VideoEmbedTarget {
  readonly id: string;
  readonly mount: HTMLDivElement;
  readonly paragraph: HTMLParagraphElement;
  readonly source: string;
}

let nextVideoEmbedId = 0;
const videoEmbedIds = new WeakMap<HTMLParagraphElement, string>();

export function createVideoEmbedTargets(
  root: ParentNode,
  inertMarkdown?: string,
  mountRoot?: HTMLElement,
  paragraphs?: readonly HTMLParagraphElement[],
): VideoEmbedTarget[] {
  const mountContainer = mountRoot ?? (root instanceof HTMLElement ? root : null);
  if (mountContainer === null) return [];
  const targets: VideoEmbedTarget[] = [];
  (paragraphs ?? Array.from(root.querySelectorAll<HTMLParagraphElement>('p'))).forEach(
    (paragraph) => {
      const children = Array.from(paragraph.childNodes).filter(
        (child) =>
          child.nodeName !== 'BR' &&
          !(
            child instanceof HTMLElement &&
            child.classList.contains(MARKDOWN_UI_REPLACEMENT_MODEL.video.mountClassName)
          ) &&
          !(
            child instanceof HTMLImageElement && child.classList.contains('ProseMirror-separator')
          ) &&
          (child.nodeType !== Node.TEXT_NODE || child.textContent?.trim() !== ''),
      );
      const image =
        children.length === 1 && children[0] instanceof HTMLImageElement ? children[0] : null;
      const source =
        (image === null ? null : getVideoSource(image)) ??
        (inertMarkdown === undefined
          ? null
          : getInertMarkdownVideoSource(paragraph, inertMarkdown));
      paragraph.classList.toggle('video-embed-target', image === null && source !== null);
      const id = videoEmbedIds.get(paragraph);
      let mount =
        id === undefined
          ? null
          : mountContainer.querySelector<HTMLDivElement>(`[data-video-embed-id="${id}"]`);
      if (source === null) {
        mount?.remove();
        return;
      }
      const videoEmbedId = id ?? `video-embed-${nextVideoEmbedId++}`;
      if (id === undefined) videoEmbedIds.set(paragraph, videoEmbedId);
      if (mount === null) {
        mount = document.createElement('div');
        mount.className = MARKDOWN_UI_REPLACEMENT_MODEL.video.mountClassName;
        mount.contentEditable = 'false';
        mount.dataset['markdownUiReplacement'] = MARKDOWN_UI_REPLACEMENT_MODEL.video.kind;
        mountContainer.append(mount);
      }
      mount.dataset['videoEmbedId'] = videoEmbedId;
      targets.push({ id: videoEmbedId, mount, paragraph, source });
    },
  );
  return targets;
}

export function getVideoEmbedAffectedParagraphs(
  root: ParentNode,
  records: readonly MutationRecord[],
): HTMLParagraphElement[] {
  const paragraphs = new Set<HTMLParagraphElement>();
  const includeParagraph = (node: Node): void => {
    const element = node instanceof Element ? node : node.parentElement;
    const paragraph = element?.classList.contains(
      MARKDOWN_UI_REPLACEMENT_MODEL.video.mountClassName,
    )
      ? element.previousElementSibling
      : element?.closest('p');
    if (paragraph instanceof HTMLParagraphElement && root.contains(paragraph)) {
      paragraphs.add(paragraph);
    }
  };
  for (const record of records) {
    includeParagraph(record.target);
    record.addedNodes.forEach((node) => {
      includeParagraph(node);
      if (node instanceof Element) {
        node
          .querySelectorAll<HTMLParagraphElement>('p')
          .forEach((paragraph) => paragraphs.add(paragraph));
      }
    });
  }
  return [...paragraphs];
}

export function updateVideoEmbedTargets(
  root: ParentNode,
  current: readonly VideoEmbedTarget[],
  inertMarkdown?: string,
  mountRoot?: HTMLElement,
  paragraphs?: readonly HTMLParagraphElement[],
): VideoEmbedTarget[] {
  const mountContainer = mountRoot ?? (root instanceof HTMLElement ? root : null);
  const changed = createVideoEmbedTargets(
    root,
    inertMarkdown,
    mountContainer ?? undefined,
    paragraphs,
  );
  const retained = current.filter(
    (target) =>
      target.paragraph.isConnected &&
      root.contains(target.paragraph) &&
      mountContainer?.contains(target.mount) === true &&
      (paragraphs === undefined || !paragraphs.includes(target.paragraph)),
  );
  const changedMounts = new Set(changed.map((target) => target.mount));
  return [...retained.filter((target) => !changedMounts.has(target.mount)), ...changed];
}

export function haveSameVideoEmbedTargets(
  current: readonly VideoEmbedTarget[],
  next: readonly VideoEmbedTarget[],
): boolean {
  return (
    current.length === next.length &&
    current.every((target, index) => {
      const nextTarget = next[index];
      return (
        nextTarget !== undefined &&
        target.id === nextTarget.id &&
        target.mount === nextTarget.mount &&
        target.paragraph === nextTarget.paragraph &&
        target.source === nextTarget.source
      );
    })
  );
}

function getVideoSource(image: HTMLImageElement): string | null {
  if (image.alt.trim() !== '') return null;
  return getVideoSourceUrl(image.dataset['videoSource'] ?? image.src);
}

function getVideoSourceUrl(source: string): string | null {
  try {
    const url = new URL(source, document.baseURI);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (/\.(?:mp4|mov|webm)$/i.test(url.pathname)) return url.href;
    if (
      url.hostname === 'github.com' &&
      /^\/user-attachments\/assets\/[\w-]+\/?$/.test(url.pathname)
    ) {
      return url.href;
    }
    return null;
  } catch {
    return null;
  }
}

function getInertMarkdownVideoSource(
  paragraph: HTMLParagraphElement,
  markdown: string,
): string | null {
  const candidates = Array.from(paragraph.childNodes).filter(
    (child) =>
      child.nodeName !== 'BR' &&
      (child.nodeType !== Node.TEXT_NODE || child.textContent?.trim() !== ''),
  );
  let source: string | null = null;
  if (candidates.length === 1 && candidates[0]?.nodeType === Node.TEXT_NODE) {
    const match = /^!\[\]\((https?:\/\/[^\s)]+)\)$/.exec(candidates[0].textContent?.trim() ?? '');
    source = match?.[1] ?? null;
  } else if (candidates.length === 2) {
    const bang = candidates.find(
      (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim() === '!',
    );
    const linkCandidate = candidates.find((child) => child instanceof HTMLAnchorElement);
    const link = linkCandidate instanceof HTMLAnchorElement ? linkCandidate : undefined;
    if (bang !== undefined && link !== undefined && link.textContent?.trim() === '') {
      source = link.href;
    }
  }
  if (source === null) return null;
  const videoSource = getVideoSourceUrl(source);
  if (videoSource === null) return null;
  return hasStandaloneVideoReference(markdown, source) ? videoSource : null;
}

function hasStandaloneVideoReference(markdown: string, source: string): boolean {
  const sourceLine = MARKDOWN_UI_REPLACEMENT_MODEL.video.standaloneMarkdown(source);
  return markdown.split(/\r\n|\n|\r/).some((line) => line.trim() === sourceLine);
}
