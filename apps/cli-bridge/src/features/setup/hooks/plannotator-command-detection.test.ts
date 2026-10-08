import { describe, expect, it } from 'vitest';

import { containsPlannotator } from './plannotator-command-detection.js';

describe('Plannotator command detection', () => {
  it.each([
    ['direct command', 'plannotator hook stop'],
    ['case-insensitive executable suffix', '"C:\\tools\\PLANNOTATOR.EXE" hook stop'],
    ['npx package option', 'npx --yes --package plannotator plannotator hook stop'],
    ['npx separator', 'npx -- plannotator hook stop'],
    ['shell environment assignment', 'MODE=review plannotator hook stop'],
    ['env command assignment', 'env MODE=review plannotator hook stop'],
    ['env command options', 'env -i -- plannotator hook stop'],
    ['env command value options', 'env -u HOME -C /tmp -a cli MODE=review plannotator hook stop'],
    [
      'env command long options',
      'env --unset=HOME --chdir=/tmp --argv0=cli MODE=review plannotator hook stop',
    ],
    ['env separator', 'env -- plannotator hook stop'],
    ['shell command string', "sh -c 'plannotator hook stop'"],
    ['command after a separator', 'echo ready && plannotator hook stop'],
    ['command after a newline', 'echo ready\nplannotator hook stop'],
  ])('detects a Plannotator hook in a %s', (_label, command) => {
    expect(containsPlannotator(command)).toBe(true);
  });

  it.each([
    ['unrelated executable', 'node app.js'],
    ['Plannotator argument to another executable', 'echo plannotator hook stop'],
    ['Plannotator subcommand without hook', 'plannotator review'],
    ['unsupported npx package', 'npx --package other-tool other-tool hook stop'],
    ['shell without a command flag', 'sh plannotator hook stop'],
    ['comment text', 'echo ready # plannotator hook stop'],
    ['hash embedded in a word', 'echo text# plannotator hook stop'],
    ['empty segments', '&& ; ||'],
    ['npx options without a package command', 'npx --yes --package'],
    ['env options without a command', 'env -u'],
    ['env option without its value', 'env -C'],
    ['env assignments without a command', 'env MODE=review'],
    ['unknown env option', 'env --not-an-env-option plannotator hook stop'],
    ['env separator without a command', 'env --'],
  ])('ignores %s', (_label, command) => {
    expect(containsPlannotator(command)).toBe(false);
  });

  it('recognizes quoted and escaped command text within a shell script', () => {
    expect(containsPlannotator('bash -c "echo ready; plannotator hook stop"')).toBe(true);
    expect(containsPlannotator('plannotator\\ hook stop')).toBe(false);
    expect(containsPlannotator('echo trailing\\')).toBe(false);
  });
});
