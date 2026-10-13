import { useState } from 'react';
import { Button } from '@base-ui/react/button';
import { Checkbox } from '@base-ui/react/checkbox';
import { Dialog } from '@base-ui/react/dialog';
import Select from 'react-select';
import {
  getFeedbackModelOption,
  type FeedbackModelOption,
} from '../model/feedback-model-options.js';

interface FeedbackSettingsDialogProps {
  readonly sendFeedbackToSubagent: boolean;
  readonly feedbackModelValue: string | null;
  readonly feedbackModelOptions: readonly FeedbackModelOption[];
  readonly feedbackModelCatalogLoading: boolean;
  readonly onSave: (enabled: boolean, modelOption: FeedbackModelOption) => void;
  readonly onClose: () => void;
}

export function FeedbackSettingsDialog({
  sendFeedbackToSubagent,
  feedbackModelValue,
  feedbackModelOptions,
  feedbackModelCatalogLoading,
  onSave,
  onClose,
}: FeedbackSettingsDialogProps): React.JSX.Element {
  const [draftSendFeedbackToSubagent, setDraftSendFeedbackToSubagent] =
    useState(sendFeedbackToSubagent);
  const [draftFeedbackModelValue, setDraftFeedbackModelValue] = useState(feedbackModelValue);
  const draftFeedbackModelOption = getFeedbackModelOption(
    draftFeedbackModelValue,
    feedbackModelOptions,
  );

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Viewport className="dialog-viewport">
          <Dialog.Popup className="feedback-settings-dialog">
            <Dialog.Title>Settings</Dialog.Title>
            <Dialog.Description>Settings for codex-complex-prompt</Dialog.Description>
            <label className="settings-checkbox-row">
              <Checkbox.Root
                className="settings-checkbox"
                checked={draftSendFeedbackToSubagent}
                onCheckedChange={(checked) => setDraftSendFeedbackToSubagent(checked === true)}
              >
                <Checkbox.Indicator className="settings-checkbox-indicator">✓</Checkbox.Indicator>
              </Checkbox.Root>
              <span>Send feedback to subagent</span>
            </label>
            <label className="feedback-model-field" htmlFor="feedback-model-select">
              <span>Sub Agent model</span>
              <Select<FeedbackModelOption, false>
                inputId="feedback-model-select"
                classNamePrefix="feedback-model-select"
                options={feedbackModelOptions}
                value={draftFeedbackModelOption}
                isDisabled={!draftSendFeedbackToSubagent || feedbackModelCatalogLoading}
                onChange={(option) => {
                  if (option !== null) setDraftFeedbackModelValue(option.value);
                }}
                isSearchable
                menuPlacement="auto"
              />
              {feedbackModelCatalogLoading ? (
                <span className="settings-field-hint">Loading model choices from Codex…</span>
              ) : feedbackModelOptions.length === 1 ? (
                <span className="settings-field-hint">
                  Model choices are unavailable from the current Codex runtime.
                </span>
              ) : null}
            </label>
            <div className="dialog-actions">
              <Button type="button" className="button-secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                className="button-primary"
                onClick={() => {
                  onSave(draftSendFeedbackToSubagent, draftFeedbackModelOption);
                  onClose();
                }}
              >
                Save
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
