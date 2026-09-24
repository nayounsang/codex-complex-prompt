import { Popover } from '@base-ui/react/popover';
import { ScrollArea } from '@base-ui/react/scroll-area';

import type { FeedbackAnnotation, SelectionAnchor } from '../model/feedback-types.js';
import { AnnotatedMarkdownView } from './AnnotatedMarkdownView.js';
import { FeedbackComposer } from './FeedbackComposer.js';
import { FeedbackPanel } from './FeedbackPanel.js';

const feedbackPopoverCollisionPadding = { top: 132, right: 12, bottom: 12, left: 12 };

interface FeedbackModeViewProps {
  readonly markdown: string;
  readonly annotations: readonly FeedbackAnnotation[];
  readonly pendingSelection: SelectionAnchor | null;
  readonly onSelection: (selection: SelectionAnchor | null) => void;
  readonly onAdd: (feedback: string) => void;
  readonly onCancel: () => void;
  readonly onUpdate: (id: string, feedback: string) => void;
  readonly onDelete: (id: string) => void;
  readonly error: string | null;
}

export function FeedbackModeView(props: FeedbackModeViewProps): React.JSX.Element {
  const closeSelection = (): void => {
    window.getSelection()?.removeAllRanges();
    props.onCancel();
  };
  const pendingAnnotation =
    props.pendingSelection?.annotationId === undefined
      ? undefined
      : props.annotations.find(
          (annotation) => annotation.id === props.pendingSelection?.annotationId,
        );
  const selectionAnchor =
    props.pendingSelection === null
      ? null
      : {
          getBoundingClientRect: () => props.pendingSelection?.rect ?? new DOMRect(),
          contextElement: typeof document === 'undefined' ? undefined : document.body,
        };
  return (
    <ScrollArea.Root className="feedback-scroll-region" aria-label="AI Feedback Mode">
      <ScrollArea.Viewport className="feedback-scroll-viewport">
        <div className="feedback-layout">
          <div className="feedback-document-column">
            <AnnotatedMarkdownView
              markdown={props.markdown}
              annotations={props.annotations}
              selectionPopoverOpen={props.pendingSelection !== null}
              onSelection={props.onSelection}
            />
            <Popover.Root
              open={props.pendingSelection !== null}
              onOpenChange={(open) => {
                if (!open) closeSelection();
              }}
            >
              <Popover.Trigger
                id="selection-feedback-trigger"
                className="selection-feedback-trigger"
                aria-hidden="true"
                tabIndex={-1}
              />
              <Popover.Portal>
                <Popover.Positioner
                  anchor={selectionAnchor}
                  side="top"
                  sideOffset={8}
                  align="start"
                  collisionPadding={feedbackPopoverCollisionPadding}
                >
                  <Popover.Popup className="feedback-popover" initialFocus={true}>
                    {props.pendingSelection !== null && (
                      <FeedbackComposer
                        key={`${props.pendingSelection.annotationId ?? 'new'}-${props.pendingSelection.start}-${props.pendingSelection.end}`}
                        selection={props.pendingSelection}
                        initialFeedback={pendingAnnotation?.feedback ?? ''}
                        onSubmit={(feedback) => {
                          closeSelection();
                          props.onAdd(feedback);
                        }}
                        onCancel={closeSelection}
                      />
                    )}
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
            {props.error !== null && (
              <p className="prompt-limit" role="alert">
                {props.error}
              </p>
            )}
          </div>
          <FeedbackPanel
            markdown={props.markdown}
            annotations={props.annotations}
            onUpdate={props.onUpdate}
            onDelete={props.onDelete}
          />
        </div>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical" className="feedback-scrollbar">
        <ScrollArea.Thumb className="feedback-scrollbar-thumb" />
      </ScrollArea.Scrollbar>
    </ScrollArea.Root>
  );
}
