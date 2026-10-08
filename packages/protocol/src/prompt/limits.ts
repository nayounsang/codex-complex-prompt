export const MAX_PROMPT_LENGTH = 12_000;

/** Match Rust's `str::chars().count()` used by the Codex CLI input validator. */
export function countPromptCharacters(value: string): number {
  return Array.from(value).length;
}

export function truncatePromptCharacters(value: string, maxLength = MAX_PROMPT_LENGTH): string {
  return Array.from(value).slice(0, maxLength).join('');
}

export function isPromptWithinLimit(value: string): boolean {
  return countPromptCharacters(value) <= MAX_PROMPT_LENGTH;
}

export const promptLengthValidation = {
  message: `Prompt must be ${MAX_PROMPT_LENGTH} characters or fewer.`,
};
