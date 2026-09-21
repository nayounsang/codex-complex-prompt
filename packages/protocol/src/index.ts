import { z } from 'zod';

export const SessionHandshakeSchema = z.object({
  type: z.literal('session.handshake'),
  token: z.string().min(32).max(256),
});

export const PromptSubmitSchema = z.object({
  type: z.literal('prompt.submit'),
  submissionId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(12_000),
});

export const ReviewSubmitSchema = z.object({
  type: z.literal('review.submit'),
  reviewId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected', 'feedback']),
  feedback: z.string().trim().max(12_000).optional(),
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  SessionHandshakeSchema,
  PromptSubmitSchema,
  ReviewSubmitSchema,
]);

export const SessionReadySchema = z.object({
  type: z.literal('session.ready'),
  sessionId: z.string().uuid(),
  expiresAt: z.string().datetime(),
});

export const PromptResultSchema = z.object({
  type: z.literal('prompt.result'),
  submissionId: z.string().uuid(),
  status: z.enum(['accepted', 'failed']),
  error: z.string().optional(),
});

export const ReviewReadySchema = z.object({
  type: z.literal('review.ready'),
  reviewId: z.string().uuid(),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(100_000),
});

export const ReviewResultSchema = z.object({
  type: z.literal('review.result'),
  reviewId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected', 'feedback']),
  feedback: z.string().optional(),
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
  ReviewReadySchema,
  ReviewResultSchema,
  ProtocolErrorSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type PromptSubmit = z.infer<typeof PromptSubmitSchema>;
export type ReviewSubmit = z.infer<typeof ReviewSubmitSchema>;
export type ReviewReady = z.infer<typeof ReviewReadySchema>;
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

export function parseClientMessage(input: unknown): ClientMessage {
  return ClientMessageSchema.parse(input);
}

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(ServerMessageSchema.parse(message));
}
