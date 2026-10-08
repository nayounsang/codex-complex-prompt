export interface MermaidCodeBlockContent {
  readonly language: string;
  readonly source: string;
  readonly position: number;
}

export interface MermaidPreviewTarget {
  readonly id: string;
  readonly block: HTMLElement;
  readonly mount: HTMLDivElement;
  readonly source: string;
  readonly position: number;
}

let nextMermaidPreviewId = 0;

export function createMermaidPreviewTargets(
  contents: readonly MermaidCodeBlockContent[],
  blockElements: readonly HTMLElement[],
): MermaidPreviewTarget[] {
  const targets: MermaidPreviewTarget[] = [];
  blockElements.forEach((block, blockIndex) => {
    const content = contents[blockIndex];
    let mount = block.querySelector<HTMLDivElement>(':scope > .mermaid-preview-mount');
    if (content?.language !== MARKDOWN_UI_REPLACEMENT_MODEL.mermaid.language) {
      mount?.remove();
      return;
    }
    if (mount === null) {
      mount = document.createElement('div');
      mount.className = 'mermaid-preview-mount';
      mount.contentEditable = 'false';
      block.append(mount);
    }
    const id = mount.dataset['mermaidPreviewId'] ?? `mermaid-preview-${nextMermaidPreviewId++}`;
    mount.dataset['mermaidPreviewId'] = id;
    targets.push({ id, block, mount, source: content.source, position: content.position });
  });
  return targets;
}

export function haveSameMermaidPreviewTargets(
  current: readonly MermaidPreviewTarget[],
  next: readonly MermaidPreviewTarget[],
): boolean {
  return (
    current.length === next.length &&
    current.every((target, index) => {
      const nextTarget = next[index];
      return (
        nextTarget !== undefined &&
        target.id === nextTarget.id &&
        target.block === nextTarget.block &&
        target.mount === nextTarget.mount &&
        target.source === nextTarget.source &&
        target.position === nextTarget.position
      );
    })
  );
}
import { MARKDOWN_UI_REPLACEMENT_MODEL } from '../../../shared/markdown/ui-replacements.js';
