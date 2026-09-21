import { type SyntheticEvent, useCallback, useRef, useState } from 'react';

import { useBridgeSession } from './bridge-session.js';
import { LazyMarkdownEditor } from './LazyMarkdownEditor.js';
import type { MarkdownEditorHandle } from './MarkdownEditor.js';
import './styles.css';

const MAX_PROMPT_LENGTH = 12_000;

export function App(): React.JSX.Element {
  const [markdown, setMarkdown] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const { state, error, closeInSeconds, submit } = useBridgeSession();
  const isSubmitting = state === 'submitting';
  const isEmpty = markdown.trim().length === 0;
  const handleMarkdownChange = useCallback((nextMarkdown: string) => {
    setMarkdown(nextMarkdown);
    setValidationError(null);
  }, []);

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const prompt = editorRef.current?.getMarkdown() ?? markdown;
    if (prompt.trim().length > MAX_PROMPT_LENGTH) {
      setValidationError('Markdown commands must be 12,000 characters or fewer.');
      return;
    }
    setValidationError(null);
    submit(prompt);
  }

  return (
    <main className="shell">
      <header className="app-header">
        <div className="brand" aria-label="Codex Prompt">
          <span className="brand-mark" aria-hidden="true">
            ◇
          </span>
          <span>Codex Prompt</span>
        </div>
        <p className={`connection-status connection-status-${state}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          <span>
            {state === 'connecting' && 'Connecting'}
            {state === 'connected' && 'Connected'}
            {state === 'submitting' && 'Sending'}
            {state === 'success' && 'Sent'}
            {state === 'error' && (error ?? 'Something went wrong')}
            {state === 'disconnected' && 'Disconnected'}
          </span>
        </p>
      </header>
      <section className="app-action-bar" aria-label="Prompt actions">
        <div className="action-inner">
          <button
            type="submit"
            form="prompt-form"
            disabled={isSubmitting || state !== 'connected' || isEmpty}
          >
            {isSubmitting ? 'Sending…' : 'Send to Codex'}
          </button>
        </div>
      </section>
      <section className="editor-scroll-region" aria-label="Prompt editor">
        <div className="editor-page">
          <form id="prompt-form" className="prompt-form" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="markdown-editor">
              Command
            </label>
            <LazyMarkdownEditor
              ref={editorRef}
              readOnly={isSubmitting}
              onMarkdownChange={handleMarkdownChange}
            />
            {validationError !== null && (
              <p className="prompt-limit" role="alert">
                {validationError}
              </p>
            )}
          </form>
        </div>
      </section>
      {closeInSeconds !== null && (
        <div className="countdown-backdrop">
          <section
            className="countdown-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="countdown-title"
          >
            <p className="eyebrow">COMMAND SENT</p>
            <h2 id="countdown-title">명령이 전송되었습니다</h2>
            <p>{closeInSeconds}초 후 이 창이 닫힙니다.</p>
          </section>
        </div>
      )}
    </main>
  );
}
