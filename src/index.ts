import type { Context } from '@deepseek-ai/cordis';
import type { ShellExecRequest, ShellExecSpec } from '@deepseek-ai/dsh-shell';
import { Config } from './schema.js';
import { checkRtkAvailable, rewriteCommand } from './rtk.js';
import { AttentionGuardCircuitBreaker } from './circuit-breaker.js';
import { pushMetricAsync } from './metrics.js';

export const name = 'dsh-plugin-attention-guard';
export const inject = ['shell', 'sandboxPolicy'] as const;
export { Config };
export type { Config as ConfigType } from './schema.js';

export * from './schema.js';
export * from './rtk.js';
export * from './circuit-breaker.js';
export * from './metrics.js';

export function apply(ctx: Context, config: Config): void {
  const isAvailable = checkRtkAvailable(config.rtkBinary);
  if (!isAvailable) {
    const logger = typeof ctx.logger === 'function' ? ctx.logger('attention-guard') : ctx.logger;
    logger?.warn?.(`rtk binary "${config.rtkBinary}" not found in PATH; Attention Guard disabled`);
    return;
  }

  const cb = new AttentionGuardCircuitBreaker();

  const originalResolve = ctx.shell.resolve.bind(ctx.shell);

  ctx.shell.resolve = function (this: any, request: ShellExecRequest): ShellExecSpec {
    if (!config.enabled) {
      return originalResolve.call(this, request);
    }

    const rewritten = rewriteCommand(request.command, config);
    return originalResolve.call(this, {
      ...request,
      command: rewritten,
    });
  };

  if (typeof (ctx.shell as any)?.execute === 'function') {
    const originalExecute = (ctx.shell as any).execute.bind(ctx.shell);

    (ctx.shell as any).execute = async function (this: any, spec: ShellExecSpec): Promise<any> {
      const proc = await originalExecute.call(this, spec);
      if (!config.enabled) return proc;

      // Intercept foreground result()
      if (typeof proc.result === 'function') {
        const originalResult = proc.result.bind(proc);
        proc.result = async function () {
          const res = await originalResult();

          let advice = '';
          if (config.enableCircuitBreaker) {
            const cbOutcome = cb.recordExecution(spec.command, res.exitCode);
            if (cbOutcome.advice) {
              advice = cbOutcome.advice;
            }
          }

          if (advice && res.stderr) {
            res.stderr.text = (res.stderr.text || '') + advice;
          }

          if (config.enableMetrics) {
            pushMetricAsync('SHELL_EXEC_RESULT', {
              command: spec.command,
              exitCode: res.exitCode,
              state: cb.state,
              streak: cb.streak,
            });
          }

          return res;
        };
      }

      return proc;
    };
  }
}

export default {
  name,
  inject,
  Config,
  apply,
};
