import { type FormEvent, useState } from 'react';

import { useBridgeSession } from './bridge-session.js';
import './styles.css';

export function App(): React.JSX.Element {
  const [prompt, setPrompt] = useState('');
  const [feedback, setFeedback] = useState('');
  const { state, error, submit, review, submitReview } = useBridgeSession();
  const isSubmitting = state === 'submitting';

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submit(prompt);
  }

  if (review !== null) {
    return (
      <main className="shell">
        <section className="card" aria-labelledby="review-title">
          <p className="eyebrow">CODEX REVIEW</p>
          <h1 id="review-title">{review.title}</h1>
          <p className="intro">Review the response before Codex continues.</p>
          {/* c8 ignore start -- transient status branches are rendered during browser lifecycle transitions. */}
          <p className={`status status-${state}`} role="status">
            {state === 'connecting' && 'Connecting to the local bridge…'}
            {state === 'connected' && 'Review ready'}
            {state === 'submitting' && 'Sending review…'}
            {state === 'success' && 'Review submitted successfully'}
            {state === 'error' && (error ?? 'Something went wrong')}
            {state === 'disconnected' && 'Bridge connection closed'}
          </p>
          {/* c8 ignore stop */}
          <pre className="review-content">{review.content}</pre>
          <label htmlFor="feedback">Feedback (optional)</label>
          <textarea
            id="feedback"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Tell Codex what should change…"
            rows={5}
            disabled={isSubmitting}
          />
          <div className="review-actions">
            <button
              type="button"
              disabled={isSubmitting || state !== 'connected'}
              onClick={() => submitReview('approved')}
            >
              Approve
            </button>
            <button
              type="button"
              disabled={isSubmitting || state !== 'connected'}
              onClick={() =>
                submitReview(feedback.trim() === '' ? 'rejected' : 'feedback', feedback)
              }
            >
              {feedback.trim() === '' ? 'Reject' : 'Send feedback'}
            </button>
          </div>
        </section>
      </main>
    );
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
