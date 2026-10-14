import { createContext, useContext } from 'react';

import type { BridgeSessionState } from './bridge-session-types.js';

export const BridgeSessionContext = createContext<BridgeSessionState | null>(null);

export function useBridgeSessionContext(): BridgeSessionState {
  const bridgeSession = useContext(BridgeSessionContext);
  if (bridgeSession === null) {
    throw new Error('useBridgeSessionContext must be used within a BridgeSessionProvider.');
  }
  return bridgeSession;
}
