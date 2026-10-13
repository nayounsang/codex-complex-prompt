import { useRef, useState } from 'react';
import { Download, Settings } from 'lucide-react';
import { useBridgeSession } from '../features/session/hooks/useBridgeSession.js';
import { PromptWorkspace } from '../features/session/components/PromptWorkspace.js';
import { FeedbackSettingsDialog } from './components/FeedbackSettingsDialog.js';
import './styles.css';

const SUBAGENT_SETTING_KEY = 'codex-complex-prompt:send-feedback-to-subagent';

export function App(): React.JSX.Element {
  const bridgeSession = useBridgeSession();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sendFeedbackToSubagent, setSendFeedbackToSubagent] = useState(readSubagentSetting);
  const markdownForDownload = useRef(bridgeSession.initialMarkdown ?? '');

  function downloadMarkdown(): void {
    const blob = new Blob([markdownForDownload.current], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${crypto.randomUUID()}.md`;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function updateSubagentSetting(enabled: boolean): void {
    setSendFeedbackToSubagent(enabled);
    try {
      window.sessionStorage.setItem(SUBAGENT_SETTING_KEY, String(enabled));
    } catch {
      // Keep the current tab's setting even when storage is unavailable.
    }
  }

  return (
    <main className="shell">
      <header className="app-header">
        <div className="app-header-controls">
          <button
            type="button"
            className="settings-trigger"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="settings-trigger"
            aria-label="Download Markdown"
            onClick={downloadMarkdown}
          >
            <Download size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
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
      <PromptWorkspace
        bridgeSession={bridgeSession}
        sendFeedbackToSubagent={sendFeedbackToSubagent}
        markdownForDownload={markdownForDownload}
      />
      {settingsOpen && (
        <FeedbackSettingsDialog
          sendFeedbackToSubagent={sendFeedbackToSubagent}
          onSave={updateSubagentSetting}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}

function readSubagentSetting(): boolean {
  try {
    return window.sessionStorage.getItem(SUBAGENT_SETTING_KEY) === 'true';
  } catch {
    return false;
  }
}
