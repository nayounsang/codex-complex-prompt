import { type Dispatch, type SetStateAction, lazy, Suspense } from 'react';
import { Button } from '@base-ui/react/button';
import { Dialog } from '@base-ui/react/dialog';

import type { PromptDrawingData } from '../hooks/usePromptWorkspaceAttachments.js';
import { SubmitFeedbackDialog } from '../../../app/components/SubmitFeedbackDialog.js';

const DrawingDialog = lazy(async () => {
  (window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/';
  const module = await import('../../input/DrawingDialog.js');
  return { default: module.DrawingDialog };
});

interface PromptWorkspaceDialogsProps {
  readonly drawing: PromptDrawingData | null;
  readonly onSaveDrawing: (input: { id?: string; png: string; scene: string }) => Promise<void>;
  readonly onCloseDrawing: () => void;
  readonly showSubmitDialog: boolean;
  readonly setShowSubmitDialog: Dispatch<SetStateAction<boolean>>;
  readonly onSendFeedback: () => void;
  readonly onApproveAnyway: () => void;
  readonly showEmptyFinishDialog: boolean;
  readonly onCloseEmptyFinishDialog: () => void;
  readonly onSubmitEmptyDocument: () => void;
  readonly closeInSeconds: number | null;
}

export function PromptWorkspaceDialogs({
  drawing,
  onSaveDrawing,
  onCloseDrawing,
  showSubmitDialog,
  setShowSubmitDialog,
  onSendFeedback,
  onApproveAnyway,
  showEmptyFinishDialog,
  onCloseEmptyFinishDialog,
  onSubmitEmptyDocument,
  closeInSeconds,
}: PromptWorkspaceDialogsProps): React.JSX.Element {
  return (
    <>
      {drawing !== null && (
        <Suspense
          fallback={
            <p className="prompt-limit" role="status">
              Opening drawing editor…
            </p>
          }
        >
          <DrawingDialog
            open
            {...(drawing.scene === undefined ? {} : { initialScene: drawing.scene })}
            {...(drawing.id === undefined ? {} : { attachmentId: drawing.id })}
            onSave={onSaveDrawing}
            onClose={onCloseDrawing}
          />
        </Suspense>
      )}
      {showSubmitDialog && (
        <SubmitFeedbackDialog
          onCancel={() => setShowSubmitDialog(false)}
          onSendFeedback={onSendFeedback}
          onApproveAnyway={onApproveAnyway}
        />
      )}
      {showEmptyFinishDialog && (
        <Dialog.Root open onOpenChange={(open) => !open && onCloseEmptyFinishDialog()}>
          <Dialog.Portal>
            <Dialog.Backdrop className="dialog-backdrop" />
            <Dialog.Viewport className="dialog-viewport">
              <Dialog.Popup className="submit-dialog" role="alertdialog">
                <Dialog.Title>Submit an empty document?</Dialog.Title>
                <Dialog.Description>
                  The review has no Markdown to continue from. Codex will end the review without a
                  document to act on.
                </Dialog.Description>
                <div className="dialog-actions">
                  <Button type="button" className="button-quiet" onClick={onCloseEmptyFinishDialog}>
                    Cancel
                  </Button>
                  <Button type="button" className="button-primary" onClick={onSubmitEmptyDocument}>
                    Submit empty document
                  </Button>
                </div>
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      )}
      {closeInSeconds !== null && (
        <Dialog.Root open modal disablePointerDismissal>
          <Dialog.Portal>
            <Dialog.Backdrop className="countdown-backdrop" />
            <Dialog.Viewport className="dialog-viewport">
              <Dialog.Popup className="countdown-modal">
                <p className="eyebrow">COMMAND SENT</p>
                <Dialog.Title id="countdown-title">Command sent</Dialog.Title>
                <Dialog.Description>
                  This window will close in {closeInSeconds} seconds.
                </Dialog.Description>
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </>
  );
}
