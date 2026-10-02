import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LazyMarkdownEditor } from '../../input/components/LazyMarkdownEditor.js';
import { makeMarkdownImagesInert } from '../../../shared/markdown/markdown-rendering.js';
import {
  decorateMarkdownRoot,
  type SourceFeedbackRange,
} from '../../../shared/markdown/markdown-source-map.js';
import {
  getCodeBlockSelectionAnchor,
  getImageSelectionAnchor,
  getSelectionAnchor,
  getTableSelectionAnchor,
} from '../../../shared/markdown/selection-anchor.js';
import type { FeedbackAnnotation, SelectionAnchor } from '../model/feedback-types.js';
import { mergeSelectionWithExistingFeedback } from './selection-feedback.js';

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
  const pointerSelectingRef = useRef(false);
  const pendingSelectionRef = useRef<SelectionAnchor | null>(null);
  const selectionDismissedRef = useRef(false);
  const selectionWasOpenRef = useRef(false);
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
      annotation.start !== undefined &&
      annotation.end !== undefined &&
      annotation.end > annotation.start &&
      markdown.slice(annotation.start, annotation.end) === annotation.quote
        ? [{ id: annotation.id, start: annotation.start, end: annotation.end }]
        : [],
    ),
  );
  const publishSelection = useCallback(
    (selection: SelectionAnchor | null): void => {
      pendingSelectionRef.current = selection;
      onSelection(selection);
    },
    [onSelection],
  );
  const handleRendererReady = useCallback((root: HTMLDivElement): void => {
    root.setAttribute('aria-label', 'Markdown feedback document');
    setRendererRoot(root);
  }, []);

  const handleSelection = useCallback((): void => {
    const root = rootRef.current;
    if (root === null) return;
    const tableAnchor = getTableSelectionAnchor(root, markdown);
    const codeBlockAnchor = getCodeBlockSelectionAnchor(root, markdown);
    const selection = window.getSelection();
    const anchor =
      tableAnchor ??
      codeBlockAnchor ??
      (selection === null ||
      selection.rangeCount === 0 ||
      selection.isCollapsed ||
      !root.contains(selection.getRangeAt(0).startContainer) ||
      !root.contains(selection.getRangeAt(0).endContainer)
        ? null
        : getSelectionAnchor(root));
    if (anchor === null) {
      publishSelection(null);
      return;
    }
    publishSelection(mergeSelectionWithExistingFeedback(anchor, annotations, markdown));
  }, [annotations, markdown, publishSelection]);

  const handleImageSelection = useCallback(
    (image: HTMLImageElement): void => {
      const root = rootRef.current;
      if (root === null) return;
      const anchor = getImageSelectionAnchor(root, markdown, image);
      if (anchor === null) return;
      publishSelection(mergeSelectionWithExistingFeedback(anchor, annotations, markdown));
    },
    [annotations, markdown, publishSelection],
  );

  useEffect(
    function decorateReadOnlyMarkdown() {
      if (rendererRoot === null) return;
      const feedbackRanges = JSON.parse(decorationRangeKey) as SourceFeedbackRange[];
      const decorate = (): void => {
        decorateMarkdownRoot(
          rendererRoot,
          renderedMarkdown,
          feedbackRanges,
          markdown,
          attachmentUrl,
        );
      };
      // TODO: Profile large documents; share the Markdown AST/line index and batch renderer churn if costly.
      const observer = new MutationObserver(decorate);
      observer.observe(rendererRoot, { childList: true, characterData: true, subtree: true });
      decorate();
      return () => observer.disconnect();
    },
    [attachmentUrl, decorationRangeKey, markdown, rendererRoot, renderedMarkdown],
  );

  useEffect(
    function dismissNativeSelectionAfterPopoverClose() {
      if (selectionPopoverOpen) {
        selectionWasOpenRef.current = true;
        selectionDismissedRef.current = false;
        return;
      }
      if (!selectionWasOpenRef.current) return;
      selectionWasOpenRef.current = false;
      pendingSelectionRef.current = null;
      selectionDismissedRef.current = true;
      window.getSelection()?.removeAllRanges();
      rootRef.current
        ?.querySelectorAll('.milkdown-table-block .selectedCell')
        .forEach((cell) => cell.classList.remove('selectedCell'));
    },
    [selectionPopoverOpen],
  );

  useEffect(
    function finishSelectionWhenPointerLeavesDocument() {
      const finishPointerSelection = (): void => {
        if (!pointerSelectingRef.current) return;
        pointerSelectingRef.current = false;
        handleSelection();
      };
      const resetPointerSelection = (): void => {
        pointerSelectingRef.current = false;
      };

      document.addEventListener('mouseup', finishPointerSelection, true);
      window.addEventListener('blur', resetPointerSelection);
      return () => {
        document.removeEventListener('mouseup', finishPointerSelection, true);
        window.removeEventListener('blur', resetPointerSelection);
      };
    },
    [handleSelection],
  );

  useEffect(
    function listenForKeyboardSelection() {
      const handleDocumentSelectionChange = (): void => {
        if (pointerSelectingRef.current) return;
        if (selectionDismissedRef.current) return;
        const root = rootRef.current;
        const selection = window.getSelection();
        if (selection?.isCollapsed && pendingSelectionRef.current !== null) return;
        if (
          root === null ||
          selection === null ||
          selection.rangeCount === 0 ||
          !root.contains(selection.getRangeAt(0).startContainer) ||
          !root.contains(selection.getRangeAt(0).endContainer)
        ) {
          return;
        }
        handleSelection();
      };
      document.addEventListener('selectionchange', handleDocumentSelectionChange);
      return () => document.removeEventListener('selectionchange', handleDocumentSelectionChange);
    },
    [handleSelection],
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
          target instanceof Element && target.closest('.mermaid-preview-open') !== null
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
        if (target instanceof Element && target.closest('.mermaid-preview-open') !== null) return;
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
    </article>
  );
}
