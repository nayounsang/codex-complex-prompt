import type { FeedbackAnnotation, SelectionAnchor } from './feedback-types.js';
import { FeedbackModeView } from './FeedbackModeView.js';
import { EditModeView } from './EditModeView.js';
import { PromptHeader } from './PromptHeader.js';
import type { MarkdownEditorHandle } from './MarkdownEditor.js';

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
      />
      {props.mode === 'edit' ? (
        <EditModeView
          key={props.editorInitializationKey}
          initialMarkdown={props.editorInitialMarkdown}
          isSubmitting={props.isSubmitting}
          onMarkdownChange={props.onMarkdownChange}
          validationError={props.validationError}
          editorRef={props.editorRef}
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
        />
      )}
    </>
  );
}
