import { z } from 'zod';

export const CodexUserPromptSubmitInputSchema = z
  .object({
    hook_event_name: z.literal('UserPromptSubmit').optional(),
    session_id: z.string().optional(),
    cwd: z.string().optional(),
    permission_mode: z.string().optional(),
    prompt: z.string(),
  })
  .passthrough();

export const CodexStopHookInputSchema = z
  .object({
    hook_event_name: z.literal('Stop'),
    session_id: z.string().optional(),
    last_assistant_message: z.string().nullable().optional(),
    permission_mode: z.string().optional(),
    stop_hook_active: z.boolean().optional(),
  })
  .passthrough();

export type CodexUserPromptSubmitInput = z.infer<typeof CodexUserPromptSubmitInputSchema>;
export type CodexStopHookInput = z.infer<typeof CodexStopHookInputSchema>;
