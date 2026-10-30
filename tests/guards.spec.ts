import { describe, it, expect, afterEach } from 'vitest';
import {
  checkDestructiveCommand,
  checkTestTampering,
  isTestFile,
  TEST_TAMPER_PATTERNS,
  PYTHON_TAMPER_PATTERNS,
  JS_TS_TAMPER_PATTERNS,
  GO_TAMPER_PATTERNS,
} from '../src/guards.js';

describe('guards module', () => {
  describe('isTestFile', () => {
    it('identifies python test files', () => {
      expect(isTestFile('tests/test_foo.py')).toBe(true);
      expect(isTestFile('test_bar.py')).toBe(true);
      expect(isTestFile('tests/sub/foo_test.py')).toBe(true);
    });

    it('identifies typescript and javascript test files', () => {
      expect(isTestFile('src/foo.spec.ts')).toBe(true);
      expect(isTestFile('foo.test.ts')).toBe(true);
      expect(isTestFile('tests/app.spec.js')).toBe(true);
      expect(isTestFile('components/btn.test.js')).toBe(true);
    });

    it('identifies go test files', () => {
      expect(isTestFile('foo_test.go')).toBe(true);
      expect(isTestFile('pkg/handler_test.go')).toBe(true);
    });

    it('returns false for non-test files', () => {
      expect(isTestFile('src/index.ts')).toBe(false);
      expect(isTestFile('README.md')).toBe(false);
      expect(isTestFile('package.json')).toBe(false);
      expect(isTestFile('')).toBe(false);
    });
  });

  describe('checkDestructiveCommand', () => {
    it('blocks git reset --hard and variants', () => {
      expect(checkDestructiveCommand('git reset --hard')).toContain('git reset --hard');
      expect(checkDestructiveCommand('git reset --hard HEAD~1')).toContain('git reset --hard');
      expect(checkDestructiveCommand('rtk git reset --hard')).toContain('git reset --hard');
      expect(checkDestructiveCommand('git reset --hard=HEAD~2')).toContain('git reset --hard');
    });

    it('blocks git clean -f variants', () => {
      expect(checkDestructiveCommand('git clean -f')).toContain('git clean -f');
      expect(checkDestructiveCommand('git clean -fd')).toContain('git clean -f');
      expect(checkDestructiveCommand('git clean -fx')).toContain('git clean -f');
      expect(checkDestructiveCommand('rtk git clean -fxd')).toContain('git clean -f');
    });

    it('blocks git checkout . and git restore .', () => {
      expect(checkDestructiveCommand('git checkout .')).toContain('git checkout .');
      expect(checkDestructiveCommand('git checkout -- .')).toContain('git checkout .');
      expect(checkDestructiveCommand('git restore .')).toContain('git restore .');
    });

    it('blocks git push --force without --force-with-lease', () => {
      expect(checkDestructiveCommand('git push --force')).toContain('git push --force without --force-with-lease');
      expect(checkDestructiveCommand('git push -f origin main')).toContain('git push --force without --force-with-lease');
    });

    it('allows safe git operations', () => {
      expect(checkDestructiveCommand('git push --force-with-lease origin main')).toBeNull();
      expect(checkDestructiveCommand('git status')).toBeNull();
      expect(checkDestructiveCommand('git checkout -b feat/new')).toBeNull();
      expect(checkDestructiveCommand('git clean -n')).toBeNull();
    });

    it('blocks catastrophic rm -rf targets', () => {
      expect(checkDestructiveCommand('rm -rf /')).toContain('catastrophic rm');
      expect(checkDestructiveCommand('rm -rf ~')).toContain('catastrophic rm');
      expect(checkDestructiveCommand('rm -rf $HOME')).toContain('catastrophic rm');
      expect(checkDestructiveCommand('rm -rf ${HOME}')).toContain('catastrophic rm');
      expect(checkDestructiveCommand('rm -rf .')).toContain('catastrophic rm');
      expect(checkDestructiveCommand('rm -rf ..')).toContain('catastrophic rm');
      expect(checkDestructiveCommand('rm -rf .git')).toContain('catastrophic rm');
      expect(checkDestructiveCommand('rm -rf ./.git')).toContain('catastrophic rm');
    });

    it('allows safe rm commands', () => {
      expect(checkDestructiveCommand('rm -rf dist/ build/')).toBeNull();
      expect(checkDestructiveCommand('rm -f temp.txt')).toBeNull();
      expect(checkDestructiveCommand('rm test.log')).toBeNull();
    });

    it('allows multiline backslash-continued rm targeting valid directories (REQ-026)', () => {
      const multilineCmd = [
        'rtk rm -rf \\',
        '  "/Users/thanghoang/Library/Application Support/JetBrains/sonarlint-intellij" \\',
        '  "/Users/thanghoang/.cache/github-copilot"',
      ].join('\n');
      expect(checkDestructiveCommand(multilineCmd)).toBeNull();
    });

    it('blocks multiline backslash-continued rm targeting catastrophic paths (REQ-026)', () => {
      expect(checkDestructiveCommand('rm -rf \\\n  /')).toContain('catastrophic rm');
      expect(checkDestructiveCommand('rm -rf \\\n  .git')).toContain('catastrophic rm');
    });
  });

  describe('checkTestTampering', () => {
    const originalAgy = process.env.AGY_ALLOW_TEST_SKIP;
    const originalDsh = process.env.DSH_ALLOW_TEST_SKIP;

    afterEach(() => {
      if (originalAgy !== undefined) {
        process.env.AGY_ALLOW_TEST_SKIP = originalAgy;
      } else {
        delete process.env.AGY_ALLOW_TEST_SKIP;
      }
      if (originalDsh !== undefined) {
        process.env.DSH_ALLOW_TEST_SKIP = originalDsh;
      } else {
        delete process.env.DSH_ALLOW_TEST_SKIP;
      }
    });

    it('blocks commands introducing test skipping patterns into test files', () => {
      for (const pattern of PYTHON_TAMPER_PATTERNS) {
        const cmd = `echo "${pattern}" >> tests/test_foo.py`;
        const result = checkTestTampering(cmd);
        expect(result).not.toBeNull();
        expect(result).toContain('Attention Guard: Test tampering detected');
        expect(result).toContain(pattern);
      }
      for (const pattern of JS_TS_TAMPER_PATTERNS) {
        const cmd = `echo "${pattern}" >> tests/app.spec.ts`;
        const result = checkTestTampering(cmd);
        expect(result).not.toBeNull();
        expect(result).toContain('Attention Guard: Test tampering detected');
        expect(result).toContain(pattern);
      }
      for (const pattern of GO_TAMPER_PATTERNS) {
        const cmd = `echo "${pattern}" >> pkg/app_test.go`;
        const result = checkTestTampering(cmd);
        expect(result).not.toBeNull();
        expect(result).toContain('Attention Guard: Test tampering detected');
        expect(result).toContain(pattern);
      }
    });

    it('scopes test tampering markers by target test file extension (REQ-025)', () => {
      const pyMarker = ['@pytest', 'mark', 'skip'].join('.');
      const pyFn = ['pytest', 'skip('].join('.');
      const tsFn = ['it', 'skip('].join('.');
      const goFn = ['t', 'Skip('].join('.');

      // Allows Python tamper markers in a TypeScript test file
      expect(checkTestTampering(`echo "${pyMarker}" >> tests/guards.spec.ts`)).toBeNull();
      expect(checkTestTampering(`echo "${pyFn}" >> tests/guards.spec.ts`)).toBeNull();

      // Blocks TypeScript tamper markers in a TypeScript test file
      const tsBlock = checkTestTampering(`echo "${tsFn}" >> tests/guards.spec.ts`);
      expect(tsBlock).not.toBeNull();
      expect(tsBlock).toContain('Attention Guard: Test tampering detected');
      expect(tsBlock).toContain(tsFn);
      expect(tsBlock).toContain('tests/guards.spec.ts');

      // Blocks Python tamper markers in a Python test file
      const pyBlock = checkTestTampering(`echo "${pyMarker}" >> tests/test_foo.py`);
      expect(pyBlock).not.toBeNull();
      expect(pyBlock).toContain('Attention Guard: Test tampering detected');
      expect(pyBlock).toContain(pyMarker);
      expect(pyBlock).toContain('tests/test_foo.py');

      // Allows TypeScript tamper markers in a Python test file
      expect(checkTestTampering(`echo "${tsFn}" >> tests/test_foo.py`)).toBeNull();

      // Blocks Go tamper markers in a Go test file
      const goBlock = checkTestTampering(`echo "${goFn}" >> pkg/auth_test.go`);
      expect(goBlock).not.toBeNull();
      expect(goBlock).toContain('Attention Guard: Test tampering detected');
      expect(goBlock).toContain(goFn);

      // Allows Go tamper markers in Python and TypeScript test files
      expect(checkTestTampering(`echo "${goFn}" >> tests/test_foo.py`)).toBeNull();
      expect(checkTestTampering(`echo "${goFn}" >> tests/guards.spec.ts`)).toBeNull();
    });

    it('blocks sed in-place test tampering', () => {
      const skipCall = ['it', 'skip('].join('.');
      const cmd = `sed -i "s/it(/${skipCall}/g" tests/app.spec.ts`;
      const result = checkTestTampering(cmd);
      expect(result).not.toBeNull();
      expect(result).toContain('Attention Guard: Test tampering detected');
      expect(result).toContain(skipCall);
      expect(result).toContain('tests/app.spec.ts');
    });

    it('blocks test tampering targeting various test file extensions', () => {
      const pySkip = ['pytest', 'skip("flaky")'].join('.');
      const tsSkip = ['test', 'skip("flaky")'].join('.');
      const descSkip = ['describe', 'skip("suite")'].join('.');
      const goSkip = ['t', 'Skip("skip")'].join('.');
      const assertConst = ['assert', 'True'].join(' ');

      expect(checkTestTampering(`echo "${pySkip}" >> tests/test_app.py`)).not.toBeNull();
      expect(checkTestTampering(`echo "${tsSkip}" >> src/foo.spec.ts`)).not.toBeNull();
      expect(checkTestTampering(`echo "${descSkip}" >> foo.test.ts`)).not.toBeNull();
      expect(checkTestTampering(`echo "${goSkip}" >> foo_test.go`)).not.toBeNull();
      expect(checkTestTampering(`echo "${assertConst}" >> tests/test_foo.py`)).not.toBeNull();
    });

    it('allows normal test commands and editing non-test files', () => {
      expect(checkTestTampering('pytest tests/')).toBeNull();
      const skipMarker = ['@pytest', 'mark', 'skip'].join('.');
      expect(checkTestTampering(`echo "${skipMarker}" >> docs/notes.md`)).toBeNull();
      expect(checkTestTampering('echo "const x = 1;" >> tests/test_foo.py')).toBeNull();
      expect(checkTestTampering('git diff')).toBeNull();
    });

    it('allows bypass when AGY_ALLOW_TEST_SKIP or DSH_ALLOW_TEST_SKIP is set to 1', () => {
      const skipMarker = ['@pytest', 'mark', 'skip'].join('.');
      process.env.AGY_ALLOW_TEST_SKIP = '1';
      expect(checkTestTampering(`echo "${skipMarker}" >> tests/test_foo.py`)).toBeNull();

      delete process.env.AGY_ALLOW_TEST_SKIP;
      process.env.DSH_ALLOW_TEST_SKIP = '1';
      expect(checkTestTampering(`echo "${skipMarker}" >> tests/test_foo.py`)).toBeNull();
    });
  });
});
