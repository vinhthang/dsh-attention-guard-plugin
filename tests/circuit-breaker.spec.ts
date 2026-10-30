import { describe, it, expect, beforeEach } from 'vitest';
import {
  AttentionGuardCircuitBreaker,
  normalizeCommandSignature,
} from '../src/circuit-breaker.js';

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

    it('recognizes expanded build and test runners', () => {
      expect(cb.isTestOrBuildCommand('cmake --build .')).toBe(true);
      expect(cb.isTestOrBuildCommand('ninja')).toBe(true);
      expect(cb.isTestOrBuildCommand('pip install -e .')).toBe(true);
      expect(cb.isTestOrBuildCommand('go build ./...')).toBe(true);
      expect(cb.isTestOrBuildCommand('pnpm run build')).toBe(true);
      expect(cb.isTestOrBuildCommand('npm run build')).toBe(true);
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

  describe('normalizeCommandSignature', () => {
    it('normalizes log-polling variations targeting the same file to POLL_FILE:<path>', () => {
      expect(normalizeCommandSignature('rtk tail -n 25 /tmp/run.log')).toBe('POLL_FILE:/tmp/run.log');
      expect(normalizeCommandSignature('rtk tail -n 50 /tmp/run.log')).toBe('POLL_FILE:/tmp/run.log');
      expect(normalizeCommandSignature('wc -l /tmp/run.log')).toBe('POLL_FILE:/tmp/run.log');
      expect(normalizeCommandSignature('head -n 20 /tmp/run.log')).toBe('POLL_FILE:/tmp/run.log');
      expect(
        normalizeCommandSignature(
          'python3 -c "lines = open(\'/tmp/run.log\').readlines()[-25:]"'
        )
      ).toBe('POLL_FILE:/tmp/run.log');
    });

    it('normalizes process-polling variations targeting the same PID or target to POLL_PROC:<target>', () => {
      expect(normalizeCommandSignature('pgrep -P 59170 -l')).toBe('POLL_PROC:59170');
      expect(normalizeCommandSignature('pgrep -fl -P 59170')).toBe('POLL_PROC:59170');
      expect(normalizeCommandSignature('ps -p 59170 -o pid,comm')).toBe('POLL_PROC:59170');
      expect(normalizeCommandSignature('sleep 2 && pgrep -P 59170 -l')).toBe('POLL_PROC:59170');
      expect(normalizeCommandSignature('rtk sleep 3 && ps -p 59170')).toBe('POLL_PROC:59170');
    });

    it('strips rtk, rtk proxy, and sudo prefixes and trims whitespace for general commands', () => {
      expect(normalizeCommandSignature('rtk cargo test')).toBe('cargo test');
      expect(normalizeCommandSignature('rtk proxy pytest tests/')).toBe('pytest tests/');
      expect(normalizeCommandSignature('sudo make test')).toBe('make test');
      expect(normalizeCommandSignature('  git status  ')).toBe('git status');
    });
  });

  describe('checkDoomLoop', () => {
    it('allows 1st and 2nd identical command, returns circuit-breaker error string on 3rd consecutive identical command', () => {
      expect(cb.checkDoomLoop('cargo test', 3)).toBeNull();
      expect(cb.checkDoomLoop('cargo test', 3)).toBeNull();
      const err = cb.checkDoomLoop('cargo test', 3);
      expect(err).toBe(
        "Attention Guard: Subagent doom-loop circuit breaker. Command 'cargo test' executed 3 times consecutively without intervening file edits. Do not poll processes or logs in a shell loop; return your current status or await async completion."
      );
    });

    it('blocks 3 consecutive log-polling variations targeting the same file (REQ-024)', () => {
      expect(cb.checkDoomLoop('rtk tail -n 25 /tmp/run.log', 3)).toBeNull();
      expect(cb.checkDoomLoop('rtk tail -n 50 /tmp/run.log', 3)).toBeNull();
      const err = cb.checkDoomLoop('wc -l /tmp/run.log', 3);
      expect(err).not.toBeNull();
      expect(err).toContain("Attention Guard: Subagent doom-loop circuit breaker.");
      expect(err).toContain("Command 'wc -l /tmp/run.log' executed 3 times consecutively without intervening file edits.");
      expect(err).toContain("Do not poll processes or logs in a shell loop; return your current status or await async completion.");
    });

    it('blocks 3 consecutive process-polling variations targeting the same process or PID (REQ-024)', () => {
      expect(cb.checkDoomLoop('pgrep -P 59170 -l', 3)).toBeNull();
      expect(cb.checkDoomLoop('pgrep -fl -P 59170', 3)).toBeNull();
      const err = cb.checkDoomLoop('ps -p 59170 -o pid,comm', 3);
      expect(err).not.toBeNull();
      expect(err).toContain("Attention Guard: Subagent doom-loop circuit breaker.");
      expect(err).toContain("Command 'ps -p 59170 -o pid,comm' executed 3 times consecutively without intervening file edits.");
      expect(err).toContain("Do not poll processes or logs in a shell loop; return your current status or await async completion.");
    });

    it('resets doom loop count when cb.recordFileEdit() is called', () => {
      expect(cb.checkDoomLoop('cargo test', 3)).toBeNull();
      expect(cb.checkDoomLoop('cargo test', 3)).toBeNull();
      cb.recordFileEdit();
      expect(cb.checkDoomLoop('cargo test', 3)).toBeNull();
    });

    it('resets doom loop count when a different command is executed', () => {
      expect(cb.checkDoomLoop('cargo test', 3)).toBeNull();
      expect(cb.checkDoomLoop('cargo test', 3)).toBeNull();
      expect(cb.checkDoomLoop('pytest', 3)).toBeNull();
      expect(cb.checkDoomLoop('cargo test', 3)).toBeNull();
    });
  });

  describe('token salience and session token tracking', () => {
    it('accumulates totalSessionTokens and tokensSinceRefresh', () => {
      expect(cb.totalSessionTokens).toBe(0);
      expect(cb.tokensSinceRefresh).toBe(0);

      cb.recordTokens(400); // 400 chars -> 100 tokens
      expect(cb.totalSessionTokens).toBe(100);
      expect(cb.tokensSinceRefresh).toBe(100);

      cb.recordTokens(400);
      expect(cb.totalSessionTokens).toBe(200);
      expect(cb.tokensSinceRefresh).toBe(200);
    });

    it('emits reminder when tokensSinceRefresh >= 40000 and resets tokensSinceRefresh', () => {
      cb.recordTokens(160000); // 160,000 chars -> 40,000 tokens
      expect(cb.tokensSinceRefresh).toBe(40000);

      const reminder = cb.checkTokenSalience(1, 25);
      expect(reminder).not.toBeNull();
      expect(reminder).toContain('[Context Telemetry: ~40,000 tokens');
      expect(cb.tokensSinceRefresh).toBe(0);
      expect(cb.totalSessionTokens).toBe(40000);
    });

    it('suppresses 25-turn reminder when totalSessionTokens < 20000', () => {
      cb.recordTokens(40000); // 10,000 tokens (< 20,000)
      const reminder = cb.checkTokenSalience(25, 25);
      expect(reminder).toBeNull();
    });

    it('emits 25-turn reminder when totalSessionTokens >= 20000 at interval turn', () => {
      cb.recordTokens(100000); // 25,000 tokens (>= 20,000)
      cb.resetRefreshCounter();
      const reminder = cb.checkTokenSalience(25, 25);
      expect(reminder).not.toBeNull();
      expect(reminder).toContain('[Context Telemetry: ~25,000 tokens');
      expect(reminder).toContain('turn 25');
    });
  });
});
