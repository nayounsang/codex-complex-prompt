import { Button } from '@base-ui/react/button';
import { Dialog } from '@base-ui/react/dialog';
import { MAX_ATTACHMENT_IMAGE_BYTES } from '@codex-complex-prompt/protocol';
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
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        !('elements' in parsed) ||
        !Array.isArray(parsed.elements)
      ) {
        throw new Error('그림 편집 데이터 형식이 올바르지 않습니다.');
      }
      scene = parsed as typeof scene;
    } catch (reason) {
      initialSceneError =
        reason instanceof Error
          ? `그림 편집 데이터를 열지 못했습니다: ${reason.message}`
          : '그림 편집 데이터를 열지 못했습니다.';
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
        setError('PNG 그림은 25MB 이하여야 합니다.');
        setSaving(false);
        return;
      }
      const png = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          typeof reader.result === 'string'
            ? resolve(reader.result)
            : reject(new Error('PNG를 읽을 수 없습니다.'));
        reader.onerror = () => reject(new Error('PNG를 읽을 수 없습니다.'));
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
        reason instanceof Error
          ? reason.message
          : '그림을 저장하지 못했습니다. 다시 시도해 주세요.',
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
                aria-label="닫기"
                title="닫기"
                disabled={saving}
                onClick={onClose}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  width="20"
                  height="20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                >
                  <path d="m6 6 12 12M18 6 6 18" />
                </svg>
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
                {saving ? '저장 중…' : '삽입'}
              </Button>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
