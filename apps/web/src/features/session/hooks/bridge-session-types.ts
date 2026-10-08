import type { PromptSubmitMode, PromptTemplate } from '@codex-complex-prompt/protocol';

export type ConnectionState =
  'connecting' | 'connected' | 'submitting' | 'success' | 'error' | 'disconnected';

export interface BridgeSession {
  readonly state: ConnectionState;
  readonly error: string | null;
  readonly closeInSeconds: number | null;
  readonly bridgeUrl: string | null;
  readonly initialMarkdown: string | null;
  readonly feedbackLoop: boolean;
  readonly attachmentUrl: string | null;
  readonly attachmentToken: string | null;
  readonly templateSnapshot: {
    readonly templates: readonly PromptTemplate[];
    readonly error: string | null;
  } | null;
  readonly requestTemplateChange: (request: TemplateChangeRequest) => Promise<TemplateResult>;
  readonly submit: (prompt: string, mode?: PromptSubmitMode) => Promise<PromptResult>;
}

export type TemplateChangeRequest =
  | { readonly type: 'template.save'; readonly template: PromptTemplate }
  | { readonly type: 'template.delete'; readonly id: string };

export interface PromptResult {
  readonly status: 'accepted' | 'failed';
  readonly error?: string;
  readonly prompt?: string;
}

export interface TemplateResult {
  readonly status: 'accepted' | 'failed';
  readonly templates?: readonly PromptTemplate[];
  readonly error?: string;
}
