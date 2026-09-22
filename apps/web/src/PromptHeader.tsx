import type { FeedbackAnnotation } from './feedback-types.js';
import { ModeTabs } from './ModeTabs.js';
import { PromptActions } from './PromptActions.js';

interface PromptHeaderProps {
  readonly mode: 'edit' | 'feedback';
  readonly isConnected: boolean;
  readonly isSubmitting: boolean;
  readonly isEmpty: boolean;
  readonly feedbackCount: number;
  readonly globalFeedback: FeedbackAnnotation | undefined;
  readonly onModeChange: (mode: 'edit' | 'feedback') => void;
  readonly onSubmit: () => void;
  readonly onSendFeedback: () => void;
  readonly onAddGlobalFeedback: (feedback: string) => void;
}

export function PromptHeader(props: PromptHeaderProps): React.JSX.Element {
  return (
    <section className="app-action-bar" aria-label="Prompt actions">
      <div className="action-inner">
        <ModeTabs mode={props.mode} onChange={props.onModeChange} />
        <PromptActions
          mode={props.mode}
          isConnected={props.isConnected}
          isSubmitting={props.isSubmitting}
          isEmpty={props.isEmpty}
          feedbackCount={props.feedbackCount}
          globalFeedback={props.globalFeedback}
          onSubmit={props.onSubmit}
          onSendFeedback={props.onSendFeedback}
          onAddGlobalFeedback={props.onAddGlobalFeedback}
        />
      </div>
    </section>
  );
}
