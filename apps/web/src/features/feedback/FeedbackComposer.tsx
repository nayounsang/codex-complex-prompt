import { Button } from '@base-ui/react/button';
import { useState } from 'react';

import type { SelectionAnchor } from './feedback-types.js';

interface FeedbackComposerProps {
  readonly selection: SelectionAnchor | null;
  readonly initialFeedback?: string;
  readonly onSubmit: (feedback: string) => void;
  readonly onCancel: () => void;
}

export function FeedbackComposer({
  selection,
  initialFeedback = '',
  onSubmit,
  onCancel,
}: FeedbackComposerProps): React.JSX.Element {
  const [feedback, setFeedback] = useState(initialFeedback);
  return (
    <form
      className="feedback-composer"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(feedback);
        setFeedback('');
      }}
    >
      <div className="composer-heading">
        <strong>{selection === null ? 'Global feedback' : 'Feedback on selection'}</strong>
        {selection !== null && <q>{selection.quote}</q>}
      </div>
      <textarea
        id="feedback-input"
        name="feedback"
        aria-label={selection === null ? 'Global feedback' : 'Feedback on selection'}
        value={feedback}
        onChange={(event) => setFeedback(event.target.value)}
        placeholder="What should Codex change?"
        rows={4}
      />
      <div className="composer-actions">
        <Button type="button" className="button-quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="button-primary" disabled={feedback.trim() === ''}>
          Add feedback
        </Button>
      </div>
    </form>
  );
}
