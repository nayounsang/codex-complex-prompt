import { randomUUID } from 'node:crypto';

import { WebSocket } from 'ws';

import { MockCodexSessionInputAdapter } from './adapters/codex-session-input.js';
import { startCliBridge } from './index.js';

const adapter = new MockCodexSessionInputAdapter();
const bridge = await startCliBridge({
  inputAdapter: adapter,
  openBrowser: () => Promise.resolve(),
});
const token = new URL(bridge.browserUrl).searchParams.get('token');
if (token === null) throw new Error('Smoke test did not receive a session token.');

const socket = new WebSocket(`${bridge.server.url}/ws`);
await new Promise<void>((resolve, reject) => {
  socket.once('open', () => resolve());
  socket.once('error', reject);
});
socket.send(JSON.stringify({ type: 'session.handshake', token }));
socket.send(
  JSON.stringify({
    type: 'prompt.submit',
    submissionId: randomUUID(),
    prompt: 'smoke test prompt',
  }),
);
await new Promise<void>((resolve, reject) => {
  socket.on('message', (data: Buffer) => {
    const message = JSON.parse(data.toString()) as { type: string; status?: string };
    if (message.type === 'prompt.result') {
      if (message.status !== 'accepted') reject(new Error('Smoke prompt was rejected.'));
      else resolve();
    }
  });
  socket.once('error', reject);
});

if (adapter.prompts[0] !== 'smoke test prompt')
  throw new Error('Mock adapter did not receive prompt.');
socket.close();
await bridge.stop();
process.stdout.write('CLI bridge smoke test passed.\n');
