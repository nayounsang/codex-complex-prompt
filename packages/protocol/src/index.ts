import { z } from 'zod';

export { AttachmentTooLargeError, AttachmentValidationError } from './attachment-errors.js';

export const MAX_PROMPT_LENGTH = 12_000;

/**
 * Match Rust's `str::chars().count()` used by the Codex CLI input validator.
 * This counts Unicode code points, not UTF-16 code units or UTF-8 bytes.
 */
export function countPromptCharacters(value: string): number {
  return Array.from(value).length;
}

export function truncatePromptCharacters(value: string, maxLength = MAX_PROMPT_LENGTH): string {
  return Array.from(value).slice(0, maxLength).join('');
}

function isPromptWithinLimit(value: string): boolean {
  return countPromptCharacters(value) <= MAX_PROMPT_LENGTH;
}

const promptLengthValidation = {
  message: `Prompt must be ${MAX_PROMPT_LENGTH} characters or fewer.`,
};

function promptStringSchema() {
  return z.string().refine(isPromptWithinLimit, promptLengthValidation);
}

export const CodexUserPromptSubmitInputSchema = z
  .object({
    hook_event_name: z.literal('UserPromptSubmit').optional(),
    session_id: z.string().optional(),
    cwd: z.string().optional(),
    prompt: z.string(),
  })
  .passthrough();

export const CodexStopHookInputSchema = z
  .object({
    hook_event_name: z.literal('Stop'),
    session_id: z.string().optional(),
    last_assistant_message: z.string().nullable().optional(),
    stop_hook_active: z.boolean().optional(),
  })
  .passthrough();

export const SessionHandshakeSchema = z.object({
  type: z.literal('session.handshake'),
  token: z.string().min(32).max(256),
});

export const PromptTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  description: z.string().max(500),
  body: promptStringSchema(),
});

export const TemplateRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('template.list'), requestId: z.string().uuid() }),
  z.object({
    type: z.literal('template.save'),
    requestId: z.string().uuid(),
    template: PromptTemplateSchema,
  }),
  z.object({
    type: z.literal('template.delete'),
    requestId: z.string().uuid(),
    id: z.string().uuid(),
  }),
]);

export const PromptSubmitSchema = z
  .object({
    type: z.literal('prompt.submit'),
    submissionId: z.string().uuid(),
    prompt: z.string().trim().refine(isPromptWithinLimit, promptLengthValidation),
    mode: z.enum(['edit', 'feedback', 'finish']).optional(),
  })
  .refine((submission) => submission.mode === 'finish' || submission.prompt.length > 0, {
    message: 'Prompt must not be empty.',
    path: ['prompt'],
  });

export const ClientMessageSchema = z.union([
  SessionHandshakeSchema,
  PromptSubmitSchema,
  TemplateRequestSchema,
]);

export const SessionReadySchema = z.object({
  type: z.literal('session.ready'),
  sessionId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  initialMarkdown: z.string().optional(),
  feedbackLoop: z.boolean().optional(),
  templates: z.array(PromptTemplateSchema).optional(),
  templatesError: z.string().optional(),
  attachmentUrl: z.string().url().optional(),
  attachmentToken: z.string().min(32).optional(),
});

export const TemplateResultSchema = z.object({
  type: z.literal('template.result'),
  requestId: z.string().uuid(),
  status: z.enum(['accepted', 'failed']),
  templates: z.array(PromptTemplateSchema).optional(),
  error: z.string().optional(),
});

export const PromptResultSchema = z.object({
  type: z.literal('prompt.result'),
  submissionId: z.string().uuid(),
  status: z.enum(['accepted', 'failed']),
  error: z.string().optional(),
  prompt: promptStringSchema().optional(),
});

export const ProtocolErrorSchema = z.object({
  type: z.literal('session.error'),
  code: z.enum([
    'invalid_message',
    'invalid_token',
    'session_expired',
    'duplicate_submission',
    'adapter_error',
  ]),
  message: z.string().min(1),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  SessionReadySchema,
  PromptResultSchema,
  TemplateResultSchema,
  ProtocolErrorSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type CodexUserPromptSubmitInput = z.infer<typeof CodexUserPromptSubmitInputSchema>;
export type CodexStopHookInput = z.infer<typeof CodexStopHookInputSchema>;
export type PromptSubmit = z.infer<typeof PromptSubmitSchema>;
export type PromptTemplate = z.infer<typeof PromptTemplateSchema>;
export type TemplateRequest = z.infer<typeof TemplateRequestSchema>;
export type PromptSubmitMode = NonNullable<PromptSubmit['mode']>;

export function parseClientMessage(input: unknown): ClientMessage {
  return ClientMessageSchema.parse(input);
}

export function encodeServerMessage(message: unknown): string {
  return JSON.stringify(ServerMessageSchema.parse(message));
}
