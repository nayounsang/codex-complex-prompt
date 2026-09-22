interface SubmitFeedbackDialogProps {
  readonly onCancel: () => void;
  readonly onSendFeedback: () => void;
  readonly onApproveAnyway: () => void;
}

export function SubmitFeedbackDialog({
  onCancel,
  onSendFeedback,
  onApproveAnyway,
}: SubmitFeedbackDialogProps): React.JSX.Element {
  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="dialog-backdrop" />
        <AlertDialog.Viewport className="dialog-viewport">
          <AlertDialog.Popup className="submit-dialog">
            <AlertDialog.Title id="submit-dialog-title">Unsent feedback</AlertDialog.Title>
            <AlertDialog.Description>
              You have feedback that has not been sent. Choose how to continue.
            </AlertDialog.Description>
            <div className="dialog-actions">
              <AlertDialog.Close className="button-quiet" onClick={onCancel}>
                Cancel
              </AlertDialog.Close>
              <Button type="button" className="button-secondary" onClick={onApproveAnyway}>
                Approve anyway
              </Button>
              <Button type="button" className="button-primary" onClick={onSendFeedback}>
                Send Feedback
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Button } from '@base-ui/react/button';
