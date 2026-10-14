import type {
  PromptSubmitMode,
  PromptTemplate,
  FeedbackModelCatalogEntry,
  FeedbackSubagentSettings,
} from '@codex-complex-prompt/protocol';
import type { DelayedClose } from './useDelayedClose.js';

export type ConnectionState =
  'connecting' | 'connected' | 'submitting' | 'success' | 'error' | 'disconnected';

export interface BridgeSessionState extends DelayedClose {
  readonly connectionState: ConnectionState;
  readonly error: string | null;
  readonly bridgeUrl: string | null;
  readonly initialMarkdown: string | null;
  readonly feedbackLoop: boolean;
  readonly feedbackModelCatalog: readonly FeedbackModelCatalogEntry[];
  readonly feedbackModelCatalogLoading: boolean;
  readonly attachmentUrl: string | null;
  readonly attachmentToken: string | null;
  readonly templateSnapshot: {
    readonly templates: readonly PromptTemplate[];
    readonly error: string | null;
  } | null;
}

export interface BridgeSessionActions {
  readonly requestTemplateChange: (request: TemplateChangeRequest) => Promise<TemplateResult>;
  readonly submit: (
    prompt: string,
    mode?: PromptSubmitMode,
    options?: FeedbackSubagentSettings,
  ) => Promise<PromptResult>;
}

export interface BridgeSession extends BridgeSessionState, BridgeSessionActions {}

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
