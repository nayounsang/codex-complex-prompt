import { useRef, useState } from 'react';
import { Download, Settings } from 'lucide-react';
import { saveAs } from 'file-saver';
import { useBridgeSession } from '../features/session/hooks/useBridgeSession.js';
import { PromptWorkspace } from '../features/session/components/PromptWorkspace.js';
import { FeedbackSettingsDialog } from './components/FeedbackSettingsDialog.js';
import {
  createFeedbackModelOptions,
  getFeedbackModel,
  getFeedbackModelOption,
  type FeedbackModelOption,
} from './model/feedback-model-options.js';
import './styles.css';

const SUBAGENT_SETTING_KEY = 'codex-complex-prompt:send-feedback-to-subagent';
const FEEDBACK_MODEL_SETTING_KEY = 'codex-complex-prompt:feedback-model';

export function App(): React.JSX.Element {
  const bridgeSession = useBridgeSession();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sendFeedbackToSubagent, setSendFeedbackToSubagent] = useState(readSubagentSetting);
  const feedbackModelOptions = createFeedbackModelOptions(bridgeSession.feedbackModelCatalog);
  const [feedbackModelValue, setFeedbackModelValue] = useState(readFeedbackModelSetting);
  const feedbackModelOption = getFeedbackModelOption(feedbackModelValue, feedbackModelOptions);
  const getMarkdownForDownloadRef = useRef(() => bridgeSession.initialMarkdown ?? '');

  function downloadMarkdown(): void {
    const blob = new Blob([getMarkdownForDownloadRef.current()], {
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

  function updateFeedbackModelSetting(option: FeedbackModelOption, persist: boolean): void {
    setFeedbackModelValue(option.value);
    if (!persist) return;
    try {
      window.sessionStorage.setItem(FEEDBACK_MODEL_SETTING_KEY, option.value);
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
        feedbackModel={sendFeedbackToSubagent ? getFeedbackModel(feedbackModelOption) : undefined}
        getMarkdownForDownloadRef={getMarkdownForDownloadRef}
      />
      {settingsOpen && (
        <FeedbackSettingsDialog
          sendFeedbackToSubagent={sendFeedbackToSubagent}
          feedbackModelValue={feedbackModelValue}
          feedbackModelOptions={feedbackModelOptions}
          feedbackModelCatalogLoading={bridgeSession.feedbackModelCatalogLoading}
          onSave={(enabled, modelOption) => {
            updateSubagentSetting(enabled);
            if (!bridgeSession.feedbackModelCatalogLoading)
              updateFeedbackModelSetting(modelOption, !bridgeSession.feedbackLoop);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </main>
  );
}

function readFeedbackModelSetting(): string | null {
  try {
    return window.sessionStorage.getItem(FEEDBACK_MODEL_SETTING_KEY);
  } catch {
    return null;
  }
}

function readSubagentSetting(): boolean {
  try {
    return window.sessionStorage.getItem(SUBAGENT_SETTING_KEY) === 'true';
  } catch {
    return false;
  }
}
