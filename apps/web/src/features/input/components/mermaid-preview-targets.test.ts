import { afterEach, describe, expect, it } from 'vitest';
import { createMermaidPreviewTargets } from './mermaid-preview-targets.js';

afterEach(() => document.body.replaceChildren());

describe('createMermaidPreviewTargets', () => {
  it('places the preview before the editor and gives the editor an accessible target id', () => {
    const block = document.createElement('div');
    block.className = 'milkdown-code-block';
    const codeEditor = document.createElement('div');
    codeEditor.className = 'codemirror-host';
    block.append(codeEditor);
    document.body.append(block);

    const [target] = createMermaidPreviewTargets(
      [{ language: 'mermaid', source: 'flowchart TD', position: 0 }],
      [block],
    );

    expect(block.firstElementChild).toBe(target?.mount);
    expect(target?.mount.nextElementSibling).toBe(codeEditor);
    expect(codeEditor.id).toBe(`${target?.id}-code-editor`);
  });
});
