import { Button } from '@base-ui/react/button';
import { Popover } from '@base-ui/react/popover';
import { useState } from 'react';

import type { FeedbackAnnotation } from './feedback-types.js';
import { FeedbackComposer } from './FeedbackComposer.js';

interface PromptActionsProps {
  readonly mode: 'edit' | 'feedback';
  readonly isConnected: boolean;
  readonly isSubmitting: boolean;
  readonly isEmpty: boolean;
  readonly feedbackCount: number;
  readonly globalFeedback: FeedbackAnnotation | undefined;
  readonly onSubmit: () => void;
  readonly onSendFeedback: () => void;
  readonly onAddGlobalFeedback: (feedback: string) => void;
}

export function PromptActions({
  mode,
  isConnected,
  isSubmitting,
  isEmpty,
  feedbackCount,
  globalFeedback,
  onSubmit,
  onSendFeedback,
  onAddGlobalFeedback,
}: PromptActionsProps): React.JSX.Element {
  const [globalFeedbackOpen, setGlobalFeedbackOpen] = useState(false);
  return (
    <div className="prompt-actions">
      {mode === 'feedback' && (
        <>
          <Popover.Root open={globalFeedbackOpen} onOpenChange={setGlobalFeedbackOpen}>
            <Popover.Trigger
              id="global-feedback-trigger"
              className={`button-secondary header-feedback-button${globalFeedback === undefined ? '' : ' has-global-feedback'}`}
              aria-label={
                globalFeedback === undefined ? 'Add global feedback' : 'Edit global feedback'
              }
              disabled={isSubmitting}
            >
              <span className="global-feedback-icon" aria-hidden="true">
                ●
              </span>
              <span>Global feedback</span>
              {globalFeedback !== undefined && <span className="global-feedback-state">Added</span>}
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner side="bottom" sideOffset={8} align="end" collisionPadding={12}>
                <Popover.Popup className="feedback-popover" initialFocus={true}>
                  <FeedbackComposer
                    selection={null}
                    initialFeedback={globalFeedback?.feedback ?? ''}
                    onSubmit={(feedback) => {
                      onAddGlobalFeedback(feedback);
                      setGlobalFeedbackOpen(false);
                    }}
                    onCancel={() => setGlobalFeedbackOpen(false)}
                  />
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
          <Button
            type="button"
            className="button-primary"
            disabled={!isConnected || isSubmitting || feedbackCount === 0}
            onClick={onSendFeedback}
          >
            {isSubmitting
              ? 'Sending…'
              : `Send Feedback${feedbackCount > 0 ? ` (${feedbackCount})` : ''}`}
          </Button>
        </>
      )}
      <Button
        type="button"
        className="button-secondary"
        aria-label={mode === 'edit' && !isSubmitting ? 'Send to Codex' : undefined}
        disabled={!isConnected || isSubmitting || isEmpty}
        onClick={onSubmit}
      >
        {isSubmitting && mode === 'edit' ? 'Sending…' : 'Submit'}
      </Button>
    </div>
  );
}
