function isCodeBlock(node: Node): boolean {
  return (
    node instanceof Element &&
    (node.matches('.milkdown-code-block') || node.querySelector('.milkdown-code-block') !== null)
  );
}

function isMermaidPreviewCard(node: Node): boolean {
  return (
    node instanceof Element &&
    (node.matches('.mermaid-preview-card') || node.querySelector('.mermaid-preview-card') !== null)
  );
}

export function hasRemovedMermaidPreviewCard(records: readonly MutationRecord[]): boolean {
  return records.some(
    (record) =>
      record.type === 'childList' &&
      record.target instanceof Element &&
      record.target.matches('.mermaid-preview-mount') &&
      [...record.removedNodes].some(isMermaidPreviewCard),
  );
}

export function hasMermaidRelevantMutations(records: readonly MutationRecord[]): boolean {
  return records.some((record) => {
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    const codeBlock = target?.closest<HTMLElement>('.milkdown-code-block');
    const previewMount = target?.closest('.mermaid-preview-mount');

    if (previewMount !== null && previewMount !== undefined) {
      return hasRemovedMermaidPreviewCard([record]);
    }

    // TODO: Editing ordinary code blocks also calls syncMermaidPreviews() and rescans the entire document; narrow this condition.
    if (codeBlock !== null && codeBlock !== undefined && previewMount === null) {
      return true;
    }

    if (record.type !== 'childList') return false;
    return [...record.addedNodes, ...record.removedNodes].some(isCodeBlock);
  });
}
