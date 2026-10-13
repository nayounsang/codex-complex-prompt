import { useState } from 'react';
import { Settings } from 'lucide-react';
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

  function updateSubagentSetting(enabled: boolean): void {
    setSendFeedbackToSubagent(enabled);
    try {
      window.sessionStorage.setItem(SUBAGENT_SETTING_KEY, String(enabled));
    } catch {
      // Keep the current tab's setting even when storage is unavailable.
    }
  }

  function updateFeedbackModelSetting(option: FeedbackModelOption): void {
    setFeedbackModelValue(option.value);
    try {
      window.sessionStorage.setItem(FEEDBACK_MODEL_SETTING_KEY, option.value);
    } catch {
      // Keep the current tab's setting even when storage is unavailable.
    }
  }

  return (
    <main className="shell">
      <header className="app-header">
        <button
          type="button"
          className="settings-trigger"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={20} strokeWidth={1.8} aria-hidden="true" />
        </button>
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
      />
      {settingsOpen && (
        <FeedbackSettingsDialog
          sendFeedbackToSubagent={sendFeedbackToSubagent}
          feedbackModelValue={feedbackModelValue}
          feedbackModelOptions={feedbackModelOptions}
          feedbackModelCatalogLoading={bridgeSession.feedbackModelCatalogLoading}
          onSave={(enabled, modelOption) => {
            updateSubagentSetting(enabled);
            if (!bridgeSession.feedbackModelCatalogLoading) updateFeedbackModelSetting(modelOption);
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
