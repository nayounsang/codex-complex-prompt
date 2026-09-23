import {
  forwardRef,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

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
  readonly className?: string;
  readonly testId?: string;
  readonly ariaLabel?: string;
  readonly onReady?: (root: HTMLDivElement) => void;
}

const crepeFeatures = {
  [Crepe.Feature.ImageBlock]: false,
};

const crepeFeatureConfigs = {
  [Crepe.Feature.BlockEdit]: {
    slashMenu: {},
  },
  [Crepe.Feature.Placeholder]: {
    mode: 'doc' as const,
    text: 'Start writing…',
  },
};

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function MarkdownEditor(
    {
      defaultMarkdown = '',
      readOnly = false,
      onMarkdownChange,
      className,
      testId = 'markdown-editor',
      ariaLabel = 'Markdown command editor',
      onReady,
    },
    forwardedRef,
  ): React.JSX.Element {
    const rootRef = useRef<HTMLDivElement>(null);
    const crepeRef = useRef<Crepe | null>(null);
    const markdownRef = useRef(defaultMarkdown);
    const [initializationError, setInitializationError] = useState<Error | null>(null);
    const notifyMarkdownChange = useEffectEvent((markdown: string) => {
      onMarkdownChange?.(markdown);
    });
    const getCurrentReadOnly = useEffectEvent(() => readOnly);
    const getEditorAriaLabel = useEffectEvent(() =>
      ariaLabel === 'Markdown command editor' ? 'Command' : ariaLabel,
    );
    const notifyReady = useEffectEvent((root: HTMLDivElement) => {
      onReady?.(root);
    });

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

        let readyTimer: number | undefined;
        const syncInitialMarkdown = (): void => {
          if (disposed) return;
          const proseMirror = editorRoot.querySelector<HTMLElement>('.ProseMirror');
          if (proseMirror === null) return;
          if (readyTimer !== undefined) window.clearTimeout(readyTimer);
          readyTimer = window.setTimeout(() => {
            if (disposed) return;
            const stableProseMirror = editorRoot.querySelector<HTMLElement>('.ProseMirror');
            if (stableProseMirror === null) return;
            editorObserver.disconnect();
            stableProseMirror.setAttribute('aria-label', getEditorAriaLabel());
            notifyReady(editorRoot);
            markdownRef.current = crepe?.getMarkdown() ?? defaultMarkdown;
            notifyMarkdownChange(markdownRef.current);
          }, 50);
        };
        const editorObserver = new MutationObserver(syncInitialMarkdown);
        editorObserver.observe(editorRoot, { childList: true, subtree: true });

        void crepe
          .create()
          .then(function syncInitialMarkdownAfterCreate() {
            syncInitialMarkdown();
          })
          .catch(function reportFailedEditor(error: unknown) {
            if (disposed) return;
            crepeRef.current = null;
            setInitializationError(
              error instanceof Error ? error : new Error('The Markdown editor failed to load.'),
            );
          });

        return () => {
          disposed = true;
          if (readyTimer !== undefined) window.clearTimeout(readyTimer);
          editorObserver.disconnect();
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

    if (initializationError !== null) {
      throw initializationError;
    }

    return (
      <div
        ref={rootRef}
        id="markdown-editor"
        className={`markdown-editor markdown-surface markdown-content${className === undefined ? '' : ` ${className}`}`}
        data-testid={testId}
        role="group"
        aria-label={ariaLabel}
        aria-disabled={readOnly}
      />
    );
  },
);
