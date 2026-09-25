import type { FeedbackAnnotation, SelectionAnchor } from './features/feedback/feedback-types.js';
import { FeedbackModeView } from './features/feedback/FeedbackModeView.js';
import { EditModeView } from './features/input/EditModeView.js';
import { PromptHeader } from './PromptHeader.js';
import type { MarkdownEditorHandle } from './features/input/MarkdownEditor.js';
import type { PromptTemplate } from '@codex-complex-prompt/protocol';

interface PromptSessionShellProps {
  readonly mode: 'edit' | 'feedback';
  readonly markdown: string;
  readonly editorInitialMarkdown: string;
  readonly editorRef: React.RefObject<MarkdownEditorHandle | null>;
  readonly isConnected: boolean;
  readonly isSubmitting: boolean;
  readonly feedback: readonly FeedbackAnnotation[];
  readonly globalFeedback: FeedbackAnnotation | undefined;
  readonly pendingSelection: SelectionAnchor | null;
  readonly validationError: string | null;
  readonly feedbackError: string | null;
  readonly allowEmptySubmit: boolean;
  readonly editorInitializationKey: string;
  readonly onModeChange: (mode: 'edit' | 'feedback') => void;
  readonly onMarkdownChange: (markdown: string) => void;
  readonly onSubmit: () => void;
  readonly onSendFeedback: () => void;
  readonly onAddGlobalFeedback: (feedback: string) => void;
  readonly onSelection: (selection: SelectionAnchor | null) => void;
  readonly onAddFeedback: (feedback: string) => void;
  readonly onCancelSelection: () => void;
  readonly onUpdateFeedback: (id: string, feedback: string) => void;
  readonly onDeleteFeedback: (id: string) => void;
  readonly templates: readonly PromptTemplate[];
  readonly templatesError: string | null;
  readonly onApplyTemplate: (body: string) => void;
  readonly onSaveTemplate: (template: PromptTemplate) => Promise<{
    status: 'accepted' | 'failed';
    templates?: readonly PromptTemplate[];
    error?: string;
  }>;
  readonly onDeleteTemplate: (id: string) => Promise<{
    status: 'accepted' | 'failed';
    templates?: readonly PromptTemplate[];
    error?: string;
  }>;
  readonly drawings: readonly { id: string; label: string }[];
  readonly onDraw: () => void;
  readonly onEditDrawing: (id: string) => void;
  readonly onDeleteDrawing: (id: string) => void;
  readonly attachmentUrl: string | null;
  readonly attachmentToken: string | null;
  readonly attachmentRefreshKey: number;
}

export function PromptSessionShell(props: PromptSessionShellProps): React.JSX.Element {
  return (
    <>
      <PromptHeader
        mode={props.mode}
        isConnected={props.isConnected}
        isSubmitting={props.isSubmitting}
        isEmpty={props.markdown.trim() === ''}
        allowEmptySubmit={props.allowEmptySubmit}
        feedbackCount={props.feedback.length}
        globalFeedback={props.globalFeedback}
        onModeChange={props.onModeChange}
        onSubmit={props.onSubmit}
        onSendFeedback={props.onSendFeedback}
        onAddGlobalFeedback={props.onAddGlobalFeedback}
        templates={props.templates}
        templatesError={props.templatesError}
        markdown={props.markdown}
        onApplyTemplate={props.onApplyTemplate}
        onSaveTemplate={props.onSaveTemplate}
        onDeleteTemplate={props.onDeleteTemplate}
      />
      {props.mode === 'edit' ? (
        <EditModeView
          key={props.editorInitializationKey}
          initialMarkdown={props.editorInitialMarkdown}
          isSubmitting={props.isSubmitting}
          onMarkdownChange={props.onMarkdownChange}
          validationError={props.validationError}
          editorRef={props.editorRef}
          attachmentUrl={props.attachmentUrl}
          attachmentToken={props.attachmentToken}
          attachmentRefreshKey={props.attachmentRefreshKey}
          drawings={props.drawings}
          onDraw={props.onDraw}
          onEditDrawing={props.onEditDrawing}
          onDeleteDrawing={props.onDeleteDrawing}
        />
      ) : (
        <FeedbackModeView
          markdown={props.markdown}
          annotations={props.feedback}
          pendingSelection={props.pendingSelection}
          onSelection={props.onSelection}
          onAdd={props.onAddFeedback}
          onCancel={props.onCancelSelection}
          onUpdate={props.onUpdateFeedback}
          onDelete={props.onDeleteFeedback}
          error={props.feedbackError}
          attachmentUrl={props.attachmentUrl}
          attachmentToken={props.attachmentToken}
          attachmentRefreshKey={props.attachmentRefreshKey}
        />
      )}
    </>
  );
}
