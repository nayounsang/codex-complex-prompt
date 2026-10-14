import { z } from 'zod';

import { isPromptWithinLimit, promptLengthValidation } from '../prompt/limits.js';
import { promptStringSchema } from './prompt.js';
import { FeedbackModelCatalogSchema, FeedbackSubagentSettingsSchema } from './feedback-model.js';
import { PromptTemplateSchema, TemplateRequestSchema, TemplateResultSchema } from './templates.js';

export const SessionHandshakeSchema = z.object({
  type: z.literal('session.handshake'),
  token: z.string().min(32).max(256),
});

export const FeedbackModelCatalogRequestSchema = z.object({
  type: z.literal('feedback-model.catalog.request'),
});

export const PromptSubmitSchema = z
  .object({
    type: z.literal('prompt.submit'),
    submissionId: z.string().uuid(),
    prompt: z.string().trim().refine(isPromptWithinLimit, promptLengthValidation),
    mode: z.enum(['edit', 'feedback', 'finish']).optional(),
    ...FeedbackSubagentSettingsSchema.shape,
  })
  .refine((submission) => submission.mode === 'finish' || submission.prompt.length > 0, {
    message: 'Prompt must not be empty.',
    path: ['prompt'],
  });

export const ClientMessageSchema = z.union([
  SessionHandshakeSchema,
  FeedbackModelCatalogRequestSchema,
  PromptSubmitSchema,
  TemplateRequestSchema,
]);

export const SessionReadySchema = z.object({
  type: z.literal('session.ready'),
  sessionId: z.string().uuid(),
  expiresAt: z.string().datetime(),
  initialMarkdown: z.string().optional(),
  feedbackLoop: z.boolean().optional(),
  feedbackModelCatalog: FeedbackModelCatalogSchema.optional(),
  templates: z.array(PromptTemplateSchema).optional(),
  templatesError: z.string().optional(),
  attachmentUrl: z.string().url().optional(),
  attachmentToken: z.string().min(32).optional(),
});

export const PromptResultSchema = z.object({
  type: z.literal('prompt.result'),
  submissionId: z.string().uuid(),
  status: z.enum(['accepted', 'failed']),
  error: z.string().optional(),
  prompt: promptStringSchema().optional(),
});

export const FeedbackModelCatalogResultSchema = z.object({
  type: z.literal('feedback-model.catalog.result'),
  catalog: FeedbackModelCatalogSchema,
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
  FeedbackModelCatalogResultSchema,
  PromptResultSchema,
  TemplateResultSchema,
  ProtocolErrorSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type PromptSubmit = z.infer<typeof PromptSubmitSchema>;
export type FeedbackModelCatalogRequest = z.infer<typeof FeedbackModelCatalogRequestSchema>;
export type FeedbackModelCatalogResult = z.infer<typeof FeedbackModelCatalogResultSchema>;
export type PromptSubmitMode = NonNullable<PromptSubmit['mode']>;

export function parseClientMessage(input: unknown): ClientMessage {
  return ClientMessageSchema.parse(input);
}

export function encodeServerMessage(message: unknown): string {
  return JSON.stringify(ServerMessageSchema.parse(message));
}
