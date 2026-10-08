import { describe, expect, it, vi } from 'vitest';

import {
  addMarkdownEditorAdvancedMenu,
  MILKDOWN_ADVANCED_MENU_MODEL,
  type MarkdownEditorMenuActions,
} from './markdown-editor-menu.js';

describe('Milkdown advanced menu model', () => {
  it('registers each modeled item with its icon and action', () => {
    const addItem = vi.fn();
    const builder = {
      getGroup: vi.fn(() => ({ addItem })),
    };
    const actions: MarkdownEditorMenuActions = {
      draw: vi.fn(),
      diagram: vi.fn(),
      media: vi.fn(),
    };
    addMarkdownEditorAdvancedMenu(builder as never, true, actions);

    expect(MILKDOWN_ADVANCED_MENU_MODEL.map(({ id, label }) => [id, label])).toEqual([
      ['draw', 'Draw'],
      ['diagram', 'Diagram'],
      ['media', 'Media'],
    ]);
    expect(addItem).toHaveBeenCalledTimes(3);
    for (const item of MILKDOWN_ADVANCED_MENU_MODEL) {
      const registered = addItem.mock.calls.find(([id]) => id === item.id)?.[1] as
        { label: string; icon: string; onRun: () => void } | undefined;
      expect(registered).toMatchObject({ label: item.label, icon: item.icon });
      expect(registered?.onRun).toBe(actions[item.action]);
    }
  });

  it('does not register items when drawing actions are disabled', () => {
    const addItem = vi.fn();
    const builder = { getGroup: () => ({ addItem }) };

    addMarkdownEditorAdvancedMenu(builder as never, false, {
      draw: vi.fn(),
      diagram: vi.fn(),
      media: vi.fn(),
    });

    expect(addItem).not.toHaveBeenCalled();
  });
});
