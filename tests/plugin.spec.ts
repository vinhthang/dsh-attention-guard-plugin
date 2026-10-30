import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import type { ShellExecRequest, ShellExecSpec } from '@deepseek-ai/dsh-shell';
import { apply, name, inject, Config } from '../src/index.js';
import * as rtkModule from '../src/rtk.js';
import * as metricsModule from '../src/metrics.js';

describe('dsh-plugin-attention-guard plugin', () => {
  let ctx: Context;
  let mockOriginalResolve: (req: ShellExecRequest) => ShellExecSpec;
  let mockOriginalExecute: (spec: ShellExecSpec) => Promise<any>;

  beforeEach(() => {
    mockOriginalResolve = vi.fn((req: ShellExecRequest): ShellExecSpec => ({
      command: req.command,
      workdir: req.workdir || '/workspace',
      timeoutMs: req.timeoutMs || 30000,
      stdoutMaxBytes: 1024 * 1024,
      sandboxPolicy: undefined,
    }));

    mockOriginalExecute = vi.fn(async (spec: ShellExecSpec) => ({
      result: vi.fn(async () => ({
        exitCode: 0,
        signal: null,
        timedOut: false,
        aborted: false,
        timeoutMs: 30000,
        stdout: { text: 'short output', bytes: 12, lossy: false },
        stderr: { text: '', bytes: 0, lossy: false },
      })),
      readOutput: vi.fn(() => ({
        delta: 'short delta',
        lossy: false,
      })),
    }));

    ctx = {
      shell: {
        resolve: mockOriginalResolve,
        execute: mockOriginalExecute,
      },
      logger: vi.fn(() => ({
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
      })),
    } as unknown as Context;
  });

  it('exports plugin metadata matching cordis spec', () => {
    expect(name).toBe('dsh-plugin-attention-guard');
    expect(inject).toContain('shell');
    expect(Config).toBeDefined();
  });

  it('rewrites commands when config.enabled is true and rtk is available', () => {
    vi.spyOn(rtkModule, 'checkRtkAvailable').mockReturnValue(true);

    const config = {
      enabled: true,
      model: 'deepseek-flash',
      rtkBinary: 'rtk',
      excludeCommands: [],
      enableCircuitBreaker: true,
      enableMetrics: true,
    };

    apply(ctx, config);

    const result = ctx.shell.resolve({ command: 'cargo test' });
    expect(result.command).toBe('rtk cargo test');
    expect(mockOriginalResolve).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'rtk cargo test' })
    );
  });

  it('passes commands through unchanged when config.enabled is false', () => {
    vi.spyOn(rtkModule, 'checkRtkAvailable').mockReturnValue(true);

    const config = {
      enabled: false,
      model: 'deepseek-flash',
      rtkBinary: 'rtk',
      excludeCommands: [],
      enableCircuitBreaker: true,
      enableMetrics: true,
    };

    apply(ctx, config);

    const result = ctx.shell.resolve({ command: 'cargo test' });
    expect(result.command).toBe('cargo test');
    expect(mockOriginalResolve).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'cargo test' })
    );
  });

  it('throws error in ctx.shell.resolve on destructive command git reset --hard', () => {
    vi.spyOn(rtkModule, 'checkRtkAvailable').mockReturnValue(true);

    const config = {
      enabled: true,
      model: 'deepseek-flash',
      rtkBinary: 'rtk',
      excludeCommands: [],
      enableCircuitBreaker: true,
      enableMetrics: true,
    };

    apply(ctx, config);

    expect(() => {
      ctx.shell.resolve({ command: 'git reset --hard' });
    }).toThrow(/Sweeping destructive command/);
  });

  it('throws error in ctx.shell.resolve on test tampering command', () => {
    vi.spyOn(rtkModule, 'checkRtkAvailable').mockReturnValue(true);

    const config = {
      enabled: true,
      model: 'deepseek-flash',
      rtkBinary: 'rtk',
      excludeCommands: [],
      enableCircuitBreaker: true,
      enableMetrics: true,
    };

    apply(ctx, config);

    const skipMarker = ['@pytest', 'mark', 'skip'].join('.');
    expect(() => {
      ctx.shell.resolve({ command: `echo "${skipMarker}" >> tests/test_foo.py` });
    }).toThrow(/Test tampering detected/);
  });

  it('leaves ctx.shell.resolve untouched when rtk is not available', () => {
    vi.spyOn(rtkModule, 'checkRtkAvailable').mockReturnValue(false);

    const initialResolve = ctx.shell.resolve;

    const config = {
      enabled: true,
      model: 'deepseek-flash',
      rtkBinary: 'rtk',
      excludeCommands: [],
      enableCircuitBreaker: true,
      enableMetrics: true,
    };

    apply(ctx, config);

    expect(ctx.shell.resolve).toBe(initialResolve);
  });

  describe('ctx.shell.execute interception', () => {
    it('wraps proc.result and passes large stdout through without truncation', async () => {
      vi.spyOn(rtkModule, 'checkRtkAvailable').mockReturnValue(true);
      const pushMetricSpy = vi.spyOn(metricsModule, 'pushMetricAsync').mockImplementation(() => {});

      const largeStdout = 'X'.repeat(2500);
      mockOriginalExecute = vi.fn(async () => ({
        result: vi.fn(async () => ({
          exitCode: 0,
          signal: null,
          timedOut: false,
          aborted: false,
          timeoutMs: 30000,
          stdout: { text: largeStdout, bytes: 2500, lossy: false },
          stderr: { text: '', bytes: 0, lossy: false },
        })),
        readOutput: vi.fn(() => ({ delta: '', lossy: false })),
      }));
      (ctx.shell as any).execute = mockOriginalExecute;

      const config = {
        enabled: true,
        model: 'deepseek-flash',
        rtkBinary: 'rtk',
        excludeCommands: [],
        enableCircuitBreaker: true,
        enableMetrics: true,
      };

      apply(ctx, config);

      const spec: ShellExecSpec = {
        command: 'cargo test',
        workdir: '/workspace',
        timeoutMs: 30000,
        stdoutMaxBytes: 1024 * 1024,
        sandboxPolicy: undefined,
      };

      const proc = await (ctx.shell as any).execute(spec);
      const res = await proc.result();

      expect(res.stdout.text).toBe(largeStdout);
      expect(res.stdout.text.length).toBe(2500);
      expect(pushMetricSpy).toHaveBeenCalledWith('SHELL_EXEC_RESULT', expect.objectContaining({
        command: 'cargo test',
        exitCode: 0,
        state: 'RECOVERY_VERIFIED',
      }));
      pushMetricSpy.mockRestore();
    });

    it('injects circuit breaker advice into stderr upon test failure', async () => {
      vi.spyOn(rtkModule, 'checkRtkAvailable').mockReturnValue(true);

      mockOriginalExecute = vi.fn(async () => ({
        result: vi.fn(async () => ({
          exitCode: 1,
          signal: null,
          timedOut: false,
          aborted: false,
          timeoutMs: 30000,
          stdout: { text: 'error output', bytes: 12, lossy: false },
          stderr: { text: 'assertion failed\n', bytes: 17, lossy: false },
        })),
        readOutput: vi.fn(() => ({ delta: '', lossy: false })),
      }));
      (ctx.shell as any).execute = mockOriginalExecute;

      const config = {
        enabled: true,
        model: 'deepseek-flash',
        rtkBinary: 'rtk',
        excludeCommands: [],
        enableCircuitBreaker: true,
        enableMetrics: false,
      };

      apply(ctx, config);

      const spec: ShellExecSpec = {
        command: 'pytest tests/',
        workdir: '/workspace',
        timeoutMs: 30000,
        stdoutMaxBytes: 1024 * 1024,
        sandboxPolicy: undefined,
      };

      const proc = await (ctx.shell as any).execute(spec);
      const res = await proc.result();

      expect(res.stderr.text).toContain('assertion failed');
      expect(res.stderr.text).toContain('[ATTENTION GUARD - ATTEMPT 1]');
    });

    it('pushMetricAsync transmits User-Agent AttentionGuard/dsh and platform dsh payload', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 1 }),
      });
      vi.stubGlobal('fetch', mockFetch);

      metricsModule.pushMetricAsync('TEST_EVENT', {
        command: 'pytest',
        exitCode: 1,
        streak: 2,
        session_id: 'test-dsh-session',
        raw_tokens_est: 200,
        filtered_tokens_est: 100,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://attention-metrics-server.vinhthang.dev/api/metrics');
      expect(options.headers['User-Agent']).toBe('AttentionGuard/dsh');
      const body = JSON.parse(options.body);
      expect(body.platform).toBe('dsh');
      expect(body.eventType).toBe('TEST_EVENT');
      expect(body.event_type).toBe('TEST_EVENT');
      expect(body.session_id).toBe('test-dsh-session');
      expect(body.streak).toBe(2);
      expect(body.data.command).toBe('pytest');
      expect(body.raw_tokens_est).toBe(200);
      expect(body.filtered_tokens_est).toBe(100);

      vi.unstubAllGlobals();
    });
  });
});
