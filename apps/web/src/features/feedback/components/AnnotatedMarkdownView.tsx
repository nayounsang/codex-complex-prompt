import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LazyMarkdownEditor } from '../../input/components/LazyMarkdownEditor.js';
import { makeMarkdownImagesInert } from '../../../shared/markdown/markdown-rendering.js';
import {
  decorateMarkdownRoot,
  type SourceFeedbackRange,
} from '../../../shared/markdown/markdown-source-map.js';
import type { FeedbackAnnotation, SelectionAnchor } from '../model/feedback-types.js';
import { SourceFeedbackRangesSchema } from '../model/schema.js';
import { mergeSelectionWithExistingFeedback } from './selection-feedback.js';
import { useAnnotatedMarkdownSelection } from './useAnnotatedMarkdownSelection.js';
import {
  getVideoEmbedAffectedParagraphs,
  haveSameVideoEmbedTargets,
  updateVideoEmbedTargets,
  type VideoEmbedTarget,
} from '../../../shared/markdown/video-embeds.js';
import { VideoEmbedPreview } from '../../input/components/VideoEmbedPreview.js';

interface AnnotatedMarkdownViewProps {
  readonly markdown: string;
  readonly annotations: readonly FeedbackAnnotation[];
  readonly selectionPopoverOpen: boolean;
  readonly onSelection: (selection: SelectionAnchor | null) => void;
  readonly attachmentUrl: string | null;
  readonly attachmentToken: string | null;
  readonly attachmentRefreshKey: number;
}

export function AnnotatedMarkdownView({
  markdown,
  annotations,
  selectionPopoverOpen,
  onSelection,
  attachmentUrl,
  attachmentToken,
  attachmentRefreshKey,
}: AnnotatedMarkdownViewProps): React.JSX.Element {
  const rootRef = useRef<HTMLElement>(null);
  const [rendererRoot, setRendererRoot] = useState<HTMLDivElement | null>(null);
  const [videoTargets, setVideoTargets] = useState<VideoEmbedTarget[]>([]);
  const renderedMarkdown = useMemo(
    () =>
      makeMarkdownImagesInert(
        markdown,
        attachmentUrl === null || attachmentToken === null
          ? undefined
          : { baseUrl: attachmentUrl, token: attachmentToken, refreshKey: attachmentRefreshKey },
      ),
    [attachmentRefreshKey, attachmentToken, attachmentUrl, markdown],
  );
  const decorationRangeKey = JSON.stringify(
    annotations.flatMap((annotation) =>
      annotation.scope === 'selection' &&
      annotation.end > annotation.start &&
      markdown.slice(annotation.start, annotation.end) === annotation.quote
        ? [{ id: annotation.id, start: annotation.start, end: annotation.end }]
        : [],
    ),
  );
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
    selectionPopoverOpen,
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
        decorateMarkdownRoot(
          rendererRoot,
          renderedMarkdown,
          feedbackRanges,
          markdown,
          attachmentUrl,
        );
        const paragraphs =
          records === undefined
            ? undefined
            : getVideoEmbedAffectedParagraphs(rendererRoot, records);
        const mountRoot = rootRef.current;
        if (mountRoot === null) return;
        setVideoTargets((current) => {
          const next = updateVideoEmbedTargets(
            rendererRoot,
            current,
            markdown,
            mountRoot,
            paragraphs,
          );
          return haveSameVideoEmbedTargets(current, next) ? current : next;
        });
      };
      // TODO: Profile large documents; share the Markdown AST/line index and batch renderer churn if costly.
      const observer = new MutationObserver(decorate);
      observer.observe(rendererRoot, { childList: true, characterData: true, subtree: true });
      decorate();
      return () => observer.disconnect();
    },
    [attachmentUrl, decorationRangeKey, markdown, rendererRoot, renderedMarkdown],
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
          target instanceof Element &&
          (target.closest('.mermaid-preview-open') !== null ||
            target.closest('.video-embed-mount') !== null)
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
        const diagram = target.closest('.mermaid-preview-open');
        if (diagram !== null) {
          const codeBlock = diagram.closest<HTMLElement>('.milkdown-code-block');
          if (codeBlock === null) return;
          const start = Number(codeBlock.dataset['codeSourceStart']);
          const end = Number(codeBlock.dataset['codeSourceEnd']);
          if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) return;
          const anchor: SelectionAnchor = {
            quote: markdown.slice(start, end),
            start,
            end,
            rect: codeBlock.getBoundingClientRect(),
          };
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
        if (
          target instanceof Element &&
          (target.closest('.mermaid-preview-open') !== null ||
            target.closest('.video-embed-mount') !== null)
        )
          return;
        pointerSelectingRef.current = false;
        handleSelection();
      }}
    >
      <LazyMarkdownEditor
        defaultMarkdown={renderedMarkdown}
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
      {videoTargets.map((target) => (
        <VideoEmbedPreview key={`${target.id}:${target.source}`} target={target} />
      ))}
    </article>
  );
}
