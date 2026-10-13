import { useState } from 'react';
import { Button } from '@base-ui/react/button';
import { Checkbox } from '@base-ui/react/checkbox';
import { Dialog } from '@base-ui/react/dialog';
import Select from 'react-select';
import { type FeedbackModelOption } from '../model/feedback-model-options.js';

interface FeedbackSettingsDialogProps {
  readonly sendFeedbackToSubagent: boolean;
  readonly feedbackModelOption: FeedbackModelOption;
  readonly feedbackModelOptions: readonly FeedbackModelOption[];
  readonly onSave: (enabled: boolean, modelOption: FeedbackModelOption) => void;
  readonly onClose: () => void;
}

export function FeedbackSettingsDialog({
  sendFeedbackToSubagent,
  feedbackModelOption,
  feedbackModelOptions,
  onSave,
  onClose,
}: FeedbackSettingsDialogProps): React.JSX.Element {
  const [draftSendFeedbackToSubagent, setDraftSendFeedbackToSubagent] =
    useState(sendFeedbackToSubagent);
  const [draftFeedbackModelOption, setDraftFeedbackModelOption] = useState(feedbackModelOption);

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
              <span>Feedback Model</span>
              <Select<FeedbackModelOption, false>
                inputId="feedback-model-select"
                classNamePrefix="feedback-model-select"
                options={feedbackModelOptions}
                value={draftFeedbackModelOption}
                onChange={(option) => {
                  if (option !== null) setDraftFeedbackModelOption(option);
                }}
                isSearchable
                menuPlacement="auto"
              />
              {feedbackModelOptions.length === 1 && (
                <span className="settings-field-hint">
                  Model choices are unavailable from the current Codex runtime.
                </span>
              )}
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
