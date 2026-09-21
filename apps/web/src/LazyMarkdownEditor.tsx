import { forwardRef, lazy, Suspense } from 'react';

import type { MarkdownEditorHandle, MarkdownEditorProps } from './MarkdownEditor.js';

const MarkdownEditor = lazy(async function loadMarkdownEditor() {
  const module = await import('./MarkdownEditor.js');
  return { default: module.MarkdownEditor };
});

export const LazyMarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function LazyMarkdownEditor(props, forwardedRef): React.JSX.Element {
    return (
      <Suspense fallback={<MarkdownEditorFallback readOnly={props.readOnly ?? false} />}>
        <MarkdownEditor {...props} ref={forwardedRef} />
      </Suspense>
    );
  },
);

function MarkdownEditorFallback({ readOnly = false }: Pick<MarkdownEditorProps, 'readOnly'>) {
  return (
    <div
      id="markdown-editor"
      className="markdown-editor markdown-editor-loading"
      data-testid="markdown-editor"
      role="group"
      aria-label="Markdown command editor"
      aria-busy="true"
      aria-disabled={readOnly}
    >
      Loading editor…
    </div>
  );
}
