import { Component, forwardRef, lazy, Suspense, useCallback, useState } from 'react';
import { Button } from '@base-ui/react/button';

import type { MarkdownEditorHandle, MarkdownEditorProps } from './MarkdownEditor.js';

const MarkdownEditor = lazy(async function loadMarkdownEditor() {
  const module = await import('./MarkdownEditor.js');
  return { default: module.MarkdownEditor };
});

export interface LazyMarkdownEditorProps extends MarkdownEditorProps {
  readonly loadImmediately?: boolean;
}

export const LazyMarkdownEditor = forwardRef<MarkdownEditorHandle, LazyMarkdownEditorProps>(
  function LazyMarkdownEditor(props, forwardedRef): React.JSX.Element {
    const [isEditorRequested, setIsEditorRequested] = useState(
      () => props.loadImmediately === true || (props.defaultMarkdown ?? '').trim().length > 0,
    );
    const requestEditor = useCallback(function requestEditor(): void {
      setIsEditorRequested(true);
    }, []);

    if (!isEditorRequested) {
      return (
        <MarkdownEditorFallback
          readOnly={props.readOnly ?? false}
          onActivate={requestEditor}
          onImageFiles={props.onImageFiles}
        />
      );
    }

    return (
      <MarkdownEditorErrorBoundary readOnly={props.readOnly ?? false}>
        <Suspense
          fallback={
            <MarkdownEditorFallback
              readOnly={props.readOnly ?? false}
              onImageFiles={props.onImageFiles}
            />
          }
        >
          <MarkdownEditor {...props} ref={forwardedRef} />
        </Suspense>
      </MarkdownEditorErrorBoundary>
    );
  },
);

interface MarkdownEditorFallbackProps extends Pick<MarkdownEditorProps, 'readOnly'> {
  readonly onActivate?: () => void;
  readonly error?: boolean;
  readonly onImageFiles?: MarkdownEditorProps['onImageFiles'];
}

function MarkdownEditorFallback({
  readOnly = false,
  onActivate,
  error = false,
  onImageFiles,
}: MarkdownEditorFallbackProps): React.JSX.Element {
  const activate = onActivate ?? undefined;
  const activateOnPointer = onActivate === undefined || error ? undefined : activate;

  return (
    <Button
      id="markdown-editor"
      className="markdown-editor markdown-editor-loading"
      disabled={onActivate === undefined || readOnly}
      aria-label="Markdown command editor"
      aria-busy="true"
      aria-disabled={readOnly}
      onClick={activate}
      onPointerEnter={activateOnPointer}
      onPointerDown={activateOnPointer}
      onFocus={activateOnPointer}
      onPaste={handleImageFileTransfer}
      onDrop={handleImageFileTransfer}
    >
      {error ? 'Editor failed to load. Reload to try again.' : 'Start writing…'}
    </Button>
  );

  function handleImageFileTransfer(
    event: React.ClipboardEvent<HTMLButtonElement> | React.DragEvent<HTMLButtonElement>,
  ): void {
    const transfer = 'clipboardData' in event ? event.clipboardData : event.dataTransfer;
    const files = transfer === null ? [] : Array.from(transfer.files);
    if (files.length === 0 && 'clipboardData' in event && transfer !== null) {
      for (const item of Array.from(transfer.items)) {
        if (item.kind !== 'file') continue;
        const file = item.getAsFile();
        if (file !== null) files.push(file);
      }
    }
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (images.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (!readOnly) void onImageFiles?.(images);
  }
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
