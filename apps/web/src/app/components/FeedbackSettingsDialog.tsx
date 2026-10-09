import { useState } from 'react';
import { Button } from '@base-ui/react/button';
import { Checkbox } from '@base-ui/react/checkbox';
import { Dialog } from '@base-ui/react/dialog';

interface FeedbackSettingsDialogProps {
  readonly sendFeedbackToSubagent: boolean;
  readonly onSave: (enabled: boolean) => void;
  readonly onClose: () => void;
}

export function FeedbackSettingsDialog({
  sendFeedbackToSubagent,
  onSave,
  onClose,
}: FeedbackSettingsDialogProps): React.JSX.Element {
  const [draftSendFeedbackToSubagent, setDraftSendFeedbackToSubagent] =
    useState(sendFeedbackToSubagent);

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
            <div className="dialog-actions">
              <Button type="button" className="button-secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                className="button-primary"
                onClick={() => {
                  onSave(draftSendFeedbackToSubagent);
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
