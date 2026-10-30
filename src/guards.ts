import { tokenizeCommand } from './rtk.js';

export const PYTHON_TAMPER_PATTERNS: readonly string[] = [
  '@pytest.mark.skip',
  '@pytest.mark.xfail',
  '@unittest.skip',
  'pytest.skip(',
  'pytest.xfail(',
  'assert True',
] as const;

export const JS_TS_TAMPER_PATTERNS: readonly string[] = [
  'it.skip(',
  'describe.skip(',
  'test.skip(',
] as const;

export const GO_TAMPER_PATTERNS: readonly string[] = [
  't.Skip(',
] as const;

export const TEST_TAMPER_PATTERNS: readonly string[] = [
  ...PYTHON_TAMPER_PATTERNS,
  ...JS_TS_TAMPER_PATTERNS,
  ...GO_TAMPER_PATTERNS,
] as const;

export function getTamperPatternsForFile(file: string): readonly string[] {
  const norm = file.toLowerCase();
  if (norm.endsWith('.py')) {
    return PYTHON_TAMPER_PATTERNS;
  }
  if (
    norm.endsWith('.ts') ||
    norm.endsWith('.tsx') ||
    norm.endsWith('.js') ||
    norm.endsWith('.jsx') ||
    norm.endsWith('.mjs') ||
    norm.endsWith('.cjs')
  ) {
    return JS_TS_TAMPER_PATTERNS;
  }
  if (norm.endsWith('.go')) {
    return GO_TAMPER_PATTERNS;
  }
  return TEST_TAMPER_PATTERNS;
}

export function isTestFile(targetFile: string): boolean {
  if (!targetFile || typeof targetFile !== 'string') return false;
  const norm = targetFile.replace(/\\/g, '/').toLowerCase();
  const base = norm.split('/').pop() || '';
  if (!base) return false;

  if (
    norm.includes('/tests/') ||
    norm.startsWith('tests/') ||
    norm.includes('/test/') ||
    norm.startsWith('test/')
  ) {
    if (base.includes('.') || base.includes('_test')) {
      return true;
    }
  }
  if ((base.startsWith('test_') && base.endsWith('.py')) || base.endsWith('_test.py')) {
    return true;
  }
  if (
    base.endsWith('.test.ts') ||
    base.endsWith('.spec.ts') ||
    base.endsWith('_test.go') ||
    base.endsWith('.test.js') ||
    base.endsWith('.spec.js')
  ) {
    return true;
  }
  return false;
}

export function checkDestructiveCommand(cmdStr: string): string | null {
  if (!cmdStr || typeof cmdStr !== 'string') return null;
  const normalizedCmd = cmdStr.replace(/\\\r?\n/g, ' ');
  const subCmds = normalizedCmd.split(/[;&|]+/);
  for (const sub of subCmds) {
    const s = sub.trim();
    if (!s) continue;
    const tokens = tokenizeCommand(s);
    while (tokens.length > 0 && (tokens[0] === 'rtk' || tokens[0] === 'sudo')) {
      tokens.shift();
    }
    if (tokens.length === 0) continue;

    const binName = tokens[0];
    if (binName === 'git' && tokens.length > 1) {
      const subcmd = tokens[1];
      if (
        subcmd === 'reset' &&
        tokens.slice(2).some((t) => t === '--hard' || t.startsWith('--hard='))
      ) {
        return `Attention Guard: Sweeping destructive command '${cmdStr}' is forbidden (git reset --hard).`;
      }
      if (subcmd === 'clean') {
        for (const t of tokens.slice(2)) {
          if (t.startsWith('-') && t !== '--') {
            if (t.includes('f') || t.includes('F')) {
              return `Attention Guard: Sweeping destructive command '${cmdStr}' is forbidden (git clean -f).`;
            }
          }
        }
      }
      if (subcmd === 'checkout') {
        if (tokens.slice(2).some((t) => t === '.')) {
          return `Attention Guard: Sweeping destructive command '${cmdStr}' is forbidden (git checkout .).`;
        }
      }
      if (subcmd === 'restore') {
        if (tokens.slice(2).some((t) => t === '.')) {
          return `Attention Guard: Sweeping destructive command '${cmdStr}' is forbidden (git restore .).`;
        }
      }
      if (subcmd === 'push') {
        const hasLease = tokens.slice(2).some((t) => t.includes('--force-with-lease'));
        const hasForce = tokens
          .slice(2)
          .some(
            (t) =>
              t === '--force' ||
              t === '-f' ||
              (t.startsWith('-') && !t.startsWith('--') && t.includes('f'))
          );
        if (hasForce && !hasLease) {
          return `Attention Guard: Destructive command '${cmdStr}' is forbidden (git push --force without --force-with-lease).`;
        }
      }
    }

    if (binName === 'rm') {
      let isRecursive = false;
      const targets: string[] = [];
      for (const t of tokens.slice(1)) {
        if (t.startsWith('-') && t !== '--') {
          if (t.includes('r') || t.includes('R')) {
            isRecursive = true;
          }
        } else if (t !== '--') {
          targets.push(t);
        }
      }
      if (isRecursive) {
        const catastrophic = new Set([
          '/',
          '~',
          '$HOME',
          '${HOME}',
          '.',
          '..',
          '.git',
          './.git',
          '/.git',
        ]);
        const hasExplicitEmptyQuote = /["']\s*["']/.test(s);
        for (const tgt of targets) {
          const trimmed = tgt.trim();
          if (!trimmed && !hasExplicitEmptyQuote) {
            continue;
          }
          const norm = trimmed.replace(/\/+$/, '');
          if (
            catastrophic.has(norm) ||
            catastrophic.has(trimmed) ||
            (norm === '' && trimmed.length > 0) ||
            (norm === '' && hasExplicitEmptyQuote)
          ) {
            return `Attention Guard: Sweeping destructive command '${cmdStr}' is forbidden (catastrophic rm targeting '${tgt}').`;
          }
        }
      }
    }
  }
  return null;
}

export function matchesTamperPattern(cmdStr: string, pattern: string): boolean {
  if (pattern.startsWith('@')) {
    return cmdStr.includes(pattern);
  }
  if (pattern === 'assert True') {
    return /\bassert\s+True\b/.test(cmdStr);
  }
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(?:^|[^a-zA-Z0-9_])${escaped}`);
  return regex.test(cmdStr);
}

export function checkTestTampering(cmdStr: string): string | null {
  if (!cmdStr || typeof cmdStr !== 'string') return null;

  if (process.env.AGY_ALLOW_TEST_SKIP === '1' || process.env.DSH_ALLOW_TEST_SKIP === '1') {
    return null;
  }

  const tokens = cmdStr.split(/[\s'"`;|><]+/);
  let targetTestFile: string | null = null;
  for (const token of tokens) {
    const candidate = token.trim();
    if (candidate && isTestFile(candidate)) {
      targetTestFile = candidate;
      break;
    }
  }

  if (!targetTestFile) {
    return null;
  }

  const applicablePatterns = getTamperPatternsForFile(targetTestFile);
  for (const pattern of applicablePatterns) {
    if (matchesTamperPattern(cmdStr, pattern)) {
      return `Attention Guard: Test tampering detected. Introducing test-skipping marker or bypass '${pattern}' in test file '${targetTestFile}' is forbidden.`;
    }
  }

  return null;
}
