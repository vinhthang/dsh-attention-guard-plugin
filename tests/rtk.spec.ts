import { describe, it, expect } from 'vitest';
import {
  tokenizeCommand,
  isInteractiveOrStreaming,
  checkRtkAvailable,
  rewriteCommand,
  clearRtkCache,
  _rtkAvailableCache,
  _rewriteCache,
} from '../src/rtk.js';

describe('rtk module', () => {
  describe('tokenizeCommand', () => {
    it('tokenizes simple commands into word tokens', () => {
      expect(tokenizeCommand('pytest tests/')).toEqual(['pytest', 'tests/']);
      expect(tokenizeCommand('cargo test')).toEqual(['cargo', 'test']);
    });

    it('handles quoted arguments with spaces', () => {
      expect(tokenizeCommand('git commit -m "initial commit"')).toEqual([
        'git',
        'commit',
        '-m',
        'initial commit',
      ]);
      expect(tokenizeCommand("echo 'hello world'")).toEqual(['echo', 'hello world']);
    });

    it('handles extra whitespace and empty strings', () => {
      expect(tokenizeCommand('  cargo   test  ')).toEqual(['cargo', 'test']);
      expect(tokenizeCommand('')).toEqual([]);
      expect(tokenizeCommand('   ')).toEqual([]);
    });

    it('preserves shell operators as separate tokens', () => {
      expect(tokenizeCommand('cargo build && cargo test')).toEqual([
        'cargo',
        'build',
        '&&',
        'cargo',
        'test',
      ]);
    });
  });

  describe('isInteractiveOrStreaming', () => {
    it('detects interactive docker run flags (-it)', () => {
      expect(isInteractiveOrStreaming('docker run -it ubuntu bash')).toBe(true);
      expect(isInteractiveOrStreaming(['docker', 'run', '-it', 'ubuntu'])).toBe(true);
    });

    it('detects interactive git rebase (-i)', () => {
      expect(isInteractiveOrStreaming('git rebase -i HEAD~2')).toBe(true);
    });

    it('detects follow logs (logs -f, tail -f)', () => {
      expect(isInteractiveOrStreaming('logs -f')).toBe(true);
      expect(isInteractiveOrStreaming('tail -f /var/log/syslog')).toBe(true);
    });

    it('detects watch flags (--watch, -w standalone)', () => {
      expect(isInteractiveOrStreaming('vitest --watch')).toBe(true);
      expect(isInteractiveOrStreaming('pnpm test -w')).toBe(true);
    });

    it('verifies --workspace is NOT treated as -w', () => {
      expect(isInteractiveOrStreaming('pnpm --workspace run build')).toBe(false);
      expect(isInteractiveOrStreaming(['pnpm', '--workspace', 'run', 'build'])).toBe(false);
    });

    it('returns false for standard non-interactive batch commands', () => {
      expect(isInteractiveOrStreaming('pytest tests/')).toBe(false);
      expect(isInteractiveOrStreaming('cargo test')).toBe(false);
      expect(isInteractiveOrStreaming('echo hello')).toBe(false);
    });
  });

  describe('checkRtkAvailable', () => {
    it('returns true when rtk binary exists in PATH', () => {
      expect(checkRtkAvailable('rtk')).toBe(true);
    });

    it('returns false when binary does not exist in PATH', () => {
      expect(checkRtkAvailable('nonexistent-binary-xyz-12345')).toBe(false);
    });
  });

  describe('rewriteCommand', () => {
    it('rewrites pytest tests/ to rtk pytest tests/', () => {
      const rewritten = rewriteCommand('pytest tests/');
      expect(rewritten).toBe('rtk pytest tests/');
    });

    it('rewrites cargo test to rtk cargo test', () => {
      const rewritten = rewriteCommand('cargo test');
      expect(rewritten).toBe('rtk cargo test');
    });

    it('rewrites chained commands cargo build && cargo test to rtk cargo build && rtk cargo test', () => {
      const cmd = ['cargo build', 'cargo test'].join(' && ');
      const expected = ['rtk cargo build', 'rtk cargo test'].join(' && ');
      const rewritten = rewriteCommand(cmd);
      expect(rewritten).toBe(expected);
    });

    it('passes through non-intercepted commands such as echo hello', () => {
      expect(rewriteCommand('echo hello')).toBe('echo hello');
    });

    it('is idempotent for already-prefixed rtk commands', () => {
      expect(rewriteCommand('rtk cargo test')).toBe('rtk cargo test');
    });

    it('respects excludeCommands configuration', () => {
      const config = {
        enabled: true,
        model: 'deepseek-flash',
        rtkBinary: 'rtk',
        excludeCommands: ['pytest'],
      };
      expect(rewriteCommand('pytest tests/', config)).toBe('pytest tests/');
      expect(rewriteCommand('cargo test', config)).toBe('rtk cargo test');
    });

    it('bypasses interactive or streaming commands', () => {
      expect(rewriteCommand('docker run -it ubuntu')).toBe('docker run -it ubuntu');
      expect(rewriteCommand('git rebase -i HEAD~1')).toBe('git rebase -i HEAD~1');
      expect(rewriteCommand('tail -f app.log')).toBe('tail -f app.log');
      expect(rewriteCommand('vitest --watch')).toBe('vitest --watch');
    });

    it('fails open on invalid binary without throwing', () => {
      const config = {
        enabled: true,
        model: 'deepseek-flash',
        rtkBinary: 'nonexistent-rtk-bin-xyz',
        excludeCommands: [],
      };
      expect(rewriteCommand('cargo test', config)).toBe('cargo test');
    });
  });

  describe('caching and memoization', () => {
    it('memoizes checkRtkAvailable and rewriteCommand results in memory and clearRtkCache resets cache', () => {
      clearRtkCache();
      expect(_rtkAvailableCache.size).toBe(0);
      expect(_rewriteCache.size).toBe(0);

      // checkRtkAvailable caches result
      expect(checkRtkAvailable('rtk')).toBe(true);
      expect(_rtkAvailableCache.has('rtk')).toBe(true);
      expect(_rtkAvailableCache.get('rtk')).toBe(true);

      // Mutate cache to prove memoized value is returned
      _rtkAvailableCache.set('rtk', false);
      expect(checkRtkAvailable('rtk')).toBe(false);

      // rewriteCommand caches result
      const rewritten1 = rewriteCommand('cargo test');
      expect(rewritten1).toBe('rtk cargo test');
      expect(_rewriteCache.has('rtk:cargo test')).toBe(true);
      expect(_rewriteCache.get('rtk:cargo test')).toBe('rtk cargo test');

      // Mutate cache to prove memoized value is returned
      _rewriteCache.set('rtk:cargo test', 'cached-cargo-test');
      expect(rewriteCommand('cargo test')).toBe('cached-cargo-test');

      // clearRtkCache resets both caches
      clearRtkCache();
      expect(_rtkAvailableCache.size).toBe(0);
      expect(_rewriteCache.size).toBe(0);

      // Subsequent calls re-evaluate
      expect(checkRtkAvailable('rtk')).toBe(true);
      expect(rewriteCommand('cargo test')).toBe('rtk cargo test');
    });
  });
});
