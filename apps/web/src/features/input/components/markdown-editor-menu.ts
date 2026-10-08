import type { BlockEditFeatureConfig } from '@milkdown/crepe/feature/block-edit';
import { ICON_SVG } from '../../../shared/icons/icon-assets.js';

type BlockEditBuilder = Parameters<NonNullable<BlockEditFeatureConfig['buildMenu']>>[0];
type AdvancedMenuItem = Parameters<ReturnType<BlockEditBuilder['getGroup']>['addItem']>[1];
export type MarkdownEditorMenuAction = 'draw' | 'diagram' | 'media';

export const MILKDOWN_ADVANCED_MENU_MODEL = [
  {
    id: 'draw',
    label: 'Draw',
    icon: ICON_SVG.pencil,
    action: 'draw',
  },
  {
    id: 'diagram',
    label: 'Diagram',
    icon: ICON_SVG.diagram,
    action: 'diagram',
  },
  {
    id: 'media',
    label: 'Media',
    icon: ICON_SVG.media,
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
