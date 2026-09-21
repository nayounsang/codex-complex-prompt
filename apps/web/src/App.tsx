import { type SyntheticEvent, useCallback, useRef, useState } from 'react';

import { useBridgeSession } from './bridge-session.js';
import { LazyMarkdownEditor } from './LazyMarkdownEditor.js';
import type { MarkdownEditorHandle } from './MarkdownEditor.js';
import './styles.css';

const MAX_PROMPT_LENGTH = 12_000;

export function App(): React.JSX.Element {
  const [markdown, setMarkdown] = useState('');
  const editorRef = useRef<MarkdownEditorHandle>(null);
  const { state, error, closeInSeconds, submit } = useBridgeSession();
  const isSubmitting = state === 'submitting';
  const trimmedMarkdownLength = markdown.trim().length;
  const isOverPromptLimit = trimmedMarkdownLength > MAX_PROMPT_LENGTH;
  const isEmpty = trimmedMarkdownLength === 0;
  const handleMarkdownChange = useCallback((nextMarkdown: string) => {
    setMarkdown(nextMarkdown);
  }, []);

  function handleSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    submit(editorRef.current?.getMarkdown() ?? markdown);
  }

  return (
    <main className="shell">
      <section className="editor-card" aria-labelledby="title">
        <header className="editor-header">
          <div>
            <p className="eyebrow">CODEX COMMAND EDITOR</p>
            <h1 id="title">Write a Markdown command</h1>
          </div>
          <p className="format-hint">Markdown is sent directly to Codex</p>
        </header>
        <p className={`status status-${state}`} role="status">
          {state === 'connecting' && 'Connecting to the local bridge…'}
          {state === 'connected' && 'Command editor ready'}
          {state === 'submitting' && 'Sending command…'}
          {state === 'success' && 'Command sent. This window can be closed.'}
          {state === 'error' && (error ?? 'Something went wrong')}
          {state === 'disconnected' && 'Bridge connection closed'}
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="markdown-editor">Command</label>
          <LazyMarkdownEditor
            ref={editorRef}
            readOnly={isSubmitting}
            onMarkdownChange={handleMarkdownChange}
          />
          <div className="editor-footer">
            <span className={isOverPromptLimit ? 'prompt-limit' : undefined}>
              {trimmedMarkdownLength.toLocaleString()} / {MAX_PROMPT_LENGTH.toLocaleString()}
            </span>
            <span>Images: use Markdown URLs</span>
          </div>
          <button
            type="submit"
            disabled={isSubmitting || state !== 'connected' || isEmpty || isOverPromptLimit}
          >
            {isSubmitting ? 'Sending…' : 'Send to Codex'}
          </button>
          {isOverPromptLimit && (
            <p className="prompt-limit" role="alert">
              Markdown commands must be 12,000 characters or fewer.
            </p>
          )}
        </form>
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
