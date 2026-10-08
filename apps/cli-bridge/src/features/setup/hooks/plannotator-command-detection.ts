export function containsPlannotator(command: string): boolean {
  const tokens = tokenizeShellCommand(command);
  const segments: string[][] = [[]];
  for (const token of tokens) {
    if (token.operator && [';', '&&', '||', '|', '|&', '&', '(', ')', '\n'].includes(token.value)) {
      segments.push([]);
    } else if (!token.operator) {
      segments[segments.length - 1]?.push(token.value);
    }
  }
  return segments.some((segment) => commandSegmentContainsPlannotator(segment));
}

interface ShellToken {
  readonly value: string;
  readonly operator: boolean;
}

function tokenizeShellCommand(command: string): ShellToken[] {
  const tokens: ShellToken[] = [];
  let value = '';
  let quote: "'" | '"' | undefined;
  let escaped = false;
  let tokenStarted = false;

  const pushWord = (): void => {
    if (!tokenStarted) return;
    tokens.push({ value, operator: false });
    value = '';
    tokenStarted = false;
  };

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (character === undefined) continue;
    if (escaped) {
      value += character;
      tokenStarted = true;
      escaped = false;
      continue;
    }
    if (quote === "'") {
      if (character === "'") quote = undefined;
      else value += character;
      tokenStarted = true;
      continue;
    }
    if (character === '\\' && quote !== '"') {
      escaped = true;
      tokenStarted = true;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = undefined;
      else value += character;
      tokenStarted = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (character === '#') {
      const startsComment = !tokenStarted && (index === 0 || /\s/.test(command[index - 1] ?? ''));
      if (startsComment) {
        while (index < command.length && command[index] !== '\n') index += 1;
        pushWord();
        tokens.push({ value: '\n', operator: true });
        continue;
      }
    }
    if (/\s/.test(character)) {
      pushWord();
      if (character === '\n') tokens.push({ value: '\n', operator: true });
      continue;
    }
    const operator = ['&&', '||', '|&', ';;', ';&', '|', '&', ';', '(', ')'].find((candidate) =>
      command.startsWith(candidate, index),
    );
    if (operator !== undefined) {
      pushWord();
      tokens.push({ value: operator, operator: true });
      index += operator.length - 1;
      continue;
    }
    value += character;
    tokenStarted = true;
  }
  if (escaped) value += '\\';
  pushWord();
  return tokens;
}

function commandSegmentContainsPlannotator(segment: string[]): boolean {
  if (segment.length === 0) return false;
  let commandIndex = 0;
  while (segment[commandIndex] !== undefined && isShellAssignment(segment[commandIndex] ?? '')) {
    commandIndex += 1;
  }
  const executable = segment[commandIndex];
  if (executable === undefined) return false;
  const commandName = getExecutableName(executable);

  if (isPlannotatorExecutable(executable)) {
    return segment[commandIndex + 1]?.toLowerCase() === 'hook';
  }
  if (commandName === 'npx') {
    const executableIndex = getNpxExecutableIndex(segment, commandIndex + 1);
    return (
      executableIndex !== undefined &&
      isPlannotatorExecutable(segment[executableIndex] ?? '') &&
      segment[executableIndex + 1]?.toLowerCase() === 'hook'
    );
  }
  if (['sh', 'bash', 'dash', 'zsh', 'ksh'].includes(commandName)) {
    const commandFlagIndex = segment.findIndex(
      (argument, index) => index > commandIndex && argument === '-c',
    );
    const script = commandFlagIndex < 0 ? undefined : segment[commandFlagIndex + 1];
    return script !== undefined && containsPlannotator(script);
  }
  return false;
}

function getNpxExecutableIndex(segment: string[], startIndex: number): number | undefined {
  let index = startIndex;
  while (index < segment.length) {
    const argument = segment[index] ?? '';
    if (argument === '--') return index + 1;
    if (!argument.startsWith('-')) return index;
    if (['-p', '--package'].includes(argument)) index += 2;
    else index += 1;
  }
  return undefined;
}

function isShellAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function isPlannotatorExecutable(token: string): boolean {
  return getExecutableName(token) === 'plannotator';
}

function getExecutableName(token: string): string {
  const basename = token.toLowerCase().split(/[\\/]/).at(-1) ?? '';
  return basename.replace(/\.(?:cmd|exe|bat)$/, '');
}
