import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import type { ShellExecRequest, ShellExecSpec } from '@deepseek-ai/dsh-shell';
import { apply, name, inject, Config } from '../src/index.js';
import * as rtkModule from '../src/rtk.js';

describe('dsh-plugin-attention-guard plugin', () => {
  let ctx: Context;
  let mockOriginalResolve: (req: ShellExecRequest) => ShellExecSpec;

  beforeEach(() => {
    mockOriginalResolve = vi.fn((req: ShellExecRequest): ShellExecSpec => ({
      command: req.command,
      workdir: req.workdir || '/workspace',
      timeoutMs: req.timeoutMs || 30000,
      stdoutMaxBytes: 1024 * 1024,
      sandboxPolicy: undefined,
    }));

    ctx = {
      shell: {
        resolve: mockOriginalResolve,
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
    };

    apply(ctx, config);

    const result = ctx.shell.resolve({ command: 'cargo test' });
    expect(result.command).toBe('cargo test');
    expect(mockOriginalResolve).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'cargo test' })
    );
  });

  it('leaves ctx.shell.resolve untouched when rtk is not available', () => {
    vi.spyOn(rtkModule, 'checkRtkAvailable').mockReturnValue(false);

    const initialResolve = ctx.shell.resolve;

    const config = {
      enabled: true,
      model: 'deepseek-flash',
      rtkBinary: 'rtk',
      excludeCommands: [],
    };

    apply(ctx, config);

    expect(ctx.shell.resolve).toBe(initialResolve);
  });
});
