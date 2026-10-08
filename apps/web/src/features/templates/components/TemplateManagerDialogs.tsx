import type { Dispatch, SetStateAction } from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Button } from '@base-ui/react/button';
import { Dialog } from '@base-ui/react/dialog';
import { MAX_PROMPT_LENGTH, type PromptTemplate } from '@codex-complex-prompt/protocol';

export interface DraftTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

interface TemplateManagerDialogsProps {
  readonly templates: readonly PromptTemplate[];
  readonly editing: DraftTemplate | null;
  readonly setEditing: Dispatch<SetStateAction<DraftTemplate | null>>;
  readonly selected: PromptTemplate | null;
  readonly error: string | null;
  readonly saving: boolean;
  readonly onSaveDraft: () => void;
  readonly confirmApply: boolean;
  readonly setConfirmApply: (open: boolean) => void;
  readonly onApply: (body: string) => void;
  readonly confirmDelete: boolean;
  readonly templateToDelete: PromptTemplate | null;
  readonly onDelete: () => void;
  readonly onCloseDelete: () => void;
}

export function TemplateManagerDialogs({
  templates,
  editing,
  setEditing,
  selected,
  error,
  saving,
  onSaveDraft,
  confirmApply,
  setConfirmApply,
  onApply,
  confirmDelete,
  templateToDelete,
  onDelete,
  onCloseDelete,
}: TemplateManagerDialogsProps): React.JSX.Element {
  return (
    <>
      <Dialog.Root
        open={editing !== null}
        onOpenChange={(open) => !open && !saving && setEditing(null)}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="dialog-backdrop" />
          <Dialog.Viewport className="dialog-viewport">
            <Dialog.Popup className="template-dialog">
              <Dialog.Title>
                {templates.some((template) => template.id === editing?.id)
                  ? 'Edit template'
                  : 'Create template'}
              </Dialog.Title>
              <Dialog.Description>
                Name, describe, and write the Markdown command to reuse.
              </Dialog.Description>
              <label className="template-field">
                Name
                <input
                  autoFocus
                  maxLength={120}
                  value={editing?.name ?? ''}
                  onChange={(event) =>
                    setEditing((current) =>
                      current === null ? null : { ...current, name: event.target.value },
                    )
                  }
                />
              </label>
              <label className="template-field">
                Description
                <input
                  maxLength={500}
                  value={editing?.description ?? ''}
                  onChange={(event) =>
                    setEditing((current) =>
                      current === null ? null : { ...current, description: event.target.value },
                    )
                  }
                />
              </label>
              <label className="template-field">
                Markdown body
                <textarea
                  rows={12}
                  maxLength={MAX_PROMPT_LENGTH}
                  value={editing?.body ?? ''}
                  onChange={(event) =>
                    setEditing((current) =>
                      current === null ? null : { ...current, body: event.target.value },
                    )
                  }
                />
              </label>
              {error !== null && (
                <p className="template-error" role="alert">
                  {error}
                </p>
              )}
              <div className="dialog-actions">
                <Button className="button-quiet" disabled={saving} onClick={() => setEditing(null)}>
                  Cancel
                </Button>
                <Button
                  className="button-primary"
                  disabled={saving || editing?.name.trim() === ''}
                  onClick={onSaveDraft}
                >
                  {saving ? 'Saving…' : 'Save template'}
                </Button>
              </div>
            </Dialog.Popup>
          </Dialog.Viewport>
        </Dialog.Portal>
      </Dialog.Root>

      <AlertDialog.Root open={confirmApply} onOpenChange={setConfirmApply}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="dialog-backdrop" />
          <AlertDialog.Viewport className="dialog-viewport">
            <AlertDialog.Popup className="submit-dialog">
              <AlertDialog.Title>Replace the current command?</AlertDialog.Title>
              <AlertDialog.Description>
                Applying “{selected?.name}” will replace the Markdown currently in the editor.
              </AlertDialog.Description>
              <div className="dialog-actions">
                <AlertDialog.Close className="button-quiet">Cancel</AlertDialog.Close>
                <Button
                  className="button-primary"
                  onClick={() => {
                    if (selected !== null) onApply(selected.body);
                    setConfirmApply(false);
                  }}
                >
                  Replace command
                </Button>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!open) onCloseDelete();
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop className="dialog-backdrop" />
          <AlertDialog.Viewport className="dialog-viewport">
            <AlertDialog.Popup className="submit-dialog">
              <AlertDialog.Title>Delete this template?</AlertDialog.Title>
              <AlertDialog.Description>
                “{templateToDelete?.name}” will be removed from this project.
              </AlertDialog.Description>
              <div className="dialog-actions">
                <Button className="button-quiet" onClick={onCloseDelete}>
                  Cancel
                </Button>
                <Button className="button-primary" onClick={onDelete}>
                  Delete template
                </Button>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
