import { useBridgeSession } from '../features/session/hooks/useBridgeSession.js';
import { PromptWorkspace } from '../features/session/components/PromptWorkspace.js';
import './styles.css';

export function App(): React.JSX.Element {
  const bridgeSession = useBridgeSession();

  return (
    <main className="shell">
      <header className="app-header">
        <div className="brand" aria-label="Codex Prompt">
          <span className="brand-mark" aria-hidden="true">
            ◇
          </span>
          <span>Codex Prompt</span>
        </div>
        <p className={`connection-status connection-status-${bridgeSession.state}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          <span>
            {bridgeSession.state === 'connecting' && 'Connecting'}
            {bridgeSession.state === 'connected' && 'Connected'}
            {bridgeSession.state === 'submitting' && 'Sending'}
            {bridgeSession.state === 'success' && 'Sent'}
            {bridgeSession.state === 'error' && (bridgeSession.error ?? 'Something went wrong')}
            {bridgeSession.state === 'disconnected' && 'Disconnected'}
          </span>
        </p>
      </header>
      <PromptWorkspace bridgeSession={bridgeSession} />
    </main>
  );
}
