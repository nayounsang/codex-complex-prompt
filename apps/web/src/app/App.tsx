import { useRef, useState } from 'react';
import { Download, Settings } from 'lucide-react';
import { saveAs } from 'file-saver';
import { useBridgeSession } from '../features/session/hooks/useBridgeSession.js';
import { PromptWorkspace } from '../features/session/components/PromptWorkspace.js';
import { FeedbackSettingsDialog } from './components/FeedbackSettingsDialog.js';
import './styles.css';

const SUBAGENT_SETTING_KEY = 'codex-complex-prompt:send-feedback-to-subagent';

export function App(): React.JSX.Element {
  const bridgeSession = useBridgeSession();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sendFeedbackToSubagent, setSendFeedbackToSubagent] = useState(readSubagentSetting);
  const markdownForDownloadRef = useRef(bridgeSession.initialMarkdown ?? '');

  function downloadMarkdown(): void {
    const blob = new Blob([markdownForDownloadRef.current], {
      type: 'text/markdown;charset=utf-8',
    });
    saveAs(blob, `${crypto.randomUUID()}.md`);
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
        markdownForDownloadRef={markdownForDownloadRef}
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
