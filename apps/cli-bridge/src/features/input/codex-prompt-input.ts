import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

import {
  countPromptCharacters,
  MAX_PROMPT_LENGTH,
  truncatePromptCharacters,
} from '@codex-complex-prompt/protocol';

export async function resolveInitialMarkdown(
  input: string,
  workingDirectory = process.cwd(),
): Promise<string> {
  const trimmedInput = input.trim();
  let markdown = trimmedInput;

  if (isLocalMarkdownPath(trimmedInput)) {
    markdown =
      (await readInitialMarkdownFile(resolve(workingDirectory, trimmedInput))) ?? trimmedInput;
  }

  return truncatePromptCharacters(markdown);
}

async function readInitialMarkdownFile(filePath: string): Promise<string | undefined> {
  try {
    if (!(await stat(filePath)).isFile()) return undefined;

    let markdown = '';
    const stream = createReadStream(filePath, { encoding: 'utf8', highWaterMark: 64 * 1024 });
    for await (const chunk of stream) {
      markdown += chunk;
      if (countPromptCharacters(markdown) > MAX_PROMPT_LENGTH) {
        stream.destroy();
        return truncatePromptCharacters(markdown);
      }
    }
    return markdown;
  } catch {
    return undefined;
  }
}

function isLocalMarkdownPath(input: string): boolean {
  if (input === '' || /^[a-z][a-z\d+.-]*:\/\//i.test(input)) return false;
  const extension = extname(input).toLowerCase();
  return extension === '.md' || extension === '.txt';
}
