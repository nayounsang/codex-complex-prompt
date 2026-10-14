import type { ConnectionState } from './bridge-session-types.js';

interface BridgeUrlResult {
  readonly url: URL | null;
  readonly error: string | null;
}

export function parseBridgeUrl(bridge: string): BridgeUrlResult {
  let url: URL;
  try {
    url = new URL(bridge);
  } catch {
    return { url: null, error: 'The bridge URL is invalid.' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { url: null, error: 'The bridge URL must use HTTP or HTTPS.' };
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const isLoopbackHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  if (!isLoopbackHost) {
    return { url: null, error: 'The bridge URL must point to a loopback host.' };
  }
  return { url, error: null };
}

export function getInitialConnection(): { state: ConnectionState; error: string | null } {
  if (typeof window === 'undefined') return { state: 'connecting', error: null };
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get('token') === null) {
    return { state: 'error', error: 'This page needs a bridge session token.' };
  }
  const bridgeResult = parseBridgeUrl(searchParams.get('bridge') ?? window.location.origin);
  return bridgeResult.error === null
    ? { state: 'connecting', error: null }
    : { state: 'error', error: bridgeResult.error };
}
