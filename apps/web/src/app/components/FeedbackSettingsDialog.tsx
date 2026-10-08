import { Button } from '@base-ui/react/button';
import { Checkbox } from '@base-ui/react/checkbox';
import { Dialog } from '@base-ui/react/dialog';

interface FeedbackSettingsDialogProps {
  readonly sendFeedbackToSubagent: boolean;
  readonly onChange: (enabled: boolean) => void;
  readonly onClose: () => void;
}

export function FeedbackSettingsDialog({
  sendFeedbackToSubagent,
  onChange,
  onClose,
}: FeedbackSettingsDialogProps): React.JSX.Element {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Viewport className="dialog-viewport">
          <Dialog.Popup className="feedback-settings-dialog">
            <Dialog.Title>Settings</Dialog.Title>
            <Dialog.Description>
              Choose how Codex applies feedback to your document.
            </Dialog.Description>
            <label className="settings-checkbox-row">
              <Checkbox.Root
                className="settings-checkbox"
                checked={sendFeedbackToSubagent}
                onCheckedChange={(checked) => onChange(checked === true)}
              >
                <Checkbox.Indicator className="settings-checkbox-indicator">✓</Checkbox.Indicator>
              </Checkbox.Root>
              <span>Send feedback to subagent</span>
            </label>
            <div className="dialog-actions">
              <Button type="button" className="button-primary" onClick={onClose}>
                Done
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
