import { z } from 'zod';

export const AttachmentCreateRequestSchema = z
  .object({
    id: z.string().optional(),
    image: z.string().optional(),
    video: z.string().optional(),
    png: z.string().optional(),
    extension: z.string().optional(),
    scene: z.string().optional(),
  })
  .superRefine((input, context) => {
    if (input.image === undefined && input.png === undefined && input.video === undefined) {
      context.addIssue({ code: 'custom', message: 'Attachment data is required.' });
      return;
    }
    if (input.video !== undefined) {
      if (input.scene !== undefined) {
        context.addIssue({ code: 'custom', path: ['scene'], message: 'Invalid video attachment.' });
      }
    } else if (input.scene === undefined) {
      context.addIssue({ code: 'custom', path: ['scene'], message: 'Drawing scene is required.' });
    }
  });

export const DrawingSceneSchema = z
  .object({
    elements: z.array(z.unknown()),
    appState: z.record(z.unknown()).optional(),
    files: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type AttachmentCreateRequest = z.infer<typeof AttachmentCreateRequestSchema>;
export type DrawingScene = z.infer<typeof DrawingSceneSchema>;
