import { z } from 'zod';

import { promptStringSchema } from '../prompt/limits.js';

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

export const TemplateResultSchema = z.object({
  type: z.literal('template.result'),
  requestId: z.string().uuid(),
  status: z.enum(['accepted', 'failed']),
  templates: z.array(PromptTemplateSchema).optional(),
  error: z.string().optional(),
});

export type PromptTemplate = z.infer<typeof PromptTemplateSchema>;
export type TemplateRequest = z.infer<typeof TemplateRequestSchema>;
