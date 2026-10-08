import { Button } from '@base-ui/react/button';
import { Dialog } from '@base-ui/react/dialog';
import { DrawingSceneSchema, MAX_ATTACHMENT_IMAGE_BYTES } from '@codex-complex-prompt/protocol';
import { Excalidraw, exportToBlob, FONT_FAMILY } from '@excalidraw/excalidraw';
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import { useRef, useState } from 'react';
import '@excalidraw/excalidraw/index.css';
import { SvgIcon } from '../../shared/icons/SvgIcon.js';

export interface DrawingDialogProps {
  readonly open: boolean;
  readonly initialScene?: string;
  readonly attachmentId?: string;
  readonly onSave: (drawing: { id?: string; png: string; scene: string }) => Promise<void>;
  readonly onClose: () => void;
}

const renderDrawingPng = exportToBlob as unknown as (options: {
  readonly elements: readonly ExcalidrawElement[];
  readonly appState: AppState;
  readonly files: BinaryFiles;
  readonly mimeType: 'image/png';
  readonly exportPadding: number;
}) => Promise<Blob>;

export function DrawingDialog({
  open,
  initialScene,
  attachmentId,
  onSave,
  onClose,
}: DrawingDialogProps): React.JSX.Element {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  let initialSceneError: string | null = null;
  let scene:
    | {
        elements?: readonly ExcalidrawElement[];
        appState?: Record<string, unknown>;
        files?: BinaryFiles;
      }
    | undefined;
  if (initialScene !== undefined) {
    try {
      const parsed: unknown = JSON.parse(initialScene);
      const result = DrawingSceneSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error('The drawing data has an invalid format.');
      }
      scene = result.data as unknown as typeof scene;
    } catch (reason) {
      initialSceneError =
        reason instanceof Error
          ? `Could not open the drawing data: ${reason.message}`
          : 'Could not open the drawing data.';
    }
  }
  const initialData: ExcalidrawInitialDataState =
    scene === undefined
      ? { appState: { currentItemFontFamily: FONT_FAMILY.Excalifont } }
      : {
          ...(scene.elements === undefined ? {} : { elements: scene.elements }),
          ...(scene.files === undefined ? {} : { files: scene.files }),
          appState: { ...scene.appState, currentItemFontFamily: FONT_FAMILY.Excalifont },
        };

  const saveDrawing = async (): Promise<void> => {
    if (initialSceneError !== null) return;
    const api = apiRef.current;
    if (api === null) return;
    setSaving(true);
    setError(null);
    try {
      const elements = api.getSceneElements();
      const appState = api.getAppState();
      const files = api.getFiles();
      const blob = await renderDrawingPng({
        elements,
        appState,
        files,
        mimeType: 'image/png',
        exportPadding: 24,
      });
      if (blob.size > MAX_ATTACHMENT_IMAGE_BYTES) {
        setError('PNG drawings must be 25 MB or smaller.');
        setSaving(false);
        return;
      }
      const png = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === 'string'
            ? resolve(reader.result)
            : reject(new Error('Could not read the PNG.'));
        reader.onerror = () => reject(new Error('Could not read the PNG.'));
        reader.readAsDataURL(blob);
      });
      const savedScene = JSON.stringify({
        elements,
        appState: { currentItemFontFamily: appState.currentItemFontFamily },
        files,
      });
      await onSave({
        ...(attachmentId === undefined ? {} : { id: attachmentId }),
        png,
        scene: savedScene,
      });
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not save the drawing. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next, eventDetails) => {
        if (next || saving) return;
        if (eventDetails?.reason === 'escape-key' || eventDetails?.reason === 'outside-press')
          return;
        onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop" />
        <Dialog.Viewport className="dialog-viewport drawing-dialog-viewport">
          <Dialog.Popup className="drawing-dialog">
            <div className="drawing-dialog-header">
              <div>
                <Dialog.Title>Draw</Dialog.Title>
              </div>
              <Button
                type="button"
                className="button-quiet"
                aria-label="Close"
                title="Close"
                disabled={saving}
                onClick={onClose}
              >
                <SvgIcon name="close" />
              </Button>
            </div>
            <div className="drawing-canvas">
              <Excalidraw
                key={initialScene ?? 'new-drawing'}
                excalidrawAPI={(api) => {
                  apiRef.current = api;
                }}
                initialData={initialData}
              />
            </div>
            {(initialSceneError ?? error) !== null && (
              <p className="drawing-error" role="alert">
                {initialSceneError ?? error}
              </p>
            )}
            <div className="dialog-actions">
              <Button
                type="button"
                className="button-primary"
                disabled={saving || initialSceneError !== null}
                onClick={() => void saveDrawing()}
              >
                {saving ? 'Saving…' : 'Insert'}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
