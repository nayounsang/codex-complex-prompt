import type { BlockEditFeatureConfig } from '@milkdown/crepe/feature/block-edit';
import { Image, Pencil, Workflow, type LucideIcon } from 'lucide-react';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

type BlockEditBuilder = Parameters<NonNullable<BlockEditFeatureConfig['buildMenu']>>[0];
type AdvancedMenuItem = Parameters<ReturnType<BlockEditBuilder['getGroup']>['addItem']>[1];
export type MarkdownEditorMenuAction = 'draw' | 'diagram' | 'media';

function renderLucideIcon(icon: LucideIcon): string {
  const container = document.createElement('span');
  const root = createRoot(container);
  flushSync(() => root.render(createElement(icon)));
  const svg = container.querySelector('svg');
  root.unmount();
  if (svg === null) throw new Error('Could not render the editor menu icon.');
  return svg.outerHTML;
}

export const MILKDOWN_ADVANCED_MENU_MODEL = [
  {
    id: 'draw',
    label: 'Draw',
    icon: renderLucideIcon(Pencil),
    action: 'draw',
  },
  {
    id: 'diagram',
    label: 'Diagram',
    icon: renderLucideIcon(Workflow),
    action: 'diagram',
  },
  {
    id: 'media',
    label: 'Media',
    icon: renderLucideIcon(Image),
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
