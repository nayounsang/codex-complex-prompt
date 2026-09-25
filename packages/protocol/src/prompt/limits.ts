import { z } from 'zod';

export const MAX_PROMPT_LENGTH = 12_000;

/** Match Rust's `str::chars().count()` used by the Codex CLI input validator. */
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

export function promptStringSchema() {
  return z.string().refine(isPromptWithinLimit, promptLengthValidation);
}

export { isPromptWithinLimit, promptLengthValidation };
