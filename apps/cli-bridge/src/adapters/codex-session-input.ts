export interface CodexSessionInput {
  submit(prompt: string): Promise<void>;
}

/**
 * The CLI does not currently expose a stable external input API. Keep that
 * limitation behind one small adapter so the bridge protocol stays usable.
 */
export class CodexSessionInputAdapter implements CodexSessionInput {
  public submit(prompt: string): Promise<void> {
    void prompt;
    return Promise.reject(
      new Error('Codex CLI session input injection is not available in this runtime.'),
    );
  }
}

export class MockCodexSessionInputAdapter implements CodexSessionInput {
  public readonly prompts: string[] = [];

  public submit(prompt: string): Promise<void> {
    this.prompts.push(prompt);
    return Promise.resolve();
  }
}
