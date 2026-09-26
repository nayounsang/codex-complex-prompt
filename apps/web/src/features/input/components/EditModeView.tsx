import { useState } from 'react';

import { LazyMarkdownEditor } from './LazyMarkdownEditor.js';
import type { MarkdownEditorHandle } from './MarkdownEditor.js';

interface EditModeViewProps {
  readonly initialMarkdown: string;
  readonly isSubmitting: boolean;
  readonly onMarkdownChange: (markdown: string) => void;
  readonly validationError: string | null;
  readonly editorRef: React.RefObject<MarkdownEditorHandle | null>;
  readonly attachmentUrl: string | null;
  readonly attachmentToken: string | null;
  readonly attachmentRefreshKey: number;
  readonly onDraw: () => void;
  readonly onEditDrawing: (id: string) => void;
  readonly onDeleteDrawing: (id: string) => void;
}

export function EditModeView({
  initialMarkdown: editorInitialMarkdown,
  isSubmitting,
  onMarkdownChange,
  validationError,
  editorRef,
  attachmentUrl,
  attachmentToken,
  attachmentRefreshKey,
  onDraw,
  onEditDrawing,
  onDeleteDrawing,
}: EditModeViewProps): React.JSX.Element {
  const [initialMarkdown] = useState(editorInitialMarkdown);
  return (
    <section className="editor-scroll-region" aria-label="Prompt editor">
      <div className="editor-page">
        <LazyMarkdownEditor
          ref={editorRef}
          defaultMarkdown={initialMarkdown}
          readOnly={isSubmitting}
          onMarkdownChange={onMarkdownChange}
          attachmentUrl={attachmentUrl}
          attachmentToken={attachmentToken}
          attachmentRefreshKey={attachmentRefreshKey}
          onDraw={onDraw}
          onEditDrawing={onEditDrawing}
          onDeleteDrawing={onDeleteDrawing}
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
