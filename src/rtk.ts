import { spawnSync } from 'node:child_process';
import type { Config } from './schema.js';

const INTERACTIVE_FLAGS = new Set([
  '-it',
  '-ti',
  '-i',
  '--interactive',
]);

const STREAMING_FLAGS = new Set([
  '-f',
  '-F',
  '--follow',
  '-w',
  '--watch',
  '--watchAll',
]);

const INTERACTIVE_BINARIES = new Set([
  'vi',
  'vim',
  'nvim',
  'nano',
  'top',
  'htop',
  'less',
  'more',
  'ssh',
]);

/**
 * Tokenizes a shell command string into an array of argument tokens,
 * correctly handling single/double quotes and whitespace.
 */
export function tokenizeCommand(command: string): string[] {
  if (!command || !command.trim()) {
    return [];
  }

  const tokens: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escape = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escape) {
      current += char;
      escape = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escape = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Checks whether the command contains interactive flags or streaming flags.
 * Standalone -w or --watch are identified, while flags like --workspace are not.
 */
export function isInteractiveOrStreaming(command: string | string[]): boolean {
  const tokens = Array.isArray(command) ? command : tokenizeCommand(command);
  if (tokens.length === 0) {
    return false;
  }

  const firstBinary = tokens[0] === 'rtk' && tokens.length > 1 ? tokens[1] : tokens[0];
  if (INTERACTIVE_BINARIES.has(firstBinary)) {
    return true;
  }

  for (const token of tokens) {
    if (INTERACTIVE_FLAGS.has(token) || STREAMING_FLAGS.has(token)) {
      return true;
    }
  }

  return false;
}

/**
 * Checks whether the rtk binary is available in PATH via `which`.
 */
export function checkRtkAvailable(rtkBinary: string = 'rtk'): boolean {
  try {
    const result = spawnSync('which', [rtkBinary], {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 1500,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Invokes `rtk rewrite <command>` to rewrite the command into an RTK-prefixed command.
 * If status === 3 and non-empty stdout, returns the trimmed stdout.
 * Otherwise returns the original command (fail-open).
 */
export function rewriteCommand(command: string, config?: Partial<Config>): string {
  if (!command || !command.trim()) {
    return command;
  }

  const tokens = tokenizeCommand(command);
  if (tokens.length === 0) {
    return command;
  }

  // Check excludeCommands
  if (config?.excludeCommands && config.excludeCommands.length > 0) {
    const baseCommand = tokens[0] === 'rtk' && tokens.length > 1 ? tokens[1] : tokens[0];
    if (config.excludeCommands.some((ex) => ex === baseCommand || command.trim().startsWith(ex))) {
      return command;
    }
  }

  // Check for interactive or streaming flags
  if (isInteractiveOrStreaming(tokens)) {
    return command;
  }

  const rtkBinary = config?.rtkBinary || 'rtk';

  try {
    const result = spawnSync(rtkBinary, ['rewrite', command], {
      encoding: 'utf-8',
      timeout: 1500,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.status === 3 && result.stdout && result.stdout.trim().length > 0) {
      return result.stdout.trim();
    }

    return command;
  } catch {
    return command;
  }
}
