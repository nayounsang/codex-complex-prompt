import { useState } from 'react';
import { Button } from '@base-ui/react/button';

import type { FeedbackAnnotation } from './feedback-types.js';

interface FeedbackPanelProps {
  readonly markdown: string;
  readonly annotations: readonly FeedbackAnnotation[];
  readonly onUpdate: (id: string, feedback: string) => void;
  readonly onDelete: (id: string) => void;
}

export function FeedbackPanel({
  markdown,
  annotations,
  onUpdate,
  onDelete,
}: FeedbackPanelProps): React.JSX.Element {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  return (
    <aside className="feedback-panel" aria-label="Feedback list">
      <div className="panel-heading">
        <h2>Feedback</h2>
        <span className="feedback-count">{annotations.length}</span>
      </div>
      {annotations.length === 0 ? (
        <p className="panel-empty">Select text or add global feedback to get started.</p>
      ) : (
        <ol className="feedback-list">
          {annotations.map((annotation, index) => (
            <li key={annotation.id} className="feedback-item">
              <div className="feedback-item-meta">
                <span>#{index + 1}</span>
                <span
                  className={
                    annotation.scope === 'global'
                      ? 'feedback-scope feedback-scope-global'
                      : 'feedback-scope'
                  }
                >
                  {annotation.scope === 'global' && (
                    <span className="feedback-scope-icon" aria-hidden="true">
                      ●
                    </span>
                  )}
                  {annotation.scope === 'global'
                    ? 'Global'
                    : annotation.start !== undefined &&
                        annotation.end !== undefined &&
                        markdown.slice(annotation.start, annotation.end) === annotation.quote
                      ? 'Selected text'
                      : 'Invalid selection'}
                </span>
              </div>
              {annotation.quote !== undefined && <blockquote>{annotation.quote}</blockquote>}
              {editingId === annotation.id ? (
                <textarea
                  aria-label={`Edit feedback ${index + 1}`}
                  value={editingText}
                  onChange={(event) => setEditingText(event.target.value)}
                />
              ) : (
                <p>{annotation.feedback}</p>
              )}
              <div className="feedback-item-actions">
                {editingId === annotation.id ? (
                  <Button
                    type="button"
                    onClick={() => {
                      onUpdate(annotation.id, editingText);
                      setEditingId(null);
                    }}
                  >
                    Save
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={() => {
                      setEditingId(annotation.id);
                      setEditingText(annotation.feedback);
                    }}
                  >
                    Edit
                  </Button>
                )}
                <Button type="button" onClick={() => onDelete(annotation.id)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}
