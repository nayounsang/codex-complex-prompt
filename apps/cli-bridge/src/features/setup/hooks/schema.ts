import { z } from 'zod';

export const CodexJsonRecordSchema = z.record(z.string(), z.unknown());

export const CodexHooksFileSchema = CodexJsonRecordSchema;
export const CodexHookGroupsSchema = CodexJsonRecordSchema;

export const CodexHookGroupSchema = CodexJsonRecordSchema;
export const CodexHookGroupListSchema = z.array(z.unknown());

export const CodexCommandHookSchema = z
  .object({
    type: z.literal('command'),
    command: z.string().optional(),
    commandWindows: z.unknown().optional(),
    statusMessage: z.unknown().optional(),
  })
  .passthrough();

export const PlannotatorHookPayloadSchema = z
  .object({
    command: z.string(),
    commandWindows: z.unknown().optional(),
    statusMessage: z.unknown().optional(),
  })
  .passthrough();

export type CodexJsonRecord = z.infer<typeof CodexJsonRecordSchema>;
export type CodexCommandHook = z.infer<typeof CodexCommandHookSchema>;
export type PlannotatorHookPayload = z.infer<typeof PlannotatorHookPayloadSchema>;
