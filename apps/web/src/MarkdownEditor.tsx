import { forwardRef, useEffect, useEffectEvent, useImperativeHandle, useRef } from 'react';

import { size } from '@floating-ui/dom';
import { Crepe } from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

export interface MarkdownEditorHandle {
  getMarkdown: () => string;
}

export interface MarkdownEditorProps {
  readonly defaultMarkdown?: string;
  readonly readOnly?: boolean;
  readonly onMarkdownChange?: (markdown: string) => void;
}

const crepeFeatures = {
  [Crepe.Feature.ImageBlock]: false,
};

const slashMenuMiddleware = [
  size({
    padding: 8,
    apply({ availableHeight, elements }) {
      elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
      elements.floating.style.overflowY = 'auto';
    },
  }),
];

const crepeFeatureConfigs = {
  [Crepe.Feature.BlockEdit]: {
    slashMenu: {
      middleware: slashMenuMiddleware,
    },
  },
  [Crepe.Feature.Placeholder]: {
    mode: 'doc' as const,
    text: 'Start writing…',
  },
};

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    { defaultMarkdown = '', readOnly = false, onMarkdownChange },
    forwardedRef,
  ): React.JSX.Element {
    const rootRef = useRef<HTMLDivElement>(null);
    const crepeRef = useRef<Crepe | null>(null);
    const markdownRef = useRef(defaultMarkdown);
    const notifyMarkdownChange = useEffectEvent((markdown: string) => {
      onMarkdownChange?.(markdown);
    });
    const getCurrentReadOnly = useEffectEvent(() => readOnly);

    useImperativeHandle(
      forwardedRef,
      () => ({
        getMarkdown: () => crepeRef.current?.getMarkdown() ?? markdownRef.current,
      }),
      [],
    );

    useEffect(
      function initializeMarkdownEditor() {
        const root = rootRef.current;
        if (root === null) return;
        const editorRoot: HTMLDivElement = root;

        let disposed = false;
        let crepe: Crepe | null = null;
        const blockFileTransfer = (event: ClipboardEvent | DragEvent): void => {
          const files =
            'clipboardData' in event ? event.clipboardData?.files : event.dataTransfer?.files;
          if (files !== undefined && files.length > 0) {
            event.preventDefault();
            event.stopPropagation();
          }
        };
        editorRoot.addEventListener('paste', blockFileTransfer, true);
        editorRoot.addEventListener('drop', blockFileTransfer, true);

        crepe = new Crepe({
          root: editorRoot,
          defaultValue: defaultMarkdown,
          features: crepeFeatures,
          featureConfigs: crepeFeatureConfigs,
        });
        crepeRef.current = crepe;
        crepe.setReadonly(getCurrentReadOnly());
        crepe.on((listener) => {
          listener.markdownUpdated((_ctx, markdown) => {
            markdownRef.current = markdown;
            notifyMarkdownChange(markdown);
          });
        });

        void crepe
          .create()
          .then(function syncInitialMarkdown() {
            if (disposed) return;
            editorRoot
              .querySelector<HTMLElement>('.ProseMirror')
              ?.setAttribute('aria-label', 'Command');
            markdownRef.current = crepe.getMarkdown();
            notifyMarkdownChange(markdownRef.current);
          })
          .catch(function clearFailedEditor() {
            if (!disposed) crepeRef.current = null;
          });

        return () => {
          disposed = true;
          editorRoot.removeEventListener('paste', blockFileTransfer, true);
          editorRoot.removeEventListener('drop', blockFileTransfer, true);
          crepeRef.current = null;
          if (crepe !== null) void crepe.destroy();
        };
      },
      [defaultMarkdown],
    );

    useEffect(
      function syncMarkdownEditorReadOnlyState() {
        crepeRef.current?.setReadonly(readOnly);
      },
      [readOnly],
    );

    return (
      <div
        ref={rootRef}
        id="markdown-editor"
        className="markdown-editor"
        data-testid="markdown-editor"
        role="group"
        aria-label="Markdown command editor"
        aria-disabled={readOnly}
      />
    );
  },
);
