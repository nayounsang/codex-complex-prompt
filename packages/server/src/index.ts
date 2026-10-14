import { randomBytes } from 'node:crypto';

import { AttachmentTokenStore } from './features/attachments/attachment-token-store.js';
import { SessionStore } from './features/session/storage/session-store.js';
import { resolveStaticPath } from './infrastructure/http/static-files.js';
import { createBridgeNestApplication } from './runtime/create-bridge-nest-application.js';
import type { LocalBridgeServerOptions, RunningLocalBridgeServer } from './shared/types.js';

export { SessionStore } from './features/session/storage/session-store.js';
export type {
  SessionRecord,
  SessionStoreOptions,
} from './features/session/storage/session-store.js';
export type {
  LocalBridgeServerOptions,
  PromptAdapterResult,
  PromptContext,
  RunningLocalBridgeServer,
  TemplateStore,
  AttachmentStore,
} from './shared/types.js';
export { resolveStaticPath };

export async function startLocalBridgeServer(
  options: LocalBridgeServerOptions,
): Promise<RunningLocalBridgeServer> {
  const host = options.host ?? '127.0.0.1';
  const requestedPort = options.port ?? 0;
  const application = await createBridgeNestApplication(options);

  try {
    await application.listen(requestedPort, host);
    const address = application.getHttpServer().address();
    if (address === null || typeof address === 'string') {
      throw new Error('The local bridge server did not expose a TCP address.');
    }
    const port = address.port;
    const sessionStore = application.get(SessionStore, { strict: false });
    const attachmentTokens = application.get(AttachmentTokenStore, { strict: false });

    return {
      host,
      port,
      url: `http://${host}:${port}`,
      createSession: () => {
        const session = sessionStore.create();
        if (options.attachmentStore !== undefined) {
          attachmentTokens.set(session.id, randomBytes(32).toString('base64url'));
        }
        return { id: session.id, token: session.token, expiresAt: session.expiresAt };
      },
      close: () => application.close(),
    };
  } catch (error) {
    await application.close();
    throw error;
  }
}
