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

/**
 * Normalizes shell commands to detect repeated polling of the same log file or process.
 * 1. Strips leading sleep <N> && or rtk sleep <N> && prefixes.
 * 2. Strips leading rtk, rtk proxy, and sudo prefixes and collapses whitespace.
 * 3. File-polling:
 *    - tail, head, wc targeting a file path -> POLL_FILE:<path>
 *    - python/python3 -c reading a file via open/Path without write mode -> POLL_FILE:<path>
 * 4. Process-polling:
 *    - pgrep or ps with PID (-P <pid>, -p <pid>) or grep pattern -> POLL_PROC:<target>
 * 5. Otherwise returns trimmed command with stripped prefixes.
 */
export function normalizeCommandSignature(cmd: string): string {
  if (!cmd || typeof cmd !== 'string') return '';
  let s = cmd.trim();
  if (!s) return '';

  // 1. Strip chained sleep prefix: e.g. sleep 2 &&, rtk sleep 3 &&, sudo sleep 1;
  s = s.replace(/^(?:(?:rtk|sudo)\s+)?sleep\s+\d+\s*(?:&&|;)\s*/, '');

  // 2. Strip wrapper prefixes: rtk proxy, rtk, sudo
  while (true) {
    const stripped = s.replace(/^(?:rtk\s+proxy|rtk|sudo)\s+/, '');
    if (stripped === s) break;
    s = stripped.trim();
  }

  // 3. File-polling signature: tail, head, wc, or python read
  const filePollMatch = s.match(/^(?:tail|head|wc)\b(.*)$/);
  if (filePollMatch) {
    const argsStr = filePollMatch[1].trim();
    const tokens = argsStr.split(/\s+/).filter(Boolean);
    let candidatePath: string | null = null;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === '|' || token === '||' || token === '&&' || token === ';') {
        break;
      }
      if (token.startsWith('-')) {
        if (
          (token === '-n' || token === '-c' || token === '--lines' || token === '--bytes') &&
          i + 1 < tokens.length &&
          /^[+-]?\d+$/.test(tokens[i + 1])
        ) {
          i++;
        }
        continue;
      }
      if (/^[+-]?\d+$/.test(token)) {
        continue;
      }
      candidatePath = token.replace(/['"]/g, '');
    }
    if (candidatePath) {
      return `POLL_FILE:${candidatePath}`;
    }
  }

  // Check python/python3 -c reading file
  if (/^python[3]?\b/.test(s) && s.includes('-c')) {
    const openMatch = s.match(/(?:open|Path)\s*\(\s*['"]([^'"]+)['"]/);
    if (openMatch) {
      const filePath = openMatch[1];
      const isRead = /readlines|read_text|read\s*\(|\.lines\b/.test(s);
      const isWrite = /['"][wa]\+?['"]|write_text|write\s*\(/.test(s);
      if (isRead && !isWrite) {
        return `POLL_FILE:${filePath}`;
      }
    }
  }

  // 4. Process-polling signature: pgrep, ps
  if (/^pgrep\b/.test(s)) {
    const pMatch = s.match(/-P\s*(\d+)/);
    if (pMatch) {
      return `POLL_PROC:${pMatch[1]}`;
    }
    const tokens = s.split(/\s+/).slice(1);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.startsWith('-')) {
        if (t === '-P' && i + 1 < tokens.length) {
          return `POLL_PROC:${tokens[i + 1]}`;
        }
        continue;
      }
      return `POLL_PROC:${t.replace(/['"]/g, '')}`;
    }
  }

  if (/^ps\b/.test(s)) {
    const pMatch = s.match(/-[pP]\s*(\d+)/);
    if (pMatch) {
      return `POLL_PROC:${pMatch[1]}`;
    }
    const grepMatch = s.match(/\|\s*grep\s+(?:-[a-zA-Z]+\s+)*['"]?([^'"\s|]+)/);
    if (grepMatch && grepMatch[1] !== 'grep' && grepMatch[1] !== '-v') {
      return `POLL_PROC:${grepMatch[1]}`;
    }
  }

  return s.trim().replace(/\s+/g, ' ');
}

export class AttentionGuardCircuitBreaker {
  streak: number = 0;
  state: CircuitBreakerState = 'NORMAL';

  lastCommand: string = '';
  lastCommandSignature: string = '';
  identicalCommandCount: number = 0;
  totalSessionChars: number = 0;
  charsSinceRefresh: number = 0;

  isTestOrBuildCommand(cmd: string): boolean {
    if (!cmd || !cmd.trim()) return false;
    const trimmed = cmd.trim();

    const patterns = [
      /\b(?:pytest|vitest|jest|mocha|ctest)\b/,
      /\bcargo\s+(?:test|build|check)\b/,
      /\b(?:mvn|\.\/gradlew|gradle)\b/,
      /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|t|build|compile)\b/,
      /\bgo\s+(?:test|build|install)\b/,
      /\bdotnet\s+(?:test|build)\b/,
      /\bmake\s+(?:test|check)\b/,
      /\bcmake(?:\s+--build)?\b/,
      /\bninja\b/,
      /\bpip[3]?\s+install\b/,
    ];

    return patterns.some((p) => p.test(trimmed));
  }

  recordFileEdit(): void {
    this.lastCommand = '';
    this.lastCommandSignature = '';
    this.identicalCommandCount = 0;
  }

  checkDoomLoop(command: string, threshold: number = 3): string | null {
    if (!command || !command.trim()) return null;
    const norm = command.trim();
    const sig = normalizeCommandSignature(norm);
    if (sig && sig === this.lastCommandSignature) {
      this.identicalCommandCount += 1;
    } else {
      this.lastCommand = norm;
      this.lastCommandSignature = sig;
      this.identicalCommandCount = 1;
    }

    if (this.identicalCommandCount >= threshold) {
      return `Attention Guard: Subagent doom-loop circuit breaker. Command '${norm}' executed ${this.identicalCommandCount} times consecutively without intervening file edits. Do not poll processes or logs in a shell loop; return your current status or await async completion.`;
    }
    return null;
  }

  recordTokens(chars: number): void {
    if (chars > 0) {
      this.totalSessionChars += chars;
      this.charsSinceRefresh += chars;
    }
  }

  get totalSessionTokens(): number {
    return Math.floor(this.totalSessionChars / 4);
  }

  get tokensSinceRefresh(): number {
    return Math.floor(this.charsSinceRefresh / 4);
  }

  resetRefreshCounter(): void {
    this.charsSinceRefresh = 0;
  }

  checkTokenSalience(
    invocationNum: number = 0,
    interval: number = 25,
    tokenBudget: number = 128000
  ): string | null {
    const tokens = this.tokensSinceRefresh;
    if (tokens >= 40000) {
      this.resetRefreshCounter();
      const budgetK = Math.floor(tokenBudget / 1000);
      const pct = ((this.totalSessionTokens / tokenBudget) * 100).toFixed(1);
      return `\n[Context Telemetry: ~${tokens.toLocaleString()} tokens accumulated since last refresh (~${this.totalSessionTokens.toLocaleString()} total tokens, ${pct}% of ${budgetK}k budget). Review active context and consider pruning or delegating.]\n`;
    }

    if (interval > 0 && invocationNum > 0 && invocationNum % interval === 0) {
      if (this.totalSessionTokens < 20000) {
        return null;
      }
      this.resetRefreshCounter();
      const budgetK = Math.floor(tokenBudget / 1000);
      const pct = ((this.totalSessionTokens / tokenBudget) * 100).toFixed(1);
      return `\n[Context Telemetry: ~${this.totalSessionTokens.toLocaleString()} tokens (${pct}% of ${budgetK}k budget) at turn ${invocationNum}. Review active context and consider pruning or delegating.]\n`;
    }

    return null;
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
      advice = `\n[ATTENTION GUARD - ATTEMPT 1]: Test failure detected. Speculative in-place edits are discouraged. Author an isolated test reproducer (test_*, *_test.*) or diagnostic doc (diagnosis.md, rca.md) before fixing code.\n`;
    } else {
      this.state = 'FAILURE_STAGE_2_TRIPPED';
      advice = `\n[ATTENTION GUARD - ATTEMPT ${this.streak}]: Consecutive test failures (Streak: ${this.streak}). Circuit breaker tripped: stop speculative trial-and-error edits immediately. Isolate root cause in diagnosis.md or rca.md.\n`;
    }

    return { state: this.state, streak: this.streak, advice };
  }
}
