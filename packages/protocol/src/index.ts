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

export const ClientMessageSchema = z.discriminatedUnion('type', [
  SessionHandshakeSchema,
  PromptSubmitSchema,
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
  ProtocolErrorSchema,
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type PromptSubmit = z.infer<typeof PromptSubmitSchema>;

export function parseClientMessage(input: unknown): ClientMessage {
  return ClientMessageSchema.parse(input);
}

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(ServerMessageSchema.parse(message));
}
