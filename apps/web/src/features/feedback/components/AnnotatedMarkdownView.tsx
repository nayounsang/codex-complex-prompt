import { useCallback, useEffect, useRef, useState } from 'react';

import { LazyMarkdownEditor } from '../../input/components/LazyMarkdownEditor.js';
import {
  decorateMarkdownRoot,
  type SourceFeedbackRange,
} from '../../../shared/markdown/markdown-source-map.js';
import type { FeedbackAnnotation, SelectionAnchor } from '../model/feedback-types.js';
import { SourceFeedbackRangesSchema } from '../model/schema.js';
import { mergeSelectionWithExistingFeedback } from './selection-feedback.js';
import { useAnnotatedMarkdownSelection } from './useAnnotatedMarkdownSelection.js';
import {
  getMediaEmbedAffectedContainers,
  haveSameMediaEmbedTargets,
  updateMediaEmbedTargets,
  type MediaEmbedTarget,
} from '../../../shared/markdown/media-embeds.js';
import { MediaEmbedPreview } from '../../input/components/MediaEmbedPreview.js';

function isPreviewControlTarget(target: Element): boolean {
  return (
    target.closest('.mermaid-preview-open') !== null ||
    target.closest('.mermaid-view-tabs') !== null ||
    target.closest('.media-embed-mount') !== null
  );
}

function getMermaidSelectionAnchor(target: Element, markdown: string): SelectionAnchor | null {
  const diagram = target.closest('.mermaid-preview-open');
  const codeBlock = diagram?.closest<HTMLElement>('.milkdown-code-block');
  if (codeBlock === null || codeBlock === undefined) return null;
  const start = Number(codeBlock.dataset['codeSourceStart']);
  const end = Number(codeBlock.dataset['codeSourceEnd']);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end) return null;
  return { quote: markdown.slice(start, end), start, end, rect: codeBlock.getBoundingClientRect() };
}

interface AnnotatedMarkdownViewProps {
  readonly markdown: string;
  readonly annotations: readonly FeedbackAnnotation[];
  readonly pendingSelection: SelectionAnchor | null;
  readonly onSelection: (selection: SelectionAnchor | null) => void;
  readonly attachmentUrl: string | null;
  readonly attachmentToken: string | null;
  readonly attachmentRefreshKey: number;
}

export function AnnotatedMarkdownView({
  markdown,
  annotations,
  pendingSelection,
  onSelection,
  attachmentUrl,
  attachmentToken,
  attachmentRefreshKey,
}: AnnotatedMarkdownViewProps): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null);
  const [rendererRoot, setRendererRoot] = useState<HTMLDivElement | null>(null);
  const [mediaTargets, setMediaTargets] = useState<MediaEmbedTarget[]>([]);
  const decorationRangeKey = JSON.stringify([
    ...annotations.flatMap((annotation) =>
      annotation.scope === 'selection' &&
      annotation.end > annotation.start &&
      markdown.slice(annotation.start, annotation.end) === annotation.quote
        ? [{ id: annotation.id, start: annotation.start, end: annotation.end }]
        : [],
    ),
    ...(pendingSelection === null
      ? []
      : [{ id: 'pending-selection', start: pendingSelection.start, end: pendingSelection.end }]),
  ]);
  const handleRendererReady = useCallback((root: HTMLDivElement): void => {
    root.setAttribute('aria-label', 'Markdown feedback document');
    setRendererRoot(root);
  }, []);

  const {
    pointerSelectingRef,
    selectionDismissedRef,
    handleSelection,
    handleImageSelection,
    publishSelection,
  } = useAnnotatedMarkdownSelection({
    rootRef,
    markdown,
    annotations,
    selectionPopoverOpen: pendingSelection !== null,
    onSelection,
  });

  useEffect(
    function decorateReadOnlyMarkdown() {
      if (rendererRoot === null) return;
      const rangeData: unknown = JSON.parse(decorationRangeKey);
      const parsedFeedbackRanges = SourceFeedbackRangesSchema.safeParse(rangeData);
      const feedbackRanges: readonly SourceFeedbackRange[] = parsedFeedbackRanges.success
        ? parsedFeedbackRanges.data
        : [];
      const decorate = (records?: readonly MutationRecord[]): void => {
        decorateMarkdownRoot(rendererRoot, markdown, feedbackRanges, markdown, attachmentUrl);
        const paragraphs =
          records === undefined
            ? undefined
            : getMediaEmbedAffectedContainers(rendererRoot, records);
        const mountRoot = rendererRoot.querySelector<HTMLElement>('.milkdown') ?? rootRef.current;
        if (mountRoot === null) return;
        setMediaTargets((current) => {
          const next = updateMediaEmbedTargets(rendererRoot, current, mountRoot, paragraphs);
          return haveSameMediaEmbedTargets(current, next) ? current : next;
        });
      };
      // TODO: Profile large documents; share the Markdown AST/line index and batch renderer churn if costly.
      const observer = new MutationObserver(decorate);
      observer.observe(rendererRoot, { childList: true, characterData: true, subtree: true });
      decorate();
      return () => observer.disconnect();
    },
    [
      attachmentRefreshKey,
      attachmentToken,
      attachmentUrl,
      decorationRangeKey,
      markdown,
      rendererRoot,
    ],
  );

  return (
    <article
      ref={rootRef}
      className="annotated-markdown markdown-surface markdown-content"
      data-testid="annotated-markdown"
      aria-label="Markdown with feedback annotations"
      onMouseDownCapture={(event) => {
        selectionDismissedRef.current = false;
        const target = event.target;
        pointerSelectingRef.current = !(
          target instanceof Element && isPreviewControlTarget(target)
        );
      }}
      onKeyDown={() => {
        selectionDismissedRef.current = false;
      }}
      onKeyDownCapture={(event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const image = target.closest<HTMLImageElement>(
          'img[data-feedback-source-start][data-feedback-source-end]',
        );
        if (image === null || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        selectionDismissedRef.current = false;
        handleImageSelection(image);
      }}
      onClickCapture={(event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest('.mermaid-preview-open') !== null) {
          const anchor = getMermaidSelectionAnchor(target, markdown);
          if (anchor !== null)
            publishSelection(mergeSelectionWithExistingFeedback(anchor, annotations, markdown));
          return;
        }
        const image = target.closest<HTMLImageElement>(
          'img[data-feedback-source-start][data-feedback-source-end]',
        );
        if (image !== null) handleImageSelection(image);
      }}
      onMouseUpCapture={(event) => {
        const target = event.target;
        if (target instanceof Element && isPreviewControlTarget(target)) return;
        pointerSelectingRef.current = false;
        handleSelection();
      }}
    >
      <LazyMarkdownEditor
        defaultMarkdown={markdown}
        readOnly
        loadImmediately
        className="feedback-markdown-renderer"
        testId="feedback-markdown-editor"
        ariaLabel="Markdown feedback document"
        attachmentUrl={attachmentUrl}
        attachmentToken={attachmentToken}
        attachmentRefreshKey={attachmentRefreshKey}
        onReady={handleRendererReady}
      />
      {mediaTargets.map((target) => (
        <MediaEmbedPreview
          key={`${target.id}:${target.path}:${target.alt}`}
          target={target}
          readOnly
        />
      ))}
    </article>
  );
}
