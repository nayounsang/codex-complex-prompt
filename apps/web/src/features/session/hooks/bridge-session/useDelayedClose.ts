import { useCallback, useRef, useState } from 'react';

const COMMAND_WINDOW_CLOSE_DELAY_MS = 3_000;

export interface DelayedClose {
  readonly isCloseScheduled: boolean;
}

export interface DelayedCloseControls {
  readonly cancelClose: () => void;
  readonly clearCloseTimer: () => void;
  readonly scheduleClose: () => void;
}

export type DelayedCloseResult = DelayedClose & DelayedCloseControls;

export function useDelayedClose(): DelayedCloseResult {
  const [isCloseScheduled, setIsCloseScheduled] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);

  const clearCloseTimer = useCallback((): void => {
    if (closeTimer.current === undefined) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);

  const cancelClose = useCallback((): void => {
    clearCloseTimer();
    setIsCloseScheduled(false);
  }, [clearCloseTimer]);

  const scheduleClose = useCallback((): void => {
    clearCloseTimer();
    setIsCloseScheduled(true);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = undefined;
      setIsCloseScheduled(false);
      window.close();
    }, COMMAND_WINDOW_CLOSE_DELAY_MS);
  }, [clearCloseTimer]);

  return { isCloseScheduled, cancelClose, clearCloseTimer, scheduleClose };
}
