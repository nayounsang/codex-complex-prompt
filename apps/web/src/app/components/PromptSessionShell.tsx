import type {
  FeedbackAnnotation,
  SelectionAnchor,
} from '../../features/feedback/model/feedback-types.js';
import { FeedbackModeView } from '../../features/feedback/components/FeedbackModeView.js';
import { EditModeView } from '../../features/input/components/EditModeView.js';
import { PromptHeader } from './PromptHeader.js';
import type { MarkdownEditorHandle } from '../../features/input/components/MarkdownEditor.js';
import type { PromptTemplate } from '@codex-complex-prompt/protocol';

interface PromptSessionShellProps {
  readonly session: {
    readonly mode: 'edit' | 'feedback';
    readonly isConnected: boolean;
    readonly isSubmitting: boolean;
    readonly allowEmptySubmit: boolean;
    readonly onModeChange: (mode: 'edit' | 'feedback') => void;
    readonly onSubmit: () => void;
    readonly onSendFeedback: () => void;
  };
  readonly editor: {
    readonly markdown: string;
    readonly initialMarkdown: string;
    readonly ref: React.RefObject<MarkdownEditorHandle | null>;
    readonly validationError: string | null;
    readonly initializationKey: string;
    readonly onMarkdownChange: (markdown: string) => void;
  };
  readonly feedback: {
    readonly annotations: readonly FeedbackAnnotation[];
    readonly globalAnnotation: FeedbackAnnotation | undefined;
    readonly pendingSelection: SelectionAnchor | null;
    readonly error: string | null;
    readonly onAddGlobal: (feedback: string) => void;
    readonly onSelection: (selection: SelectionAnchor | null) => void;
    readonly onAdd: (feedback: string) => void;
    readonly onCancelSelection: () => void;
    readonly onUpdate: (id: string, feedback: string) => void;
    readonly onDelete: (id: string) => void;
  };
  readonly templates: {
    readonly items: readonly PromptTemplate[];
    readonly error: string | null;
    readonly onApply: (body: string) => void;
    readonly onSave: (template: PromptTemplate) => Promise<{
      status: 'accepted' | 'failed';
      templates?: readonly PromptTemplate[];
      error?: string;
    }>;
    readonly onDelete: (id: string) => Promise<{
      status: 'accepted' | 'failed';
      templates?: readonly PromptTemplate[];
      error?: string;
    }>;
  };
  readonly drawings: {
    readonly onDraw: () => void;
    readonly onImageFiles: (files: readonly File[]) => void | Promise<void>;
    readonly onEdit: (id: string) => void;
    readonly onDelete: (id: string) => void;
    readonly attachmentUrl: string | null;
    readonly attachmentToken: string | null;
    readonly attachmentRefreshKey: number;
  };
}

export function PromptSessionShell(props: PromptSessionShellProps): React.JSX.Element {
  const { session, editor, feedback, templates, drawings } = props;
  return (
    <>
      <PromptHeader
        mode={session.mode}
        isConnected={session.isConnected}
        isSubmitting={session.isSubmitting}
        isEmpty={editor.markdown.trim() === ''}
        allowEmptySubmit={session.allowEmptySubmit}
        feedbackCount={feedback.annotations.length}
        globalFeedback={feedback.globalAnnotation}
        onModeChange={session.onModeChange}
        onSubmit={session.onSubmit}
        onSendFeedback={session.onSendFeedback}
        onAddGlobalFeedback={feedback.onAddGlobal}
        templates={templates.items}
        templatesError={templates.error}
        markdown={editor.markdown}
        onApplyTemplate={templates.onApply}
        onSaveTemplate={templates.onSave}
        onDeleteTemplate={templates.onDelete}
      />
      {session.mode === 'edit' ? (
        <EditModeView
          key={editor.initializationKey}
          initialMarkdown={editor.initialMarkdown}
          isSubmitting={session.isSubmitting}
          onMarkdownChange={editor.onMarkdownChange}
          validationError={editor.validationError}
          editorRef={editor.ref}
          attachmentUrl={drawings.attachmentUrl}
          attachmentToken={drawings.attachmentToken}
          attachmentRefreshKey={drawings.attachmentRefreshKey}
          onDraw={drawings.onDraw}
          onImageFiles={drawings.onImageFiles}
          onEditDrawing={drawings.onEdit}
          onDeleteDrawing={drawings.onDelete}
        />
      ) : (
        <FeedbackModeView
          markdown={editor.markdown}
          annotations={feedback.annotations}
          pendingSelection={feedback.pendingSelection}
          onSelection={feedback.onSelection}
          onAdd={feedback.onAdd}
          onCancel={feedback.onCancelSelection}
          onUpdate={feedback.onUpdate}
          onDelete={feedback.onDelete}
          error={feedback.error}
          attachmentUrl={drawings.attachmentUrl}
          attachmentToken={drawings.attachmentToken}
          attachmentRefreshKey={drawings.attachmentRefreshKey}
        />
      )}
    </>
  );
}
