import { Component, forwardRef, lazy, Suspense, useCallback, useState } from 'react';

import type { MarkdownEditorHandle, MarkdownEditorProps } from './MarkdownEditor.js';

const MarkdownEditor = lazy(async function loadMarkdownEditor() {
  const module = await import('./MarkdownEditor.js');
  return { default: module.MarkdownEditor };
});

export const LazyMarkdownEditor = forwardRef<MarkdownEditorHandle, MarkdownEditorProps>(
  function LazyMarkdownEditor(props, forwardedRef): React.JSX.Element {
    const [isEditorRequested, setIsEditorRequested] = useState(false);
    const requestEditor = useCallback(function requestEditor(): void {
      setIsEditorRequested(true);
    }, []);

    if (!isEditorRequested) {
      return (
        <MarkdownEditorFallback readOnly={props.readOnly ?? false} onActivate={requestEditor} />
      );
    }

    return (
      <MarkdownEditorErrorBoundary readOnly={props.readOnly ?? false}>
        <Suspense fallback={<MarkdownEditorFallback readOnly={props.readOnly ?? false} />}>
          <MarkdownEditor {...props} ref={forwardedRef} />
        </Suspense>
      </MarkdownEditorErrorBoundary>
    );
  },
);

interface MarkdownEditorFallbackProps extends Pick<MarkdownEditorProps, 'readOnly'> {
  readonly onActivate?: () => void;
  readonly error?: boolean;
}

function MarkdownEditorFallback({
  readOnly = false,
  onActivate,
  error = false,
}: MarkdownEditorFallbackProps): React.JSX.Element {
  const activate = onActivate ?? undefined;
  const activateOnPointer = onActivate === undefined || error ? undefined : activate;

  return (
    <div
      id="markdown-editor"
      className="markdown-editor markdown-editor-loading"
      data-testid="markdown-editor"
      role={onActivate === undefined ? 'group' : 'button'}
      aria-label="Markdown command editor"
      aria-busy="true"
      aria-disabled={readOnly}
      tabIndex={onActivate === undefined ? undefined : 0}
      onClick={activate}
      onPointerEnter={activateOnPointer}
      onPointerDown={activateOnPointer}
      onFocus={activateOnPointer}
      onKeyDown={
        onActivate === undefined
          ? undefined
          : (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onActivate();
              }
            }
      }
    >
      {error ? 'Editor failed to load. Reload to try again.' : 'Start writing…'}
    </div>
  );
}

interface MarkdownEditorErrorBoundaryProps {
  readonly children: React.ReactNode;
  readonly readOnly: boolean;
}

interface MarkdownEditorErrorBoundaryState {
  readonly hasError: boolean;
}

class MarkdownEditorErrorBoundary extends Component<
  MarkdownEditorErrorBoundaryProps,
  MarkdownEditorErrorBoundaryState
> {
  public override state: MarkdownEditorErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): MarkdownEditorErrorBoundaryState {
    return { hasError: true };
  }

  public override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <MarkdownEditorFallback
          readOnly={this.props.readOnly}
          error
          onActivate={function reloadEditor(): void {
            window.location.reload();
          }}
        />
      );
    }

    return this.props.children;
  }
}
