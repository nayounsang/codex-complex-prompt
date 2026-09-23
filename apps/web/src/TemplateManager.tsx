import { useState } from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Button } from '@base-ui/react/button';
import { Dialog } from '@base-ui/react/dialog';
import { Select } from '@base-ui/react/select';

import type { PromptTemplate } from '@codex-complex-prompt/protocol';

interface TemplateManagerProps {
  readonly templates: readonly PromptTemplate[];
  readonly templatesError: string | null;
  readonly markdown: string;
  readonly isDisabled: boolean;
  readonly onApply: (body: string) => void;
  readonly onSave: (template: PromptTemplate) => Promise<{
    status: 'accepted' | 'failed';
    templates?: readonly PromptTemplate[];
    error?: string;
  }>;
  readonly onDelete: (id: string) => Promise<{
    status: 'accepted' | 'failed';
    templates?: readonly PromptTemplate[];
    error?: string;
  }>;
}

interface DraftTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

export function TemplateManager(props: TemplateManagerProps): React.JSX.Element {
  const [editing, setEditing] = useState<DraftTemplate | null>(null);
  const [selectOpen, setSelectOpen] = useState(false);
  const [selected, setSelected] = useState<PromptTemplate | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<PromptTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function saveDraft(): Promise<void> {
    if (editing === null || editing.name.trim() === '') return;
    setSaving(true);
    setError(null);
    const result = await props.onSave({
      ...editing,
      name: editing.name.trim(),
      description: editing.description.trim(),
    });
    setSaving(false);
    if (result.status === 'accepted') {
      const saved = result.templates?.find((template) => template.id === editing.id);
      if (saved !== undefined) setSelected(saved);
      setEditing(null);
    } else setError(result.error ?? 'The template could not be saved.');
  }

  async function deleteTemplate(): Promise<void> {
    if (templateToDelete === null) return;
    setError(null);
    const result = await props.onDelete(templateToDelete.id);
    if (result.status === 'accepted') {
      if (selected?.id === templateToDelete.id) setSelected(null);
      setTemplateToDelete(null);
      setConfirmDelete(false);
    } else setError(result.error ?? 'The template could not be deleted.');
  }

  function applySelected(): void {
    if (selected === null) return;
    if (props.markdown.trim() !== '') setConfirmApply(true);
    else props.onApply(selected.body);
  }

  function openEditor(template: PromptTemplate): void {
    setSelectOpen(false);
    setEditing(template);
    setError(null);
  }

  function openDeleteConfirmation(template: PromptTemplate): void {
    setSelectOpen(false);
    setError(null);
    window.setTimeout(() => {
      setTemplateToDelete(template);
      setConfirmDelete(true);
    }, 0);
  }

  const disabledReason = props.templatesError;
  return (
    <div className="template-manager" aria-label="Project templates">
      <Select.Root
        open={selectOpen}
        onOpenChange={setSelectOpen}
        value={selected?.id ?? null}
        onValueChange={(value) => {
          if (value === '__create__')
            setEditing({ id: crypto.randomUUID(), name: '', description: '', body: '' });
          else setSelected(props.templates.find((template) => template.id === value) ?? null);
          setError(null);
        }}
        disabled={props.isDisabled || disabledReason !== null}
      >
        <Select.Trigger className="template-select-trigger" aria-label="Project template">
          <Select.Value>
            {selected?.name ??
              (disabledReason === null ? 'Choose a template' : 'Templates unavailable')}
          </Select.Value>
          <Select.Icon aria-hidden="true">▾</Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner className="template-select-positioner" sideOffset={6}>
            <Select.Popup className="template-select-popup">
              <Select.List>
                {props.templates.map((template) => (
                  <Select.Item
                    key={template.id}
                    value={template.id}
                    className="template-select-item"
                  >
                    <Select.ItemText className="template-item-content">
                      <span className="template-item-copy">
                        <span className="template-item-name">{template.name}</span>
                        <span className="template-item-description">{template.description}</span>
                      </span>
                    </Select.ItemText>
                    <span className="template-item-actions">
                      <button
                        type="button"
                        className="template-item-action"
                        aria-label={`Edit ${template.name}`}
                        title="Edit template"
                        disabled={props.isDisabled}
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditor(template);
                        }}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="m10.7 2.3 3 3M2.5 13.5l2.8-.6 7.9-7.9a1.4 1.4 0 0 0-2-2l-7.9 7.9-.8 2.6Z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className="template-item-action template-item-delete"
                        aria-label={`Delete ${template.name}`}
                        title="Delete template"
                        disabled={props.isDisabled}
                        onClick={(event) => {
                          event.stopPropagation();
                          openDeleteConfirmation(template);
                        }}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M2.5 4.5h11m-9.5 0 .6 9h5.8l.6-9M6 4.5V2.8h4v1.7m-3.5 2v4.5m3-4.5v4.5" />
                        </svg>
                      </button>
                    </span>
                  </Select.Item>
                ))}
                <Select.Item
                  value="__create__"
                  className="template-select-item template-create-item"
                >
                  <Select.ItemText>
                    {props.templates.length === 0
                      ? 'Create your first template…'
                      : '＋ Create a template…'}
                  </Select.ItemText>
                </Select.Item>
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
      {disabledReason !== null && (
        <span className="template-status" role="status">
          {disabledReason}
        </span>
      )}
      {props.templates.length === 0 && disabledReason === null && (
        <span className="template-status">No project templates yet.</span>
      )}
      {selected !== null && disabledReason === null && (
        <div className="template-actions">
          <Button
            className="button-secondary template-action"
            disabled={props.isDisabled}
            onClick={applySelected}
          >
            Apply
          </Button>
        </div>
      )}
      {error !== null && (
        <span className="template-error" role="alert">
          {error}
        </span>
      )}

      <Dialog.Root
        open={editing !== null}
        onOpenChange={(open) => !open && !saving && setEditing(null)}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="dialog-backdrop" />
          <Dialog.Viewport className="dialog-viewport">
            <Dialog.Popup className="template-dialog">
              <Dialog.Title>
                {props.templates.some((template) => template.id === editing?.id)
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
                  onClick={() => void saveDraft()}
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
                    if (selected !== null) props.onApply(selected.body);
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
          setConfirmDelete(open);
          if (!open) setTemplateToDelete(null);
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
                <Button className="button-quiet" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </Button>
                <Button className="button-primary" onClick={() => void deleteTemplate()}>
                  Delete template
                </Button>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Viewport>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
