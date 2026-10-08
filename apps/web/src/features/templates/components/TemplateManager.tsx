import { useState } from 'react';
import { Button } from '@base-ui/react/button';
import { Select } from '@base-ui/react/select';
import { SvgIcon } from '../../../shared/icons/SvgIcon.js';

import {
  MAX_PROMPT_LENGTH,
  PromptTemplateSchema,
  type PromptTemplate,
} from '@codex-complex-prompt/protocol';
import { TemplateManagerDialogs, type DraftTemplate } from './TemplateManagerDialogs.js';

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
    if (editing === null) return;
    const parsed = PromptTemplateSchema.safeParse({
      ...editing,
      name: editing.name.trim(),
      description: editing.description.trim(),
    });
    if (!parsed.success) {
      setError(
        `Name must be 1–120 characters, description must be 500 characters or fewer, and Markdown body must be ${MAX_PROMPT_LENGTH.toLocaleString()} characters or fewer.`,
      );
      return;
    }
    setSaving(true);
    setError(null);
    const result = await props.onSave(parsed.data);
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
      closeDeleteConfirmation();
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

  function closeDeleteConfirmation(): void {
    setConfirmDelete(false);
    setTemplateToDelete(null);
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
                  <div
                    key={template.id}
                    className="template-item-row"
                    role="group"
                    aria-label={template.name}
                  >
                    <Select.Item value={template.id} className="template-select-item">
                      <Select.ItemText className="template-item-content">
                        <span className="template-item-copy">
                          <span className="template-item-name">{template.name}</span>
                          <span className="template-item-description">{template.description}</span>
                        </span>
                      </Select.ItemText>
                    </Select.Item>
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
                        <SvgIcon name="templateEdit" />
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
                        <SvgIcon name="templateDelete" />
                      </button>
                    </span>
                  </div>
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

      <TemplateManagerDialogs
        templates={props.templates}
        editing={editing}
        setEditing={setEditing}
        selected={selected}
        error={error}
        saving={saving}
        onSaveDraft={() => void saveDraft()}
        confirmApply={confirmApply}
        setConfirmApply={setConfirmApply}
        onApply={props.onApply}
        confirmDelete={confirmDelete}
        templateToDelete={templateToDelete}
        onDelete={() => void deleteTemplate()}
        onCloseDelete={closeDeleteConfirmation}
      />
    </div>
  );
}
