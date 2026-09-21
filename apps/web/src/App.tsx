import { type FormEvent, useState } from 'react';

import { useBridgeSession } from './bridge-session.js';
import './styles.css';

export function App(): React.JSX.Element {
  const [command, setCommand] = useState('');
  const { state, error, submit } = useBridgeSession();
  const isSubmitting = state === 'submitting';

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submit(command);
  }

  return (
    <main className="shell">
      <section className="card" aria-labelledby="title">
        <p className="eyebrow">CODEX COMMAND EDITOR</p>
        <h1 id="title">Send a command to Codex</h1>
        <p className="intro">
          Write the command here. AI responses stay in Codex; this window only sends your command.
        </p>
        <p className={`status status-${state}`} role="status">
          {state === 'connecting' && 'Connecting to the local bridge…'}
          {state === 'connected' && 'Command editor ready'}
          {state === 'submitting' && 'Sending command…'}
          {state === 'success' && 'Command sent. This window can be closed.'}
          {state === 'error' && (error ?? 'Something went wrong')}
          {state === 'disconnected' && 'Bridge connection closed'}
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="command">Command</label>
          <textarea
            id="command"
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="예: 테스트를 보강하고 실패 원인을 수정해줘…"
            rows={9}
            disabled={isSubmitting}
          />
          <button
            type="submit"
            disabled={isSubmitting || state !== 'connected' || command.trim() === ''}
          >
            {isSubmitting ? 'Sending…' : 'Send command'}
          </button>
        </form>
      </section>
    </main>
  );
}
