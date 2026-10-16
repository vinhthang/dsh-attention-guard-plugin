export type CircuitBreakerState =
  | 'NORMAL'
  | 'FAILURE_STAGE_1'
  | 'FAILURE_STAGE_2_TRIPPED'
  | 'RECOVERY_VERIFIED';

export interface CircuitBreakerOutcome {
  state: CircuitBreakerState;
  streak: number;
  advice?: string;
}

export class AttentionGuardCircuitBreaker {
  streak: number = 0;
  state: CircuitBreakerState = 'NORMAL';

  isTestOrBuildCommand(cmd: string): boolean {
    if (!cmd || !cmd.trim()) return false;
    const trimmed = cmd.trim();

    const patterns = [
      /\b(?:pytest|vitest|jest|mocha|ctest)\b/,
      /\bcargo\s+(?:test|build|check)\b/,
      /\b(?:mvn|\.\/gradlew|gradle)\b/,
      /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|t)\b/,
      /\bgo\s+test\b/,
      /\bdotnet\s+(?:test|build)\b/,
      /\bmake\s+(?:test|check)\b/,
    ];

    return patterns.some((p) => p.test(trimmed));
  }

  recordExecution(command: string, exitCode: number | null): CircuitBreakerOutcome {
    if (!this.isTestOrBuildCommand(command)) {
      return { state: this.state, streak: this.streak };
    }

    if (exitCode === 0) {
      this.streak = 0;
      this.state = 'RECOVERY_VERIFIED';
      return { state: this.state, streak: 0 };
    }

    this.streak += 1;
    let advice: string;
    if (this.streak === 1) {
      this.state = 'FAILURE_STAGE_1';
      advice = `\n[ATTENTION GUARD - FAILURE_STAGE_1]: Test failure detected. Speculative in-place edits are discouraged. Author an isolated test reproducer (test_*, *_test.*) or diagnostic doc (diagnosis.md, rca.md) before fixing code.\n`;
    } else {
      this.state = 'FAILURE_STAGE_2_TRIPPED';
      advice = `\n[ATTENTION GUARD - FAILURE_STAGE_2_TRIPPED]: Consecutive test failures (Streak: ${this.streak}). Circuit breaker tripped: stop speculative trial-and-error edits immediately. Isolate root cause in diagnosis.md or inspect offloaded diagnostics.\n`;
    }

    return { state: this.state, streak: this.streak, advice };
  }
}
