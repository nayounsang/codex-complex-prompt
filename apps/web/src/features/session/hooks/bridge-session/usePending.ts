import { useCallback, useMemo, useRef } from 'react';

export interface PendingResults<T> {
  readonly delete: (id: string) => void;
  readonly failAll: (result: T) => void;
  readonly resolve: (id: string, result: T) => void;
  readonly waitFor: (id: string) => Promise<T>;
}

/**
 * Recommended to use this only in a bridge-session controller.
 */
export function usePending<T>(): PendingResults<T> {
  const pendingResults = useRef(new Map<string, (result: T) => void>());

  const deletePending = useCallback((id: string): void => {
    pendingResults.current.delete(id);
  }, []);

  const resolvePending = useCallback((id: string, result: T): void => {
    const resolve = pendingResults.current.get(id);
    pendingResults.current.delete(id);
    resolve?.(result);
  }, []);

  const failAllPending = useCallback((result: T): void => {
    const pending = pendingResults.current;
    pendingResults.current = new Map();
    for (const resolve of pending.values()) resolve(result);
  }, []);

  const waitForPending = useCallback(
    (id: string): Promise<T> =>
      new Promise((resolve) => {
        pendingResults.current.set(id, resolve);
      }),
    [],
  );

  return useMemo(
    () => ({
      delete: deletePending,
      failAll: failAllPending,
      resolve: resolvePending,
      waitFor: waitForPending,
    }),
    [deletePending, failAllPending, resolvePending, waitForPending],
  );
}
