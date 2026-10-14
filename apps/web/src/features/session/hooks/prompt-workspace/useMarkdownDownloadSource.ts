import { useCallback, useLayoutEffect, type RefObject } from 'react';

import type { MarkdownEditorHandle } from '../../../input/components/MarkdownEditor.js';

interface UseMarkdownDownloadSourceOptions {
  readonly editorRef: RefObject<MarkdownEditorHandle | null>;
  readonly markdown: string;
  readonly getMarkdownForDownloadRef: RefObject<() => string>;
}

export function useMarkdownDownloadSource({
  editorRef,
  markdown,
  getMarkdownForDownloadRef,
}: UseMarkdownDownloadSourceOptions): void {
  const getMarkdownForDownload = useCallback(
    (): string => editorRef.current?.getMarkdown() ?? markdown,
    [editorRef, markdown],
  );

  useLayoutEffect(() => {
    getMarkdownForDownloadRef.current = getMarkdownForDownload;
  }, [getMarkdownForDownloadRef, getMarkdownForDownload]);
}
