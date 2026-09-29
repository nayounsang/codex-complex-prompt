import { describe, expect, it } from 'vitest';
import {
  hasMermaidRelevantMutations,
  hasRemovedMermaidPreviewCard,
} from './mermaid-preview-observer.js';
import {
  createMermaidPreviewTargets,
  haveSameMermaidPreviewTargets,
} from './mermaid-preview-targets.js';

function createMutationRecord(
  target: Node,
  options: {
    readonly type?: MutationRecord['type'];
    readonly addedNodes?: Node[];
    readonly removedNodes?: Node[];
  } = {},
): MutationRecord {
  return {
    type: options.type ?? 'characterData',
    target,
    addedNodes: options.addedNodes ?? [],
    removedNodes: options.removedNodes ?? [],
  } as unknown as MutationRecord;
}

describe('hasMermaidRelevantMutations', () => {
  it('일반 문단 입력에서는 Mermaid 미리보기를 다시 동기화하지 않는다', () => {
    const paragraph = document.createElement('p');
    const text = document.createTextNode('prompt');
    paragraph.append(text);

    const shouldSync = hasMermaidRelevantMutations([createMutationRecord(text)]);

    expect(shouldSync).toBe(false);
  });

  it('Mermaid 코드 변경에서는 미리보기를 다시 동기화한다', () => {
    const codeBlock = document.createElement('div');
    codeBlock.className = 'milkdown-code-block';
    const code = document.createElement('div');
    code.className = 'codemirror-host';
    const text = document.createTextNode('graph TD');
    code.append(text);
    const preview = document.createElement('div');
    preview.className = 'mermaid-preview-mount';
    codeBlock.append(code, preview);

    const shouldSync = hasMermaidRelevantMutations([createMutationRecord(text)]);

    expect(shouldSync).toBe(true);
  });

  it('미리보기 마운트가 아직 없는 새 코드 블록의 변경도 동기화한다', () => {
    const codeBlock = document.createElement('div');
    codeBlock.className = 'milkdown-code-block';
    const code = document.createElement('div');
    code.className = 'codemirror-host';
    const text = document.createTextNode('graph TD');
    code.append(text);
    codeBlock.append(code);

    const shouldSync = hasMermaidRelevantMutations([createMutationRecord(text)]);

    expect(shouldSync).toBe(true);
  });

  it('미리보기 렌더링 내부의 DOM 변경은 다시 동기화하지 않는다', () => {
    const codeBlock = document.createElement('div');
    codeBlock.className = 'milkdown-code-block';
    const preview = document.createElement('div');
    preview.className = 'mermaid-preview-mount';
    const renderedCanvas = document.createElement('svg');
    preview.append(renderedCanvas);
    codeBlock.append(preview);

    const shouldSync = hasMermaidRelevantMutations([
      createMutationRecord(preview, { type: 'childList', addedNodes: [renderedCanvas] }),
    ]);

    expect(shouldSync).toBe(false);
  });

  it('에디터가 미리보기 카드를 제거하면 빈 마운트를 다시 동기화한다', () => {
    const mount = document.createElement('div');
    mount.className = 'mermaid-preview-mount';
    const card = document.createElement('div');
    card.className = 'mermaid-preview-card';

    const removal = createMutationRecord(mount, {
      type: 'childList',
      removedNodes: [card],
    });

    expect(hasMermaidRelevantMutations([removal])).toBe(true);
    expect(hasRemovedMermaidPreviewCard([removal])).toBe(true);
  });

  it('새 코드 블록 삽입에서는 Mermaid 블록 여부를 다시 확인한다', () => {
    const editor = document.createElement('div');
    const codeBlock = document.createElement('div');
    codeBlock.className = 'milkdown-code-block';

    const shouldSync = hasMermaidRelevantMutations([
      createMutationRecord(editor, { type: 'childList', addedNodes: [codeBlock] }),
    ]);

    expect(shouldSync).toBe(true);
  });
});

describe('haveSameMermaidPreviewTargets', () => {
  it('블록이 유지되어도 미리보기 마운트가 교체되면 새 대상으로 판단한다', () => {
    const block = document.createElement('div');
    const previousMount = document.createElement('div');
    const replacementMount = document.createElement('div');
    const current = [
      {
        id: 'diagram-1',
        block,
        mount: previousMount,
        source: 'graph TD',
        position: 10,
      },
    ];
    const next = [
      {
        ...current[0]!,
        mount: replacementMount,
      },
    ];

    const targetsAreSame = haveSameMermaidPreviewTargets(current, next);

    expect(targetsAreSame).toBe(false);
  });
});

describe('createMermaidPreviewTargets', () => {
  it('첫 번째 Mermaid 소스가 바뀌어도 두 번째 블록의 미리보기 대상을 유지한다', () => {
    const firstBlock = document.createElement('div');
    const secondBlock = document.createElement('div');
    firstBlock.className = 'milkdown-code-block';
    secondBlock.className = 'milkdown-code-block';
    const elements = [firstBlock, secondBlock];
    const contents = [
      { language: 'mermaid', source: 'graph TD', position: 0 },
      { language: 'mermaid', source: 'sequenceDiagram', position: 12 },
    ];
    const initialTargets = createMermaidPreviewTargets(contents, elements);

    const nextTargets = createMermaidPreviewTargets(
      [{ ...contents[0]!, source: 'graph LR' }, contents[1]!],
      elements,
    );

    expect(nextTargets[0]?.source).toBe('graph LR');
    expect(nextTargets[1]?.source).toBe('sequenceDiagram');
    expect(nextTargets[1]?.mount).toBe(initialTargets[1]?.mount);
  });
});
