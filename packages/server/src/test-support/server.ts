import { get } from 'node:http';

import WebSocket from 'ws';

import type { RunningLocalBridgeServer } from '../index.js';

const sockets: WebSocket[] = [];

export function trackSocket(socket: WebSocket): void {
  sockets.push(socket);
}

export async function closeTestSockets(): Promise<void> {
  await Promise.all(sockets.splice(0).map(closeSocket));
}

export function nextMessage(socket: WebSocket, timeoutMs = 1_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('WebSocket message timed out.'));
    }, timeoutMs);
    const onMessage = (value: WebSocket.RawData): void => {
      cleanup();
      resolve(JSON.parse(rawDataToString(value)) as unknown);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClose = (): void => {
      cleanup();
      reject(new Error('WebSocket closed before the expected message.'));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    socket.once('message', onMessage);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

export function nextClose(socket: WebSocket, timeoutMs = 1_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('WebSocket close timed out.'));
    }, timeoutMs);
    const onClose = (code: number): void => {
      cleanup();
      resolve(code);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      socket.off('close', onClose);
      socket.off('error', onError);
    };
    socket.once('close', onClose);
    socket.once('error', onError);
  });
}

export async function openSocket(server: RunningLocalBridgeServer): Promise<WebSocket> {
  const socket = new WebSocket(`${server.url}/ws`);
  trackSocket(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return socket;
}

export async function authenticate(
  server: RunningLocalBridgeServer,
  token: string,
): Promise<{ socket: WebSocket; ready: unknown }> {
  const socket = await openSocket(server);
  socket.send(JSON.stringify({ type: 'session.handshake', token }));
  return { socket, ready: await nextMessage(socket) };
}

export function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function getHttp(url: string): Promise<{ statusCode: number | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const request = get(url, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({ statusCode: response.statusCode, body: Buffer.concat(chunks).toString() });
      });
    });
    request.once('error', reject);
  });
}

function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    socket.once('close', () => resolve());
    socket.close();
  });
}

function rawDataToString(data: WebSocket.RawData): string {
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  return Buffer.from(data).toString();
}
