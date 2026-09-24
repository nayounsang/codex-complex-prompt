import type { FeedbackAnnotation } from '../../features/feedback/model/feedback-types.js';
import { ModeTabs } from './ModeTabs.js';
import { PromptActions } from './PromptActions.js';
import { TemplateManager } from '../../features/templates/components/TemplateManager.js';
import type { PromptTemplate } from '@codex-complex-prompt/protocol';

interface PromptHeaderProps {
  readonly mode: 'edit' | 'feedback';
  readonly isConnected: boolean;
  readonly isSubmitting: boolean;
  readonly isEmpty: boolean;
  readonly allowEmptySubmit: boolean;
  readonly feedbackCount: number;
  readonly globalFeedback: FeedbackAnnotation | undefined;
  readonly onModeChange: (mode: 'edit' | 'feedback') => void;
  readonly onSubmit: () => void;
  readonly onSendFeedback: () => void;
  readonly onAddGlobalFeedback: (feedback: string) => void;
  readonly templates: readonly PromptTemplate[];
  readonly templatesError: string | null;
  readonly markdown: string;
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
}

export function PromptHeader(props: PromptHeaderProps): React.JSX.Element {
  return (
    <section className="app-action-bar" aria-label="Prompt actions">
      <div className="action-inner">
        <ModeTabs mode={props.mode} onChange={props.onModeChange} />
        {props.mode === 'edit' && (
          <TemplateManager
            templates={props.templates}
            templatesError={props.templatesError}
            markdown={props.markdown}
            isDisabled={!props.isConnected || props.isSubmitting}
            onApply={props.onApplyTemplate}
            onSave={props.onSaveTemplate}
            onDelete={props.onDeleteTemplate}
          />
        )}
        <PromptActions
          mode={props.mode}
          isConnected={props.isConnected}
          isSubmitting={props.isSubmitting}
          isEmpty={props.isEmpty}
          allowEmptySubmit={props.allowEmptySubmit}
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
