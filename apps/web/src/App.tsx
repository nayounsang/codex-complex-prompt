import { type FormEvent, useState } from 'react';

import { useBridgeSession } from './bridge-session.js';
import './styles.css';

export function App(): React.JSX.Element {
  const [prompt, setPrompt] = useState('');
  const { state, error, submit } = useBridgeSession();
  const isSubmitting = state === 'submitting';

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submit(prompt);
  }

  return (
    <main className="shell">
      <section className="card" aria-labelledby="title">
        <p className="eyebrow">CODEX BRIDGE</p>
        <h1 id="title">Shape your prompt</h1>
        <p className="intro">
          Draft a request in the browser and send it back to the waiting Codex session.
        </p>
        <p className={`status status-${state}`} role="status">
          {state === 'connecting' && 'Connecting to the local bridge…'}
          {state === 'connected' && 'Connected'}
          {state === 'submitting' && 'Sending prompt…'}
          {state === 'success' && 'Prompt sent successfully'}
          {state === 'error' && (error ?? 'Something went wrong')}
          {state === 'disconnected' && 'Bridge connection closed'}
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="prompt">Prompt draft</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="What would you like Codex to help improve?"
            rows={9}
            disabled={isSubmitting}
          />
          <button
            type="submit"
            disabled={isSubmitting || state !== 'connected' || prompt.trim() === ''}
          >
            {isSubmitting ? 'Submitting…' : 'Submit to Codex'}
          </button>
        </form>
      </section>
    </main>
  );
}
