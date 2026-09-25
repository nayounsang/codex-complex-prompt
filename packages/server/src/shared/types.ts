import type { PromptSubmitMode, PromptTemplate } from '@codex-complex-prompt/protocol';

import type { SessionStoreOptions } from '../features/session/storage/session-store.js';

export interface PromptContext {
  readonly sessionId: string;
  readonly submissionId: string;
  readonly mode: PromptSubmitMode;
}

export type PromptAdapterResult = string | void;

export interface TemplateStore {
  readonly list: () => Promise<readonly PromptTemplate[]>;
  readonly save: (template: PromptTemplate) => Promise<readonly PromptTemplate[]>;
  readonly delete: (id: string) => Promise<readonly PromptTemplate[]>;
}

export interface AttachmentStore {
  readonly save: (input: { id?: string; png: string; scene: string }) => Promise<string>;
  readonly read: (
    id: string,
  ) => Promise<{ readonly png: Buffer; readonly scene: string } | undefined>;
  readonly hasSceneData: (id: string) => Promise<boolean>;
  readonly delete: (id: string) => Promise<boolean>;
}

export interface LocalBridgeServerOptions extends SessionStoreOptions {
  readonly host?: string;
  readonly port?: number;
  readonly staticDir?: string;
  readonly promptTimeoutMs?: number;
  readonly maxConnections?: number;
  readonly handshakeTimeoutMs?: number;
  readonly initialMarkdown?: string;
  readonly feedbackLoop?: boolean;
  readonly templateStore?: TemplateStore;
  readonly templatesError?: string;
  readonly attachmentStore?: AttachmentStore;
  readonly onPrompt: (prompt: string, context: PromptContext) => Promise<PromptAdapterResult>;
}

export interface RunningLocalBridgeServer {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly createSession: () => {
    id: string;
    token: string;
    expiresAt: Date;
  };
  readonly close: () => Promise<void>;
}
