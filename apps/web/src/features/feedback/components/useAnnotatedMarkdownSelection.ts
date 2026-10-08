import { useCallback, useEffect, useRef, type RefObject } from 'react';

import {
  getCodeBlockSelectionAnchor,
  getImageSelectionAnchor,
  getSelectionAnchor,
  getTableSelectionAnchor,
} from '../../../shared/markdown/selection-anchor.js';
import type { FeedbackAnnotation, SelectionAnchor } from '../model/feedback-types.js';
import { mergeSelectionWithExistingFeedback } from './selection-feedback.js';

interface UseAnnotatedMarkdownSelectionOptions {
  readonly rootRef: RefObject<HTMLElement | null>;
  readonly markdown: string;
  readonly annotations: readonly FeedbackAnnotation[];
  readonly selectionPopoverOpen: boolean;
  readonly onSelection: (selection: SelectionAnchor | null) => void;
}

export function useAnnotatedMarkdownSelection({
  rootRef,
  markdown,
  annotations,
  selectionPopoverOpen,
  onSelection,
}: UseAnnotatedMarkdownSelectionOptions) {
  const pointerSelectingRef = useRef(false);
  const pendingSelectionRef = useRef<SelectionAnchor | null>(null);
  const selectionDismissedRef = useRef(false);
  const selectionWasOpenRef = useRef(false);

  const publishSelection = useCallback(
    (selection: SelectionAnchor | null): void => {
      pendingSelectionRef.current = selection;
      onSelection(selection);
    },
    [onSelection],
  );

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
  }, [annotations, markdown, publishSelection, rootRef]);

  const handleImageSelection = useCallback(
    (image: HTMLImageElement): void => {
      const root = rootRef.current;
      if (root === null) return;
      const anchor = getImageSelectionAnchor(root, markdown, image);
      if (anchor === null) return;
      publishSelection(mergeSelectionWithExistingFeedback(anchor, annotations, markdown));
    },
    [annotations, markdown, publishSelection, rootRef],
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
    [rootRef, selectionPopoverOpen],
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
        if (pointerSelectingRef.current || selectionDismissedRef.current) return;
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
    [handleSelection, rootRef],
  );

  return {
    pointerSelectingRef,
    selectionDismissedRef,
    handleSelection,
    handleImageSelection,
    publishSelection,
  };
}
