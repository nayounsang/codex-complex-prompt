import type { BlockEditFeatureConfig } from '@milkdown/crepe/feature/block-edit';

type BlockEditBuilder = Parameters<NonNullable<BlockEditFeatureConfig['buildMenu']>>[0];
type AdvancedMenuItem = Parameters<ReturnType<BlockEditBuilder['getGroup']>['addItem']>[1];
export type MarkdownEditorMenuAction = 'draw' | 'diagram' | 'media';

export const MILKDOWN_ADVANCED_MENU_MODEL = [
  {
    id: 'draw',
    label: 'Draw',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m4 16.5 9.8-9.8a2.1 2.1 0 0 1 3 3L7 19.5 3.5 20.5 4 16.5Z"/><path d="m12.5 8 3 3"/></svg>',
    action: 'draw',
  },
  {
    id: 'diagram',
    label: 'Diagram',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="7" height="6" rx="1"/><rect x="14" y="15" width="7" height="6" rx="1"/><path d="M10 6h4a3 3 0 0 1 3 3v6M7 9v6h7"/></svg>',
    action: 'diagram',
  },
  {
    id: 'media',
    label: 'Media',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 15-5-5L5 20"/></svg>',
    action: 'media',
  },
] as const satisfies readonly {
  readonly id: MarkdownEditorMenuAction;
  readonly label: string;
  readonly icon: string;
  readonly action: MarkdownEditorMenuAction;
}[];

export type MarkdownEditorMenuActions = Record<MarkdownEditorMenuAction, () => void>;

export function addMarkdownEditorAdvancedMenu(
  builder: BlockEditBuilder,
  enabled: boolean,
  actions: MarkdownEditorMenuActions,
): void {
  if (!enabled) return;
  for (const item of MILKDOWN_ADVANCED_MENU_MODEL) {
    const config: AdvancedMenuItem = {
      label: item.label,
      icon: item.icon,
      onRun: actions[item.action],
    };
    builder.getGroup('advanced').addItem(item.id, config);
  }
}
