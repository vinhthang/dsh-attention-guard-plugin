import { describe, it, expect, beforeEach } from 'vitest';
import { AttentionGuardCircuitBreaker } from '../src/circuit-breaker.js';

describe('AttentionGuardCircuitBreaker', () => {
  let cb: AttentionGuardCircuitBreaker;

  beforeEach(() => {
    cb = new AttentionGuardCircuitBreaker();
  });

  describe('isTestOrBuildCommand', () => {
    it('recognizes test and build runners', () => {
      expect(cb.isTestOrBuildCommand('pytest tests/')).toBe(true);
      expect(cb.isTestOrBuildCommand('rtk pytest')).toBe(true);
      expect(cb.isTestOrBuildCommand('cargo test')).toBe(true);
      expect(cb.isTestOrBuildCommand('rtk cargo test --lib')).toBe(true);
      expect(cb.isTestOrBuildCommand('cargo build')).toBe(true);
      expect(cb.isTestOrBuildCommand('mvn test')).toBe(true);
      expect(cb.isTestOrBuildCommand('mvn clean verify')).toBe(true);
      expect(cb.isTestOrBuildCommand('npm test')).toBe(true);
      expect(cb.isTestOrBuildCommand('npm run test')).toBe(true);
      expect(cb.isTestOrBuildCommand('pnpm test')).toBe(true);
      expect(cb.isTestOrBuildCommand('vitest run')).toBe(true);
      expect(cb.isTestOrBuildCommand('go test ./...')).toBe(true);
      expect(cb.isTestOrBuildCommand('dotnet test')).toBe(true);
      expect(cb.isTestOrBuildCommand('dotnet build')).toBe(true);
      expect(cb.isTestOrBuildCommand('make test')).toBe(true);
      expect(cb.isTestOrBuildCommand('make check')).toBe(true);
    });

    it('ignores non-test non-build commands', () => {
      expect(cb.isTestOrBuildCommand('ls -la')).toBe(false);
      expect(cb.isTestOrBuildCommand('git status')).toBe(false);
      expect(cb.isTestOrBuildCommand('cat file.txt')).toBe(false);
      expect(cb.isTestOrBuildCommand('echo "running test"')).toBe(false);
      expect(cb.isTestOrBuildCommand('')).toBe(false);
    });
  });

  describe('state transitions and streak tracking', () => {
    it('starts in NORMAL state with streak 0', () => {
      expect(cb.state).toBe('NORMAL');
      expect(cb.streak).toBe(0);
    });

    it('ignores non-test command failures without updating state or streak', () => {
      const outcome = cb.recordExecution('ls -la /nonexistent', 1);
      expect(outcome.state).toBe('NORMAL');
      expect(outcome.streak).toBe(0);
      expect(outcome.advice).toBeUndefined();
      expect(cb.state).toBe('NORMAL');
      expect(cb.streak).toBe(0);
    });

    it('transitions to FAILURE_STAGE_1 on the first test failure', () => {
      const outcome = cb.recordExecution('cargo test', 1);
      expect(cb.streak).toBe(1);
      expect(cb.state).toBe('FAILURE_STAGE_1');
      expect(outcome.state).toBe('FAILURE_STAGE_1');
      expect(outcome.streak).toBe(1);
      expect(outcome.advice).toContain('[ATTENTION GUARD - ATTEMPT 1]');
      expect(outcome.advice).toContain('Speculative in-place edits are discouraged');
    });

    it('transitions to FAILURE_STAGE_2_TRIPPED on consecutive test failures', () => {
      cb.recordExecution('cargo test', 1);
      const outcome = cb.recordExecution('cargo test', 1);

      expect(cb.streak).toBe(2);
      expect(cb.state).toBe('FAILURE_STAGE_2_TRIPPED');
      expect(outcome.state).toBe('FAILURE_STAGE_2_TRIPPED');
      expect(outcome.streak).toBe(2);
      expect(outcome.advice).toContain('[ATTENTION GUARD - ATTEMPT 2]');
      expect(outcome.advice).toContain('Consecutive test failures (Streak: 2)');
    });

    it('handles null exitCode (signal termination/crash) as failure', () => {
      const outcome = cb.recordExecution('pytest', null);
      expect(cb.streak).toBe(1);
      expect(cb.state).toBe('FAILURE_STAGE_1');
      expect(outcome.advice).toBeDefined();
    });

    it('transitions to RECOVERY_VERIFIED and resets streak to 0 on exitCode 0', () => {
      cb.recordExecution('cargo test', 1);
      cb.recordExecution('cargo test', 1);
      expect(cb.streak).toBe(2);
      expect(cb.state).toBe('FAILURE_STAGE_2_TRIPPED');

      const outcome = cb.recordExecution('cargo test', 0);
      expect(cb.streak).toBe(0);
      expect(cb.state).toBe('RECOVERY_VERIFIED');
      expect(outcome.state).toBe('RECOVERY_VERIFIED');
      expect(outcome.streak).toBe(0);
      expect(outcome.advice).toBeUndefined();
    });
  });
});
