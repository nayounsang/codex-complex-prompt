import { z } from 'zod';

import { isPromptWithinLimit, promptLengthValidation } from '../prompt/limits.js';

export function promptStringSchema() {
  return z.string().refine(isPromptWithinLimit, promptLengthValidation);
}
