import { useState } from 'react';

import { LazyMarkdownEditor } from './LazyMarkdownEditor.js';
import type { MarkdownEditorHandle } from './MarkdownEditor.js';

interface EditModeViewProps {
  readonly markdown: string;
  readonly isSubmitting: boolean;
  readonly onMarkdownChange: (markdown: string) => void;
  readonly validationError: string | null;
  readonly editorRef: React.RefObject<MarkdownEditorHandle | null>;
}

export function EditModeView({
  markdown,
  isSubmitting,
  onMarkdownChange,
  validationError,
  editorRef,
}: EditModeViewProps): React.JSX.Element {
  const [initialMarkdown] = useState(markdown);
  return (
    <section className="editor-scroll-region" aria-label="Prompt editor">
      <div className="editor-page">
        <LazyMarkdownEditor
          ref={editorRef}
          defaultMarkdown={initialMarkdown}
          readOnly={isSubmitting}
          onMarkdownChange={onMarkdownChange}
        />
        {validationError !== null && (
          <p className="prompt-limit" role="alert">
            {validationError}
          </p>
        )}
      </div>
    </section>
  );
}
