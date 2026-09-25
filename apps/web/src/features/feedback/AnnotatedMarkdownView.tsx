import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LazyMarkdownEditor } from '../input/LazyMarkdownEditor.js';
import { makeMarkdownImagesInert } from '../../markdown-rendering.js';
import { decorateMarkdownRoot, type SourceFeedbackRange } from '../../markdown-source-map.js';
import {
  getCodeBlockSelectionAnchor,
  getSelectionAnchor,
  getTableSelectionAnchor,
} from '../../selection-anchor.js';
import type { FeedbackAnnotation, SelectionAnchor } from './feedback-types.js';

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
    const existing = annotations.find(
      (annotation) =>
        annotation.scope === 'selection' &&
        annotation.start !== undefined &&
        annotation.end !== undefined &&
        annotation.start < anchor.end &&
        annotation.end > anchor.start,
    );
    if (existing === undefined) {
      publishSelection(anchor);
      return;
    }
    const start = Math.min(anchor.start, existing.start as number);
    const end = Math.max(anchor.end, existing.end as number);
    publishSelection({
      ...anchor,
      annotationId: existing.id,
      quote: markdown.slice(start, end),
      start,
      end,
    });
  }, [annotations, markdown, publishSelection]);

  useEffect(
    function decorateReadOnlyMarkdown() {
      if (rendererRoot === null) return;
      decorateMarkdownRoot(
        rendererRoot,
        renderedMarkdown,
        JSON.parse(decorationRangeKey) as SourceFeedbackRange[],
      );
    },
    [decorationRangeKey, rendererRoot, renderedMarkdown],
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
      onMouseDownCapture={() => {
        pointerSelectingRef.current = true;
        selectionDismissedRef.current = false;
      }}
      onKeyDown={() => {
        selectionDismissedRef.current = false;
      }}
      onMouseUpCapture={() => {
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
